import { Buffer } from "node:buffer";
import { createHmac, timingSafeEqual, createPrivateKey, sign } from "node:crypto";
import { applyLogOverrides, createObserver, newReviewId, resolveObserverOptions } from "../src/observability";
import { formatSafeDiff, LABELS, parseReview, renderMarkdown, ReviewLanguage, ReviewResult, validateIssueLines } from "../src/review/parse";
import { buildSystemPrompt } from "../src/review/prompt";
import { filterByMinSeverity, filterFiles, parseHeimdallConfig, RepoConfig } from "../src/review/repo-config";

// 模块级去重缓存：记录最近已审查的 PR+commit（缓解 serverless 并发竞态；
// 同一实例内并发请求共享，跨实例依赖 GitHub 侧 review/status 检查兜底）
const recentReviews = new Map<string, { sha: string; time: number }>();
const REVIEW_CACHE_MS = 60000;

interface Env {
  GITHUB_APP_ID: string;
  GITHUB_PRIVATE_KEY: string;
  WEBHOOK_SECRET: string;
  AI_PROVIDER?: string;
  AI_API_KEY?: string;
  AI_BASE_URL?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_BASE_URL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  GEMINI_API_KEY?: string;
  GEMINI_BASE_URL?: string;
  AI_MODEL?: string;
  REVIEW_LANGUAGE?: string;
  MAX_DIFF_LENGTH?: string;
  HEIMDALL_LOG_ENABLED?: string;
  HEIMDALL_INVOCATION_LOGS?: string;
  HEIMDALL_LOG_LEVEL?: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/api/github/webhooks" || request.method !== "POST") {
      return new Response("Not Found", { status: 404 });
    }

    const body = await request.text();
    const signature = request.headers.get("x-hub-signature-256") ?? "";
    const event = request.headers.get("x-github-event") ?? "";

    // 1. 校验 webhook 签名
    if (!verifySignature(env.WEBHOOK_SECRET, body, signature)) {
      return new Response("Invalid signature", { status: 401 });
    }

    if (event === "ping") return new Response("OK", { status: 200 });

    const payload = JSON.parse(body);

    if (event === "pull_request") {
      if (!["opened", "reopened", "synchronize"].includes(payload.action)) {
        return new Response("Ignored", { status: 200 });
      }
      const pr = payload.pull_request;
      if (pr.draft || pr.user?.type === "Bot") {
        createObserver(resolveObserverOptions("worker", env)).child({
          repo: `${payload.repository.owner.login}/${payload.repository.name}`,
          pr: pr.number,
          sha: pr.head?.sha,
          reviewId: newReviewId(),
          trigger: "auto",
        }).invocation("review.skip", pr.draft ? "草稿 PR，跳过审查" : "机器人发起的 PR，跳过审查", {
          reason: pr.draft ? "draft_pr" : "bot_pr",
        });
        return new Response("Ignored", { status: 200 });
      }
      ctx.waitUntil(runWebhookReview(env, payload, pr.number, undefined, true).catch((err) => console.error("审查失败:", err)));
      return new Response("OK", { status: 200 });
    }

    if (event === "issue_comment" && payload.action === "created") {
      const issue = payload.issue;
      const comment = payload.comment;
      // 只处理 PR 上的评论，且内容匹配 @heimdall review
      if (!issue?.pull_request) return new Response("Ignored", { status: 200 });
      if (!/@(?:coder)?heimdall(?:\s+review)?\b/i.test(comment?.body ?? "")) return new Response("Ignored", { status: 200 });
      if (comment?.user?.type === "Bot") return new Response("Ignored", { status: 200 });
      ctx.waitUntil(runWebhookReview(env, payload, issue.number, comment?.user?.login).catch((err) => console.error("审查失败:", err)));
      return new Response("OK", { status: 200 });
    }

    return new Response("Ignored", { status: 200 });
  },
};

function verifySignature(secret: string, body: string, signature: string): boolean {
  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 用 App 私钥生成短期 JWT，用于换取安装令牌 */
function createAppJwt(appId: string, privateKeyPem: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iat: now - 60, exp: now + 600, iss: appId })).toString("base64url");
  const signingInput = `${header}.${payload}`;
  const key = createPrivateKey(privateKeyPem);
  const sig = sign("RSA-SHA256", Buffer.from(signingInput), key).toString("base64url");
  return `${signingInput}.${sig}`;
}

async function getInstallationToken(env: Env, installationId: number): Promise<string> {
  const jwt = createAppJwt(env.GITHUB_APP_ID, env.GITHUB_PRIVATE_KEY.replace(/\\n/g, "\n"));
  const res = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${jwt}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "heimdall-worker",
    },
  });
  if (!res.ok) throw new Error(`获取安装令牌失败：${res.status} ${await res.text()}`);
  const data = (await res.json()) as { token: string };
  return data.token;
}

async function fetchAllFiles(
  gh: (path: string, options?: { method?: string; body?: unknown }) => Promise<Response>,
  owner: string,
  repo: string,
  pullNumber: number
): Promise<Array<{ filename: string; patch?: string; additions?: number; deletions?: number }>> {
  const allFiles: Array<{ filename: string; patch?: string; additions?: number; deletions?: number }> = [];
  let page = 1;
  while (true) {
    const res = await gh(`/repos/${owner}/${repo}/pulls/${pullNumber}/files?per_page=100&page=${page}`);
    if (!res.ok) throw new Error(`读取文件列表失败：${res.status}`);
    const batch = (await res.json()) as Array<{ filename: string; patch?: string; additions?: number; deletions?: number }>;
    allFiles.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return allFiles;
}

async function runWebhookReview(env: Env, payload: any, pullNumber: number, triggerAuthor?: string, isAuto = false): Promise<void> {
  const owner = payload.repository.owner.login;
  const repo = payload.repository.name;
  const token = await getInstallationToken(env, payload.installation?.id);
  const gh = (path: string, options: { method?: string; body?: unknown } = {}) =>
    fetch(`https://api.github.com${path}`, {
      method: options.method || "GET",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "heimdall-worker",
        ...(options.body ? { "content-type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

  let obs = createObserver(resolveObserverOptions("worker", env)).child({
    repo: `${owner}/${repo}`,
    pr: pullNumber,
    reviewId: newReviewId(),
    trigger: triggerAuthor ? "manual" : "auto",
  });
  const reviewSpan = obs.start();
  obs.info("review.start", "开始审查");

  // 1. 读取配置并应用仓库级可观测性覆盖；跳过场景不再拉取文件列表
  const repoConfig = await loadRepoConfig(gh, owner, repo);
  obs = applyLogOverrides(obs, repoConfig.observability?.logs);
  if (isAuto && repoConfig.auto_review !== true) {
    obs.invocation("review.skip", "默认仅按需审查，跳过自动审查（可在 PR 评论发 @CoderHeimdall 手动触发；配置 auto_review: true 开启自动）", { reason: "not_auto_review" });
    return;
  }
  if (triggerAuthor && !isAllowedManualReviewer(repoConfig.manual_reviewers, triggerAuthor)) {
    obs.invocation("review.skip", `@${triggerAuthor} 不在 manual_reviewers 白名单，忽略触发`, { reason: "reviewer_not_whitelisted", author: triggerAuthor });
    return;
  }
  const files = await fetchAllFiles(gh, owner, repo, pullNumber);

  // 同 commit 去重：自动或手动触发时，该 commit 已审查过则跳过
  let headSha = payload.pull_request?.head?.sha;
  if (!headSha) {
    const prRes = await gh(`/repos/${owner}/${repo}/pulls/${pullNumber}`);
    if (prRes.ok) {
      const prData = (await prRes.json()) as { head?: { sha?: string } };
      headSha = prData.head?.sha;
    }
  }
  if (headSha) obs = obs.child({ sha: headSha });
  if (headSha && (await hasExistingReview(gh, owner, repo, pullNumber, headSha))) {
    obs.invocation("review.skip", "该 commit 已审查过，跳过重复审查", { reason: "dup_review" });
    return;
  }
  // 跨触发即时去重：模块级缓存（并发竞态缓解，无需额外权限）
  const cacheKey = `${owner}/${repo}#${pullNumber}`;
  const cached = recentReviews.get(cacheKey);
  if (headSha && cached && cached.sha === headSha && Date.now() - cached.time < REVIEW_CACHE_MS) {
    obs.invocation("review.skip", "该 commit 短时间内已审查，跳过", { reason: "dup_cache" });
    return;
  }
  // 跨触发即时去重：已有 heimdall/reviewed 成功状态则跳过（防自动+手动竞态重复）
  if (headSha) {
    const stRes = await gh(`/repos/${owner}/${repo}/commits/${headSha}/status`);
    if (stRes.ok) {
      const st = (await stRes.json()) as { statuses?: Array<{ context?: string; state?: string }> };
      if (st.statuses?.some((s) => s.context === "heimdall/reviewed" && s.state === "success")) {
        obs.invocation("review.skip", "该 commit 已有审查标记，跳过", { reason: "dup_status" });
        return;
      }
    }
  }
  const reviewable = filterFiles(files, repoConfig);
  const stats = diffStats(reviewable);
  const diff = formatSafeDiff(reviewable, Number(env.MAX_DIFF_LENGTH ?? 40000));
  obs.debug("review.diff", "读取变更", { files: stats.files, additions: stats.additions, deletions: stats.deletions, diffBytes: diff.length });

  const language: ReviewLanguage = (env.REVIEW_LANGUAGE ?? "en").toLowerCase() as ReviewLanguage;
  const L = LABELS[language] ?? LABELS.en;

  if (!diff.trim()) {
    await postReview(gh, owner, repo, pullNumber, renderReport(stats, "", undefined, language, L.noChange));
    obs.invocation("review.invocation", "无可审查变更", { outcome: "empty", durationMs: reviewSpan.elapsed() });
    return;
  }

  const systemPrompt = repoConfig.instructions
    ? `${buildSystemPrompt(language)}\n\n### Team Custom Instructions / 团队自定义审查指令\n${repoConfig.instructions}`
    : buildSystemPrompt(language);

  // 2. 调用 LLM 生成审查报告
  let outcome = "posted";
  let report: string;
  let criticalCount = 0;
  const issueCounts = { critical: 0, important: 0, normal: 0 };
  let inlineComments: Array<{ path: string; line: number; side: string; body: string }> = [];
  const llmSpan = obs.start();
  try {
    const raw = await generateReview(env, diff, systemPrompt);
    llmSpan.finish("llm.done", { provider: providerName(env), model: env.AI_MODEL, status: "ok" });
    const parsed = parseReview(raw);
    const filtered = parsed ? filterByMinSeverity(parsed, repoConfig.min_severity) : null;
    criticalCount = filtered ? filtered.issues.filter((i) => i.severity === "critical").length : 0;
    if (filtered) {
      for (const i of filtered.issues) issueCounts[i.severity]++;
      obs.info("review.parse", "审查结果解析成功", { status: "ok", issues: filtered.issues.length });
      filtered.issues = validateIssueLines(filtered.issues, reviewable);
      report = renderReport(stats, renderMarkdown(filtered, language), filtered, language);
      inlineComments = filtered.issues
        .filter((i) => i.line > 0)
        .map((i) => ({
          path: i.file,
          line: i.line,
          side: "RIGHT",
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
    } else {
      outcome = "parse_fallback";
      obs.warn("review.parse", "结构化解析失败，降级为整体报告", { status: "fallback" });
      report = renderReport(stats, raw, undefined, language);
    }
  } catch (err) {
    outcome = "failed";
    const message = err instanceof Error ? err.message : String(err);
    obs.error("review.error", `LLM 调用失败：${message}`, { reason: "llm_error", provider: providerName(env), model: env.AI_MODEL, durationMs: llmSpan.elapsed() });
    report = renderReport(stats, `⚠️ ${L.reviewFailed}：${message}`, undefined, language);
  }

  // block_on_critical：存在 critical 时设置状态阻断合并，无则置成功
  if (repoConfig.block_on_critical && headSha) {
    const state = criticalCount > 0 ? "failure" : "success";
    const description =
      criticalCount > 0
        ? `存在 ${criticalCount} 个严重问题，解决后重新推送触发审查即可解除阻断`
        : "未发现严重问题，可以合并";
    await gh(`/repos/${owner}/${repo}/statuses/${headSha}`, {
      method: "POST",
      body: { state, context: "heimdall/critical", description },
    });
  }

  // 3. 以 Review 形式回写 PR（整体报告 + 行内评论）
  await postReview(gh, owner, repo, pullNumber, report, inlineComments);
  obs.info("review.post", "审查已发布", issueCounts);
  obs.invocation("review.invocation", outcome === "failed" ? "审查失败" : "审查完成", {
    outcome,
    durationMs: reviewSpan.elapsed(),
    ...issueCounts,
  });

  // 4. 标记该 commit 已审查（供跨触发去重，防自动+手动竞态重复）
  if (headSha) {
    recentReviews.set(cacheKey, { sha: headSha, time: Date.now() });
    try {
      await gh(`/repos/${owner}/${repo}/statuses/${headSha}`, {
        method: "POST",
        body: { state: "success", context: "heimdall/reviewed", description: "已完成海姆达尔审查" },
      });
    } catch (err) {
      obs.warn("review.status", "设置已审查状态失败（不影响审查）", { reason: "status_failed", detail: err instanceof Error ? err.message : String(err) });
    }
  }
}

function providerName(env: Env): string {
  return (env.AI_PROVIDER ?? "anthropic").toLowerCase();
}

function severityLabel(severity: string): string {
  switch (severity) {
    case "critical":
      return "🔴";
    case "important":
      return "🟡";
    case "normal":
      return "🟢";
    default:
      return "";
  }
}

async function loadRepoConfig(gh: (path: string, options?: { method?: string; body?: unknown }) => Promise<Response>, owner: string, repo: string): Promise<RepoConfig> {
  try {
    const res = await gh(`/repos/${owner}/${repo}/contents/.github/heimdall.yml`);
    if (!res.ok) return {};
    const data = (await res.json()) as { content?: string };
    if (!data.content) return {};
    const text = Buffer.from(data.content, "base64").toString("utf8");
    return parseHeimdallConfig(text);
  } catch {
    return {};
  }
}

function isAllowedManualReviewer(whitelist: string[] | undefined, login: string | undefined): boolean {
  if (!whitelist || whitelist.length === 0) return true;
  if (!login) return false;
  const cleanLogin = login.replace(/^@/, "").trim().toLowerCase();
  return whitelist.some((name) => name.replace(/^@/, "").trim().toLowerCase() === cleanLogin);
}

async function hasExistingReview(
  gh: (path: string, options?: { method?: string; body?: unknown }) => Promise<Response>,
  owner: string,
  repo: string,
  pullNumber: number,
  headSha: string
): Promise<boolean> {
  const res = await gh(`/repos/${owner}/${repo}/pulls/${pullNumber}/reviews?per_page=100`);
  if (!res.ok) return false;
  const reviews = (await res.json()) as Array<{ commit_id?: string; body?: string }>;
  return reviews.some((r) => r.commit_id === headSha && (r.body ?? "").includes("海姆达尔"));
}

interface DiffStats {
  files: number;
  additions: number;
  deletions: number;
  fileDetails: Array<{ filename: string; additions: number; deletions: number }>;
}

function diffStats(files: Array<{ filename?: string; additions?: number; deletions?: number }>): DiffStats {
  return {
    files: files.length,
    additions: files.reduce((sum, f) => sum + (f.additions ?? 0), 0),
    deletions: files.reduce((sum, f) => sum + (f.deletions ?? 0), 0),
    fileDetails: files
      .map((f) => ({ filename: f.filename ?? "", additions: f.additions ?? 0, deletions: f.deletions ?? 0 }))
      .filter((f) => f.filename),
  };
}

function renderReport(stats: DiffStats, content: string, result?: ReviewResult, language: ReviewLanguage = "en", noChangeMessage?: string): string {
  const L = LABELS[language] ?? LABELS.en;
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

async function postReview(
  gh: (path: string, options?: { method?: string; body?: unknown }) => Promise<Response>,
  owner: string,
  repo: string,
  pullNumber: number,
  body: string,
  comments?: Array<{ path: string; line: number; side: string; body: string }>
): Promise<void> {
  const payload: Record<string, unknown> = { event: "COMMENT", body };
  if (comments && comments.length > 0) payload.comments = comments;
  const res = await gh(`/repos/${owner}/${repo}/pulls/${pullNumber}/reviews`, {
    method: "POST",
    body: payload,
  });
  if (!res.ok) throw new Error(`发布 review 失败：${res.status} ${await res.text()}`);
}

/** AI 调用带超时，避免占用 waitUntil 时间窗导致审查被终止（free 计划上限 30s） */
async function fetchTimeout(url: string, options: RequestInit, ms = 28000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function generateReview(env: Env, diff: string, systemPrompt: string = buildSystemPrompt()): Promise<string> {
  const provider = (env.AI_PROVIDER ?? "anthropic").toLowerCase();

  if (provider === "openai") {
    const apiKey = env.AI_API_KEY || env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("缺少 OPENAI_API_KEY");
    const baseUrl = (env.AI_BASE_URL || env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
    const res = await fetchTimeout(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: env.AI_MODEL ?? "gpt-4o",
        max_tokens: 4096,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: diff },
        ],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI API 失败：${res.status} ${await res.text()}`);
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content ?? "";
  }

  if (provider === "gemini") {
    const apiKey = env.AI_API_KEY || env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("缺少 GEMINI_API_KEY");
    const baseUrl = (env.AI_BASE_URL || env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com").replace(/\/+$/, "");
    const res = await fetchTimeout(
      `${baseUrl}/v1beta/models/${env.AI_MODEL ?? "gemini-2.0-flash"}:generateContent`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: diff }] }],
        }),
      }
    );
    if (!res.ok) throw new Error(`Gemini API 失败：${res.status} ${await res.text()}`);
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  }

  const apiKey = env.AI_API_KEY || env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("缺少 ANTHROPIC_API_KEY");
  const baseUrl = (env.AI_BASE_URL || env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, "");
  const res = await fetchTimeout(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: env.AI_MODEL ?? "claude-sonnet-4-5-20250929",
      max_tokens: 4096,
      system: systemPrompt,
      thinking: { type: "disabled" },
      messages: [{ role: "user", content: diff }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API 失败：${res.status} ${await res.text()}`);
  const data = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
  // content 可能含 thinking 块，需取 type 为 text 的块
  return data.content?.find((block) => block.type === "text")?.text ?? "";
}
