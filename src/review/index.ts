import { Context } from "probot";
import { loadConfig } from "../config";
import { generateReview } from "./providers";
import { parseReview, renderMarkdown, ReviewResult } from "./parse";
import { SYSTEM_PROMPT } from "./prompt";
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

  if (dedupe && headSha && (await hasExistingReview(target, headSha))) {
    console.log(`海姆达尔：commit ${headSha.slice(0, 8)} 已审查过，跳过重复审查`);
    return;
  }

  const config = loadConfig();
  const repoConfig = await loadRepoConfigFromOctokit(octokit, owner, repo);

  const { data: files } = await octokit.pulls.listFiles({
    owner,
    repo,
    pull_number: pullNumber,
    per_page: 100,
  });

  const reviewable = filterFiles(files, repoConfig);
  const stats = diffStats(reviewable);
  const patch = reviewable
    .filter((f) => f.patch)
    .map((f) => `### ${f.filename}\n\`\`\`diff\n${f.patch}\n\`\`\``)
    .join("\n\n")
    .slice(0, config.maxDiffLength);

  if (!patch.trim()) {
    await postSummary(target, renderReport(stats, "海姆达尔：本次 PR 没有可审查的代码变更。"));
    return;
  }

  const systemPrompt = repoConfig.instructions
    ? `${SYSTEM_PROMPT}\n\n### 团队自定义审查指令\n${repoConfig.instructions}`
    : SYSTEM_PROMPT;

  let rawReport: string;
  try {
    rawReport = await generateReview(config, {
      systemPrompt,
      diff: patch,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await postSummary(target, renderReport(stats, `⚠️ 审查失败：${message}`));
    return;
  }

  const parsed = parseReview(rawReport);
  if (!parsed) {
    // 结构化解析失败：降级为整体报告，不静默丢失审查内容
    await postSummary(target, renderReport(stats, rawReport));
    return;
  }

  await postInlineReview(target, stats, filterByMinSeverity(parsed, repoConfig.min_severity));
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

interface DiffStats {
  files: number;
  additions: number;
  deletions: number;
}

function diffStats(files: Array<{ additions?: number; deletions?: number }>): DiffStats {
  return {
    files: files.length,
    additions: files.reduce((sum, f) => sum + (f.additions ?? 0), 0),
    deletions: files.reduce((sum, f) => sum + (f.deletions ?? 0), 0),
  };
}

function renderReport(stats: DiffStats, content: string): string {
  return `## 海姆达尔 · 代码审查报告

**变更摘要**：本次 PR 共改动 ${stats.files} 个文件，+${stats.additions} / -${stats.deletions} 行。

${content}`;
}

async function postInlineReview(target: ReviewTarget, stats: DiffStats, result: ReviewResult): Promise<void> {
  const body = renderReport(stats, renderMarkdown(result));

  const comments = result.issues
    .filter((i) => i.line > 0)
    .map((i) => ({
      path: i.file,
      line: i.line,
      side: "RIGHT" as const,
      body: `**${severityLabel(i.severity)}** ${i.comment}`,
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
    console.error("行内评论发布失败，降级为整体报告：", err instanceof Error ? err.message : err);
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
