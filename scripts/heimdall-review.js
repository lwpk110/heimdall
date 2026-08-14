#!/usr/bin/env node
/**
 * 海姆达尔 (Heimdall) — GitHub Actions 模式审查脚本
 *
 * 把本文件与 .github/workflows/heimdall-review.yml 一起复制到「被审查的仓库」，
 * 在仓库 Settings → Secrets 配置 ANTHROPIC_API_KEY 或 OPENAI_API_KEY 后即可生效。
 *
 * 说明：本脚本零依赖（Node 18+ 自带 fetch），可独立运行。
 * 系统 prompt 与 src/review/prompt.ts 保持一致，改动时请同步。
 */
"use strict";

const fs = require("fs");

const {
  GITHUB_TOKEN,
  GITHUB_REPOSITORY,
  GITHUB_EVENT_PATH,
  AI_PROVIDER,
  ANTHROPIC_API_KEY,
  OPENAI_API_KEY,
  AI_MODEL,
  MAX_DIFF_LENGTH = "40000",
} = process.env;

const SYSTEM_PROMPT = `你是"海姆达尔"（Heimdall）——来自漫威宇宙、阿斯加德彩虹桥（Bifrost）的守护者。你能洞悉九界中的一切，任何一行代码的瑕疵都逃不过你的双眼；同时你是一名极其严格的资深代码审查专家。

请审查以下 GitHub Pull Request 的 diff，重点关注：
1. 潜在的 bug 与逻辑错误
2. 安全风险（注入、越权、密钥泄露、不安全依赖等）
3. 性能问题（不必要的循环、N+1 查询、内存泄漏等）
4. 边界条件与错误处理
5. 可读性、可维护性与一致性

要求：
- 用中文输出，简洁、具体、可执行
- 用 markdown 分三节：【严重问题】【建议改进】【良好实践】
- 每个问题尽量指出所在文件和大致位置
- 直接给出有价值的技术判断，不要客套
- 如果 diff 没有明显问题，如实说明即可，不要为了凑数而挑刺`;

const event = JSON.parse(fs.readFileSync(GITHUB_EVENT_PATH, "utf8"));
const pr = event.pull_request;
if (!pr) {
  console.log("非 PR 事件，跳过");
  process.exit(0);
}

const [owner, repo] = GITHUB_REPOSITORY.split("/");
const provider = (AI_PROVIDER || "anthropic").toLowerCase();

// 未配置对应 AI 密钥时优雅跳过，避免每次 PR 的 CI 检查变红
const requiredKey =
  provider === "openai" ? OPENAI_API_KEY : ANTHROPIC_API_KEY;
if (!requiredKey) {
  const keyName = provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
  console.log(`海姆达尔：未配置 ${keyName}，本次跳过审查。`);
  console.log("提示：请在仓库 Settings → Secrets and variables → Actions 添加对应密钥后启用。");
  process.exit(0);
}

async function gh(path, options = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    method: options.method || "GET",
    body: options.body ? JSON.stringify(options.body) : undefined,
    headers: {
      authorization: `Bearer ${GITHUB_TOKEN}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "content-type": "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API ${options.method || "GET"} ${path} 失败：${res.status} ${text}`);
  }
  return res.json();
}

async function generateReview(diff) {
  if (provider === "openai") {
    if (!OPENAI_API_KEY) throw new Error("缺少 OPENAI_API_KEY");
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: AI_MODEL || "gpt-4o",
        max_tokens: 4096,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: diff },
        ],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI API 失败：${res.status} ${await res.text()}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
  }

  if (!ANTHROPIC_API_KEY) throw new Error("缺少 ANTHROPIC_API_KEY");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: AI_MODEL || "claude-sonnet-4-5-20250929",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: diff }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API 失败：${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

async function postReview(body) {
  await gh(`/repos/${owner}/${repo}/pulls/${pr.number}/reviews`, {
    method: "POST",
    body: { event: "COMMENT", body },
  });
}

async function main() {
  // 1. 读取 diff
  const files = await gh(`/repos/${owner}/${repo}/pulls/${pr.number}/files?per_page=100`);
  const diff = files
    .filter((f) => f.patch)
    .map((f) => `### ${f.filename}\n\`\`\`diff\n${f.patch}\n\`\`\``)
    .join("\n\n")
    .slice(0, Number(MAX_DIFF_LENGTH));

  if (!diff.trim()) {
    await postReview("海姆达尔：本次 PR 没有可审查的代码变更。");
    console.log("海姆达尔：无可审查变更");
    return;
  }

  // 2. 调用 LLM
  let report;
  try {
    report = await generateReview(diff);
  } catch (err) {
    await postReview(`## 海姆达尔 · 代码审查报告\n\n⚠️ 审查失败：${err.message}`);
    console.error("审查失败：", err.message);
    process.exit(1);
  }

  // 3. 发布审查
  await postReview(`## 海姆达尔 · 代码审查报告\n\n${report}`);
  console.log("海姆达尔审查完成");
}

main().catch((err) => {
  console.error("海姆达尔审查失败：", err);
  process.exit(1);
});
