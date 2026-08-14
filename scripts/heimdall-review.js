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
  AI_API_KEY,
  AI_BASE_URL,
  ANTHROPIC_API_KEY,
  OPENAI_API_KEY,
  GEMINI_API_KEY,
  OPENAI_BASE_URL,
  ANTHROPIC_BASE_URL,
  GEMINI_BASE_URL,
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
- 只输出一个 JSON 对象，不要输出任何其他文字，不要用代码块包裹
- 严格遵循以下结构（issues 中每一项的 file / line 必须对应 diff 中实际出现的位置）：

{
  "summary": "一句话说明本次 PR 改了什么、影响面、需要关注的点",
  "issues": [
    {
      "severity": "critical",
      "file": "src/auth.ts",
      "line": 45,
      "comment": "JWT 未校验 exp，存在越权风险"
    }
  ]
}

- severity 取值：critical（bug / 安全风险 / 明显错误）、important（性能 / 健壮性 / 可维护性）、normal（可读性 / 风格）
- line 必须是该文件在 diff 中【新增行】（+ 行）的真实行号；无法确定确切行号时设为 0（该条只进入报告，不生成行内评论）
- comment 简洁、具体、可执行；不要客套
- issues 可以为空数组；不要为了凑数而挑刺`;

const event = JSON.parse(fs.readFileSync(GITHUB_EVENT_PATH, "utf8"));
// pull_request 事件与 issue_comment（PR 评论 @heimdall review）事件都支持
const pr = event.pull_request || (event.issue?.pull_request ? { number: event.issue.number } : null);
if (!pr) {
  console.log("非 PR 事件，跳过");
  process.exit(0);
}
if (event.issue) {
  const body = event.comment?.body ?? "";
  if (!/@heimdall(?:\s+review)?\b/i.test(body)) {
    console.log("非触发评论，跳过");
    process.exit(0);
  }
  if (event.comment?.user?.type === "Bot") {
    console.log("机器人评论，跳过");
    process.exit(0);
  }
}

const [owner, repo] = GITHUB_REPOSITORY.split("/");
const provider = (AI_PROVIDER || "anthropic").toLowerCase();

// 未配置对应 AI 密钥时优雅跳过，避免每次 PR 的 CI 检查变红
const requiredKey =
  AI_API_KEY ||
  (provider === "openai"
    ? OPENAI_API_KEY
    : provider === "gemini"
      ? GEMINI_API_KEY
      : ANTHROPIC_API_KEY);
if (!requiredKey) {
  const keyName = AI_API_KEY ? "AI_API_KEY" : provider === "openai" ? "OPENAI_API_KEY" : provider === "gemini" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY";
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

async function generateReview(diff, systemPrompt = SYSTEM_PROMPT) {
  if (provider === "openai") {
    const apiKey = AI_API_KEY || OPENAI_API_KEY;
    if (!apiKey) throw new Error("缺少 OPENAI_API_KEY");
    const baseUrl = (AI_BASE_URL || OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: AI_MODEL || "gpt-4o",
        max_tokens: 4096,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: diff },
        ],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI API 失败：${res.status} ${await res.text()}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
  }

  if (provider === "gemini") {
    const apiKey = AI_API_KEY || GEMINI_API_KEY;
    if (!apiKey) throw new Error("缺少 GEMINI_API_KEY");
    const baseUrl = (AI_BASE_URL || GEMINI_BASE_URL || "https://generativelanguage.googleapis.com").replace(/\/+$/, "");
    const res = await fetch(
      `${baseUrl}/v1beta/models/${AI_MODEL || "gemini-2.0-flash"}:generateContent`,
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
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  }

  const apiKey = AI_API_KEY || ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("缺少 ANTHROPIC_API_KEY");
  const baseUrl = (AI_BASE_URL || ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, "");
  const res = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: AI_MODEL || "claude-sonnet-4-5-20250929",
      max_tokens: 4096,
      system: systemPrompt,
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
  // 1. 读取配置、diff 与变更统计
  const repoConfig = await loadRepoConfig();
  if (event.issue && !isAllowedManualReviewer(repoConfig.manual_reviewers, event.comment?.user?.login)) {
    console.log("海姆达尔：评论者不在 manual_reviewers 白名单，忽略触发");
    return;
  }
  // auto_review 关闭时：自动审查（PR 事件）跳过，仅响应 @heimdall review 评论
  if (!event.issue && repoConfig.auto_review === false) {
    console.log("海姆达尔：auto_review 已关闭，跳过自动审查（可在 PR 评论发 @heimdall review 手动触发）");
    return;
  }
  // 同 commit 去重：自动触发时若该 commit 已审查过则跳过（手动触发不重复）
  if (!event.issue && event.pull_request?.head?.sha) {
    const existing = await gh(`/repos/${owner}/${repo}/pulls/${pr.number}/reviews?per_page=100`);
    const reviewed = existing.some(
      (r) => r.commit_id === event.pull_request.head.sha && (r.body || "").includes("海姆达尔")
    );
    if (reviewed) {
      console.log("海姆达尔：该 commit 已审查过，跳过重复审查");
      return;
    }
  }
  const files = await gh(`/repos/${owner}/${repo}/pulls/${pr.number}/files?per_page=100`);
  const reviewable = filterFiles(files, repoConfig);
  const stats = diffStats(reviewable);
  const diff = reviewable
    .filter((f) => f.patch)
    .map((f) => `### ${f.filename}\n\`\`\`diff\n${f.patch}\n\`\`\``)
    .join("\n\n")
    .slice(0, Number(MAX_DIFF_LENGTH));

  if (!diff.trim()) {
    await postReview(renderReport(stats, "海姆达尔：本次 PR 没有可审查的代码变更。"));
    console.log("海姆达尔：无可审查变更");
    return;
  }

  const systemPrompt = repoConfig.instructions
    ? SYSTEM_PROMPT + "\n\n### 团队自定义审查指令\n" + repoConfig.instructions
    : SYSTEM_PROMPT;

  // 2. 调用 LLM
  let rawReport;
  try {
    rawReport = await generateReview(diff, systemPrompt);
  } catch (err) {
    await postReview(renderReport(stats, `⚠️ 审查失败：${err.message}`));
    console.error("审查失败：", err.message);
    process.exit(1);
  }

  // 3. 解析结构化结果，行内评论失败时降级为整体报告
  const result = parseReview(rawReport);
  if (!result) {
    console.log("海姆达尔：结构化解析失败，降级为整体报告");
    await postReview(renderReport(stats, rawReport));
    return;
  }
  const filtered = filterByMinSeverity(result, repoConfig.min_severity);

  // block_on_critical：存在 critical 时设置状态阻断合并，无则置成功
  if (repoConfig.block_on_critical) {
    let headSha = event.pull_request?.head?.sha;
    if (!headSha) {
      const prData = await gh(`/repos/${owner}/${repo}/pulls/${pr.number}`);
      headSha = prData.head?.sha;
    }
    if (headSha) {
      const criticalCount = filtered.issues.filter((i) => i.severity === "critical").length;
      await setCriticalStatus(headSha, criticalCount);
    }
  }

  const body = renderReport(stats, renderMarkdown(filtered));
  const comments = filtered.issues
    .filter((i) => i.line > 0)
    .map((i) => ({
      path: i.file,
      line: i.line,
      side: "RIGHT",
      body: `${severityLabel(i.severity)} ${i.comment}`,
    }));

  if (comments.length === 0) {
    await postReview(body);
    return;
  }

  try {
    await postReviewWithComments(body, comments);
  } catch (err) {
    console.error("行内评论发布失败，降级为整体报告：", err.message);
    await postReview(body);
  }
  console.log("海姆达尔审查完成");
}

async function loadRepoConfig() {
  try {
    const data = await gh(`/repos/${owner}/${repo}/contents/.github/heimdall.yml`);
    if (!data || !data.content) return {};
    return parseHeimdallConfig(Buffer.from(data.content, "base64").toString("utf8"));
  } catch (err) {
    return {}; // 无配置文件（404）按默认行为
  }
}

function parseHeimdallConfig(text) {
  const cfg = {};
  const lines = text.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) { i++; continue; }
    const match = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(trimmed);
    if (!match) { i++; continue; }
    const key = match[1];
    const rest = match[2].trim();

    if (rest === "|") {
      const block = [];
      i++;
      while (i < lines.length && lines[i].startsWith(" ") && lines[i].trim() !== "") {
        block.push(lines[i].replace(/^\s+/, ""));
        i++;
      }
      if (block.length) cfg[key] = block.join("\n");
      continue;
    }
    if (rest.startsWith("[")) {
      const inner = rest.slice(1, rest.lastIndexOf("]"));
      cfg[key] = inner.split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
      i++;
      continue;
    }
    if (rest === "") {
      const items = [];
      i++;
      while (i < lines.length && /^\s*-/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*-\s*/, "").trim().replace(/^["']|["']$/g, ""));
        i++;
      }
      if (items.length) cfg[key] = items; else i++;
      continue;
    }
    cfg[key] = parseScalar(rest);
    i++;
  }
  return cfg;
}

function parseScalar(raw) {
  if (/^["'].*["']$/.test(raw)) return raw.slice(1, -1);
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

function matchesAnyGlob(filename, patterns) {
  return patterns.some((p) => globMatch(filename, p) || (!p.includes("/") && globMatch(filename.split("/").pop(), p)));
}

function globMatch(name, pattern) {
  let re = "^";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        if (pattern[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 2;
        } else {
          re += ".*";
          i += 1;
        }
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (/[.\\+^$(){}[\]|]/.test(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  re += "$";
  return new RegExp(re).test(name);
}

function filterFiles(files, cfg) {
  if (!(cfg.include && cfg.include.length) && !(cfg.exclude && cfg.exclude.length)) return files;
  return files.filter((f) => {
    if (cfg.include && cfg.include.length && !matchesAnyGlob(f.filename, cfg.include)) return false;
    if (cfg.exclude && cfg.exclude.length && matchesAnyGlob(f.filename, cfg.exclude)) return false;
    return true;
  });
}

function isAllowedManualReviewer(whitelist, login) {
  if (!whitelist || whitelist.length === 0) return true;
  if (!login) return false;
  return whitelist.some((name) => String(name).toLowerCase() === String(login).toLowerCase());
}

const SEVERITY_RANK = { critical: 3, important: 2, normal: 1 };

function filterByMinSeverity(result, minSeverity) {
  if (!minSeverity) return result;
  const min = SEVERITY_RANK[minSeverity];
  return { summary: result.summary, issues: result.issues.filter((i) => SEVERITY_RANK[i.severity] >= min) };
}

async function postReviewWithComments(body, comments) {
  await gh(`/repos/${owner}/${repo}/pulls/${pr.number}/reviews`, {
    method: "POST",
    body: { event: "COMMENT", body, comments },
  });
}

async function setCriticalStatus(sha, criticalCount) {
  const state = criticalCount > 0 ? "failure" : "success";
  const description =
    criticalCount > 0
      ? `存在 ${criticalCount} 个严重问题，解决后重新推送触发审查即可解除阻断`
      : "未发现严重问题，可以合并";
  await gh(`/repos/${owner}/${repo}/statuses/${sha}`, {
    method: "POST",
    body: { state, context: "heimdall/critical", description },
  });
}

function parseReview(raw) {
  const text = String(raw).replace(/```(?:json)?/gi, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let data;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch (err) {
    return null;
  }
  const issues = Array.isArray(data.issues)
    ? data.issues.map(normalizeIssue).filter(Boolean)
    : [];
  return { summary: typeof data.summary === "string" ? data.summary : "", issues };
}

const SEVERITIES = ["critical", "important", "normal"];

function normalizeIssue(raw) {
  if (typeof raw !== "object" || raw === null) return null;
  const file = typeof raw.file === "string" ? raw.file.trim() : "";
  const comment = typeof raw.comment === "string" ? raw.comment.trim() : "";
  const line = typeof raw.line === "number" ? Math.floor(raw.line) : 0;
  const severity = SEVERITIES.includes(raw.severity) ? raw.severity : "important";
  if (!file || !comment) return null;
  return { severity, file, line: line > 0 ? line : 0, comment };
}

function renderMarkdown(result) {
  const lines = [];
  if (result.summary) lines.push(`**变更概述**：${result.summary}`, "");
  for (const sev of SEVERITIES) {
    const group = result.issues.filter((i) => i.severity === sev);
    if (group.length === 0) continue;
    lines.push(`### ${SEVERITY_LABELS[sev]}`, "");
    for (const i of group) {
      const loc = i.file + (i.line > 0 ? `:${i.line}` : "");
      lines.push(`- \`${loc}\`：${i.comment}`);
    }
    lines.push("");
  }
  if (result.issues.length === 0) lines.push("未发现明显问题。", "");
  return lines.join("\n").trim();
}

const SEVERITY_LABELS = {
  critical: "🔴 严重问题",
  important: "🟡 建议改进",
  normal: "🟢 良好实践",
};

function severityLabel(severity) {
  switch (severity) {
    case "critical":
      return "🔴";
    case "important":
      return "🟡";
    case "normal":
      return "🟢";
  }
}

function diffStats(files) {
  return {
    files: files.length,
    additions: files.reduce((sum, f) => sum + (f.additions || 0), 0),
    deletions: files.reduce((sum, f) => sum + (f.deletions || 0), 0),
  };
}

function renderReport(stats, content) {
  return `## 海姆达尔 · 代码审查报告

**变更摘要**：本次 PR 共改动 ${stats.files} 个文件，+${stats.additions} / -${stats.deletions} 行。

${content}`;
}

main().catch((err) => {
  console.error("海姆达尔审查失败：", err);
  process.exit(1);
});
