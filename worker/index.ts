import { Buffer } from "node:buffer";
import { createHmac, timingSafeEqual, createPrivateKey, sign } from "node:crypto";
import { parseReview, renderMarkdown, ReviewResult } from "../src/review/parse";
import { SYSTEM_PROMPT } from "../src/review/prompt";
import { filterByMinSeverity, filterFiles, parseHeimdallConfig, RepoConfig } from "../src/review/repo-config";

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
  MAX_DIFF_LENGTH?: string;
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
      if (pr.draft || pr.user?.type === "Bot") return new Response("Ignored", { status: 200 });
      ctx.waitUntil(runWebhookReview(env, payload, pr.number, undefined, true).catch((err) => console.error("审查失败:", err)));
      return new Response("OK", { status: 200 });
    }

    if (event === "issue_comment" && payload.action === "created") {
      const issue = payload.issue;
      const comment = payload.comment;
      // 只处理 PR 上的评论，且内容匹配 @heimdall review
      if (!issue?.pull_request) return new Response("Ignored", { status: 200 });
      if (!/@heimdall(?:\s+review)?\b/i.test(comment?.body ?? "")) return new Response("Ignored", { status: 200 });
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

  // 1. 读取配置与文件列表
  const repoConfig = await loadRepoConfig(gh, owner, repo);
  if (isAuto && repoConfig.auto_review === false) {
    console.log("海姆达尔：auto_review 已关闭，跳过自动审查（可在 PR 评论发 @heimdall review 手动触发）");
    return;
  }
  if (triggerAuthor && !isAllowedManualReviewer(repoConfig.manual_reviewers, triggerAuthor)) {
    console.log(`海姆达尔：@${triggerAuthor} 不在 manual_reviewers 白名单，忽略触发`);
    return;
  }

  // 同 commit 去重：自动或手动触发时，该 commit 已审查过则跳过
  let headSha = payload.pull_request?.head?.sha;
  if (!headSha) {
    const prRes = await gh(`/repos/${owner}/${repo}/pulls/${pullNumber}`);
    if (prRes.ok) {
      const prData = (await prRes.json()) as { head?: { sha?: string } };
      headSha = prData.head?.sha;
    }
  }
  if (headSha && (await hasExistingReview(gh, owner, repo, pullNumber, headSha))) {
    console.log(`海姆达尔：commit ${headSha.slice(0, 8)} 已审查过，跳过重复审查`);
    return;
  }
  const filesRes = await gh(`/repos/${owner}/${repo}/pulls/${pullNumber}/files?per_page=100`);
  if (!filesRes.ok) throw new Error(`读取文件列表失败：${filesRes.status}`);
  const files = (await filesRes.json()) as Array<{
    filename: string;
    patch?: string;
    additions?: number;
    deletions?: number;
  }>;
  const reviewable = filterFiles(files, repoConfig);
  const stats = diffStats(reviewable);
  const diff = reviewable
    .filter((f) => f.patch)
    .map((f) => `### ${f.filename}\n\`\`\`diff\n${f.patch}\n\`\`\``)
    .join("\n\n")
    .slice(0, Number(env.MAX_DIFF_LENGTH ?? 40000));

  if (!diff.trim()) {
    await postReview(gh, owner, repo, pullNumber, renderReport(stats, "海姆达尔：本次 PR 没有可审查的代码变更。"));
    return;
  }

  const systemPrompt = repoConfig.instructions
    ? SYSTEM_PROMPT + "\n\n### 团队自定义审查指令\n" + repoConfig.instructions
    : SYSTEM_PROMPT;

  // 2. 调用 LLM 生成审查报告
  let report: string;
  let criticalCount = 0;
  try {
    const raw = await generateReview(env, diff, systemPrompt);
    const parsed = parseReview(raw);
    const filtered = parsed ? filterByMinSeverity(parsed, repoConfig.min_severity) : null;
    criticalCount = filtered ? filtered.issues.filter((i) => i.severity === "critical").length : 0;
    report = filtered ? renderReport(stats, renderMarkdown(filtered)) : renderReport(stats, raw);
  } catch (err) {
    report = renderReport(stats, `⚠️ 审查失败：${err instanceof Error ? err.message : String(err)}`);
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

  // 3. 以 Review 形式回写 PR
  await postReview(gh, owner, repo, pullNumber, report);
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
  return whitelist.some((name) => name.toLowerCase() === login.toLowerCase());
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

async function postReview(
  gh: (path: string, options?: { method?: string; body?: unknown }) => Promise<Response>,
  owner: string,
  repo: string,
  pullNumber: number,
  body: string
): Promise<void> {
  const res = await gh(`/repos/${owner}/${repo}/pulls/${pullNumber}/reviews`, {
    method: "POST",
    body: { event: "COMMENT", body },
  });
  if (!res.ok) throw new Error(`发布 review 失败：${res.status} ${await res.text()}`);
}

async function generateReview(env: Env, diff: string, systemPrompt: string = SYSTEM_PROMPT): Promise<string> {
  const provider = (env.AI_PROVIDER ?? "anthropic").toLowerCase();

  if (provider === "openai") {
    const apiKey = env.AI_API_KEY || env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("缺少 OPENAI_API_KEY");
    const baseUrl = (env.AI_BASE_URL || env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
    const res = await fetch(`${baseUrl}/chat/completions`, {
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
    const res = await fetch(
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
  const res = await fetch(`${baseUrl}/v1/messages`, {
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
      messages: [{ role: "user", content: diff }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API 失败：${res.status} ${await res.text()}`);
  const data = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
  // content 可能含 thinking 块，需取 type 为 text 的块
  return data.content?.find((block) => block.type === "text")?.text ?? "";
}
