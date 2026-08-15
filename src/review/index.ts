import { Context } from "probot";
import { loadConfig } from "../config";
import { applyLogOverrides, createObserver, newReviewId, Observer, resolveObserverOptions } from "../observability";
import { generateReview } from "./providers";
import { formatSafeDiff, LABELS, parseReview, renderMarkdown, ReviewLanguage, ReviewResult, validateIssueLines } from "./parse";
import { buildSystemPrompt } from "./prompt";
import { filterByMinSeverity, filterFiles, loadRepoConfigFromOctokit, RepoConfig } from "./repo-config";

export interface ReviewTarget {
  octokit: Context["octokit"];
  owner: string;
  repo: string;
  pullNumber: number;
  /** 当前 head commit SHA；配合 dedupe 用于去重 */
  headSha?: string;
  /** 是否做同 commit 去重（自动触发为 true，手动触发为 false） */
  dedupe?: boolean;
}

export async function runReview(target: ReviewTarget): Promise<void> {
  const { octokit, owner, repo, pullNumber, headSha, dedupe } = target;

  let obs = createObserver(resolveObserverOptions("probot", process.env)).child({
    repo: `${owner}/${repo}`,
    pr: pullNumber,
    sha: headSha,
    reviewId: newReviewId(),
    trigger: dedupe ? "auto" : "manual",
  });
  const reviewSpan = obs.start();
  obs.info("review.start", "开始审查");

  if (dedupe && headSha && (await hasExistingReview(target, headSha))) {
    obs.invocation("review.skip", "该 commit 已审查过，跳过重复审查", { reason: "dup_review" });
    return;
  }

  const config = loadConfig();
  const repoConfig = await loadRepoConfigFromOctokit(octokit, owner, repo);
  obs = applyRepoObservability(obs, repoConfig);
  obs.info("review.config", "已加载仓库配置", {
    autoReview: repoConfig.auto_review,
    minSeverity: repoConfig.min_severity ?? null,
    blockOnCritical: repoConfig.block_on_critical ?? false,
  });

  // 自动分页读取完整文件列表，避免 PR > 100 文件时静默遗漏
  const files = await octokit.paginate(octokit.pulls.listFiles, {
    owner,
    repo,
    pull_number: pullNumber,
    per_page: 100,
  });

  const reviewable = filterFiles(files, repoConfig);
  const stats = diffStats(reviewable);
  const patch = formatSafeDiff(reviewable, config.maxDiffLength);
  obs.debug("review.diff", "读取变更", {
    files: stats.files,
    additions: stats.additions,
    deletions: stats.deletions,
    diffBytes: patch.length,
  });

  if (!patch.trim()) {
    await postSummary(target, renderReport(stats, "", undefined, config.language, LABELS[config.language].noChange));
    obs.invocation("review.invocation", "无可审查变更", { outcome: "empty", durationMs: reviewSpan.elapsed() });
    return;
  }

  const systemPrompt = repoConfig.instructions
    ? `${buildSystemPrompt(config.language)}\n\n### Team Custom Instructions / 团队自定义审查指令\n${repoConfig.instructions}`
    : buildSystemPrompt(config.language);

  const llmSpan = obs.start();
  let rawReport: string;
  try {
    rawReport = await generateReview(config, {
      systemPrompt,
      diff: patch,
    });
    llmSpan.finish("llm.done", { provider: config.provider, model: config.model, status: "ok" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    obs.error("review.error", `LLM 调用失败：${message}`, {
      reason: "llm_error",
      provider: config.provider,
      model: config.model,
      durationMs: llmSpan.elapsed(),
    });
    await postSummary(target, renderReport(stats, `⚠️ ${LABELS[config.language].reviewFailed}：${message}`, undefined, config.language));
    obs.invocation("review.invocation", "审查失败", { outcome: "failed", reason: "llm_error", durationMs: reviewSpan.elapsed() });
    return;
  }

  const parsed = parseReview(rawReport);
  if (!parsed) {
    // 结构化解析失败：降级为整体报告，不静默丢失审查内容
    obs.warn("review.parse", "结构化解析失败，降级为整体报告", { status: "fallback" });
    await postSummary(target, renderReport(stats, rawReport, undefined, config.language));
    obs.invocation("review.invocation", "解析失败，降级为整体报告", { outcome: "parse_fallback", durationMs: reviewSpan.elapsed() });
    return;
  }
  obs.info("review.parse", "审查结果解析成功", { status: "ok", issues: parsed.issues.length });

  const filtered = filterByMinSeverity(parsed, repoConfig.min_severity);
  const counts = { critical: 0, important: 0, normal: 0 };
  for (const i of filtered.issues) counts[i.severity]++;
  if (repoConfig.block_on_critical && headSha) {
    await setCriticalStatus(target, headSha, counts.critical);
  }

  // 校验行号：不在 diff 新增行集合的 line 归 0，避免行内评论 422 / 错位
  await postInlineReview(target, stats, { ...filtered, issues: validateIssueLines(filtered.issues, reviewable) }, config.language, obs);

  // 标记该 commit 已完成海姆达尔审查（供跨触发与跨端去重）
  if (headSha) {
    try {
      await octokit.repos.createCommitStatus({
        owner,
        repo,
        sha: headSha,
        state: "success",
        context: "heimdall/reviewed",
        description: "已完成海姆达尔代码审查",
      });
    } catch {
      // 忽略 status 权限不具备等失败，不影响主流程
    }
  }

  obs.info("review.post", "审查已发布", counts);
  obs.invocation("review.invocation", "审查完成", { outcome: "posted", durationMs: reviewSpan.elapsed(), ...counts });
}

/** 应用仓库级 observability 覆盖（未配置时保持环境变量默认） */
export function applyRepoObservability(obs: Observer, repoConfig: RepoConfig): Observer {
  return applyLogOverrides(obs, repoConfig.observability?.logs);
}

export function prParams(target: ReviewTarget): {
  owner: string;
  repo: string;
  pull_number: number;
} {
  return { owner: target.owner, repo: target.repo, pull_number: target.pullNumber };
}

/** 该 head commit 是否已存在海姆达尔审查（用于同 commit 去重） */
async function hasExistingReview(target: ReviewTarget, headSha: string): Promise<boolean> {
  const { data: reviews } = await target.octokit.pulls.listReviews({
    ...prParams(target),
    per_page: 100,
  });
  return reviews.some((r) => r.commit_id === headSha && (r.body ?? "").includes("海姆达尔"));
}

/** 存在 critical 问题时把 heimdall/critical 状态置为 failure，阻断合并；无则 success */
async function setCriticalStatus(target: ReviewTarget, headSha: string, criticalCount: number): Promise<void> {
  const state = criticalCount > 0 ? "failure" : "success";
  const description =
    criticalCount > 0
      ? `存在 ${criticalCount} 个严重问题，解决后重新推送触发审查即可解除阻断`
      : "未发现严重问题，可以合并";
  await target.octokit.repos.createCommitStatus({
    owner: target.owner,
    repo: target.repo,
    sha: headSha,
    state,
    context: "heimdall/critical",
    description,
  });
}

interface DiffStats {
  files: number;
  additions: number;
  deletions: number;
  /** 文件明细，用于变更表格 */
  fileDetails: Array<{ filename: string; additions: number; deletions: number }>;
}

function diffStats(files: Array<{ filename?: string; additions?: number; deletions?: number }>): DiffStats {
  return {
    files: files.length,
    additions: files.reduce((sum, f) => sum + (f.additions ?? 0), 0),
    deletions: files.reduce((sum, f) => sum + (f.deletions ?? 0), 0),
    fileDetails: files
      .map((f) => ({
        filename: f.filename ?? "",
        additions: f.additions ?? 0,
        deletions: f.deletions ?? 0,
      }))
      .filter((f) => f.filename),
  };
}

function renderReport(
  stats: DiffStats,
  content: string,
  result?: ReviewResult,
  language: ReviewLanguage = "en",
  noChangeMessage?: string
): string {
  const L = LABELS[language];
  const issues = result?.issues ?? [];
  const critical = issues.filter((i) => i.severity === "critical").length;
  const important = issues.filter((i) => i.severity === "important").length;
  const normal = issues.filter((i) => i.severity === "normal").length;

  const statusBadge = critical > 0 ? L.statusBlock : important > 0 ? L.statusAttention : L.statusPass;
  const issueCounts = `🔴 **${critical} Critical** · 🟡 **${important} Important** · 🟢 **${normal} Normal**`;
  const scale = `🟢 +${stats.additions} / 🔴 -${stats.deletions} (${stats.files})`;

  const table =
    stats.fileDetails.length > 0
      ? ["", `### 📝 ${L.filesDetail}`, "", `| ${L.fileCol} | ${L.changeCol} |`, "| --- | :---: |"]
          .concat(stats.fileDetails.map((f) => `| \`${f.filename}\` | 🟢 +${f.additions} / 🔴 -${f.deletions} |`))
          .join("\n")
      : "";

  const info = `
<details>
<summary>ℹ️ ${L.reviewInfo}</summary>

- **${L.filesReviewed}**：${stats.files}
- **${L.changeSize}**：🟢 +${stats.additions} / 🔴 -${stats.deletions}
- **${L.guardian}**：Heimdall Bifrost Guard v1.0

</details>`;

  return `## ${L.reportTitle}
> ${L.reportSubtitle}

| ${L.status} | ${L.risk} | ${L.scale} |
| :---: | :---: | :---: |
| ${statusBadge} | ${issueCounts} | ${scale} |

${table}

---

${content || noChangeMessage || ""}

${info}`;
}

async function postInlineReview(target: ReviewTarget, stats: DiffStats, result: ReviewResult, language: ReviewLanguage, obs: Observer): Promise<void> {
  const L = LABELS[language];
  const body = renderReport(stats, renderMarkdown(result, language), result, language);

  const comments = result.issues
    .filter((i) => i.line > 0)
    .map((i) => ({
      path: i.file,
      line: i.line,
      side: "RIGHT" as const,
      body: [
        `${severityLabel(i.severity)} **${i.comment}**`,
        i.suggestion ? `\n\n**${L.fixSuggestion}**：${i.suggestion}` : "",
        i.suggestionCode
          ? `\n\n\`\`\`suggestion\n${i.suggestionCode}\n\`\`\``
          : i.diff
          ? `\n\n\`\`\`diff\n${i.diff}\n\`\`\``
          : "",
      ].join(""),
    }));

  if (comments.length === 0) {
    await postSummary(target, body);
    return;
  }

  try {
    await target.octokit.pulls.createReview({
      ...prParams(target),
      event: "COMMENT",
      body,
      comments,
    });
  } catch (err) {
    // 行号映射失败（GitHub 422 等）：降级为整体报告
    const message = err instanceof Error ? err.message : String(err);
    obs.error("review.error", `行内评论发布失败，降级为整体报告：${message}`, { reason: "post_inline_failed" });
    await postSummary(target, body);
  }
}

function severityLabel(severity: "critical" | "important" | "normal"): string {
  switch (severity) {
    case "critical":
      return "🔴";
    case "important":
      return "🟡";
    case "normal":
      return "🟢";
  }
}

async function postSummary(target: ReviewTarget, body: string): Promise<void> {
  await target.octokit.pulls.createReview({
    ...prParams(target),
    event: "COMMENT",
    body,
  });
}
