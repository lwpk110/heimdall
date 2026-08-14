import { createHmac, timingSafeEqual, createPrivateKey, sign } from "node:crypto";
import { parseReview, renderMarkdown } from "../src/review/parse";
import { SYSTEM_PROMPT } from "../src/review/prompt";

interface Env {
  GITHUB_APP_ID: string;
  GITHUB_PRIVATE_KEY: string;
  WEBHOOK_SECRET: string;
  AI_PROVIDER?: string;
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
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
    if (event !== "pull_request") return new Response("Ignored", { status: 200 });

    const payload = JSON.parse(body);
    if (!["opened", "reopened", "synchronize"].includes(payload.action)) {
      return new Response("Ignored", { status: 200 });
    }
    const pr = payload.pull_request;
    if (pr.draft || pr.user?.type === "Bot") return new Response("Ignored", { status: 200 });

    // 异步执行审查，立即返回 ack，避免 webhook 超时
    ctx.waitUntil(handlePullRequest(env, payload).catch((err) => console.error("审查失败:", err)));

    return new Response("OK", { status: 200 });
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
    },
  });
  if (!res.ok) throw new Error(`获取安装令牌失败：${res.status} ${await res.text()}`);
  const data = (await res.json()) as { token: string };
  return data.token;
}

async function handlePullRequest(env: Env, payload: any): Promise<void> {
  const pr = payload.pull_request;
  const token = await getInstallationToken(env, payload.installation?.id);

  // 1. 读取 diff
  const diffRes = await fetch(pr.diff_url, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github.diff",
    },
  });
  if (!diffRes.ok) throw new Error(`读取 diff 失败：${diffRes.status}`);
  const diff = (await diffRes.text()).slice(0, Number(env.MAX_DIFF_LENGTH ?? 40000));

  // 2. 调用 LLM 生成审查报告
  let report: string;
  try {
    const raw = await generateReview(env, diff);
    const result = parseReview(raw);
    report = result ? renderMarkdown(result) : raw;
  } catch (err) {
    report = `⚠️ 审查失败：${err instanceof Error ? err.message : String(err)}`;
  }

  // 3. 以 Review 形式回写 PR
  const reviewRes = await fetch(
    `https://api.github.com/repos/${payload.repository.owner.login}/${payload.repository.name}/pulls/${pr.number}/reviews`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "content-type": "application/json",
      },
      body: JSON.stringify({ event: "COMMENT", body: `## 海姆达尔 · 代码审查报告\n\n${report}` }),
    }
  );
  if (!reviewRes.ok) throw new Error(`发布 review 失败：${reviewRes.status} ${await reviewRes.text()}`);
}

async function generateReview(env: Env, diff: string): Promise<string> {
  const provider = (env.AI_PROVIDER ?? "anthropic").toLowerCase();

  if (provider === "openai") {
    if (!env.OPENAI_API_KEY) throw new Error("缺少 OPENAI_API_KEY");
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: env.AI_MODEL ?? "gpt-4o",
        max_tokens: 4096,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: diff },
        ],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI API 失败：${res.status} ${await res.text()}`);
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content ?? "";
  }

  if (!env.ANTHROPIC_API_KEY) throw new Error("缺少 ANTHROPIC_API_KEY");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: env.AI_MODEL ?? "claude-sonnet-4-5-20250929",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: diff }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API 失败：${res.status} ${await res.text()}`);
  const data = (await res.json()) as { content?: Array<{ text?: string }> };
  return data.content?.[0]?.text ?? "";
}
