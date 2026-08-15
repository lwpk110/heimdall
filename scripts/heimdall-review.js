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

const SYSTEM_PROMPT = `你是"海姆达尔"（Heimdall）——阿斯加德彩虹桥（Bifrost）的守护者，能洞悉九界中的一切；同时你是一名极其严格的资深代码审查专家，以 GitHub Copilot Code Review 同等的专业水准审查每个 Pull Request。

【审查流程】
1. 先通读整个 diff，理解本次 PR 的目的、改动范围与整体影响
2. 逐文件分析，聚焦高风险变更（逻辑核心、安全敏感、数据迁移、对外接口、并发）
3. 权衡问题严重度，只上报值得开发者注意的问题，宁缺毋滥

【审查维度】（按优先级）
1. 正确性：逻辑错误、边界条件、竞态条件、空值/越界、死代码、类型不匹配
2. 安全性：注入、越权、敏感信息泄露、认证授权缺陷、不安全依赖、不安全的反序列化
3. 可靠性：错误处理缺失、异常被吞、资源未释放、非幂等、并发一致性
4. 性能：不必要的循环、N+1 查询、内存泄漏、无界数据结构
5. 可维护性：命名、结构、重复代码、违背现有模式、可测试性、可读性
6. 变更完整性：新增功能是否缺测试、破坏性变更是否有迁移/兼容处理、文档是否同步

【输出质量要求】
- summary（变更概述）：概括 PR 目的、主要改动、影响面与潜在风险，并给出建议的验证方式（如建议补充的测试、需要重点回归的点）
- issues 每条包含：
  - comment：**行动式语气说明**——先直接告诉开发者应该怎么做（以"应/建议/改为"开头），再点明问题与影响（如"当前硬编码密钥存在泄露风险，应从环境变量读取并在缺失时启动失败"）
  - suggestion（可选）：**具体修复建议**——给出改法、推荐 API/模式、或修复思路（可含简短代码示意）；给不出明确建议时可省略
  - 能定位到 diff 新增行的必须给真实行号（line），无法确定填 0
- 严重度判定：critical（会导致 bug/安全事故/数据错误）、important（可靠性/性能隐患、明显可改进）、normal（风格、可读性、小建议）
- 避免噪音：重复问题合并为一条；无关紧要的挑刺不上报；没有把握的推断标注"建议核实"
- 认可良好实践：明显优秀的设计、正确的防御性写法可作为 normal 级 issue 提及（comment 写"良好实践"），保持审查的平衡与建设性
- 如果 diff 没有明显问题，summary 正常填写，issues 返回 []，不要为了凑数而挑刺

【输出格式】
- 只输出一个 JSON 对象，不要输出任何其他文字、不要使用 markdown、不要用代码块包裹，直接输出原始 JSON
- 严格遵循结构：{"summary": "…", "issues": [{"severity": "critical", "file": "src/auth.ts", "line": 45, "comment": "JWT 未校验 exp，存在越权风险", "suggestion": "在签名验证后校验 exp，过期即拒绝"}]}
- severity 只允许 critical / important / normal`;

const event = JSON.parse(fs.readFileSync(GITHUB_EVENT_PATH, "utf8"));
// pull_request 事件与 issue_comment（PR 评论 @heimdall review）事件都支持
const pr = event.pull_request || (event.issue?.pull_request ? { number: event.issue.number } : null);
if (!pr) {
  console.log("非 PR 事件，跳过");
  process.exit(0);
}
if (event.issue) {
  const body = event.comment?.body ?? "";
  if (!/@(?:coder)?heimdall(?:\s+review)?\b/i.test(body)) {
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
      thinking: { type: "disabled" },
      messages: [{ role: "user", content: diff }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API 失败：${res.status} ${await res.text()}`);
  const data = await res.json();
  // content 可能含 thinking 块，需取 type 为 text 的块
  return (data.content || []).find((b) => b.type === "text")?.text || "";
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
  // 同 commit 去重：自动或手动触发时，该 commit 已审查过则跳过，避免重复审查刷屏
  let headSha = event.pull_request?.head?.sha;
  if (!headSha) {
    try {
      const prData = await gh(`/repos/${owner}/${repo}/pulls/${pr.number}`);
      headSha = prData.head?.sha;
    } catch (err) {
      console.log("海姆达尔：获取 PR head 失败，跳过去重：", err.message);
    }
  }
  if (headSha) {
    const existing = await gh(`/repos/${owner}/${repo}/pulls/${pr.number}/reviews?per_page=100`);
    const reviewed = existing.some(
      (r) => r.commit_id === headSha && (r.body || "").includes("海姆达尔")
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
      body: [
        `${severityLabel(i.severity)} ${i.comment}`,
        i.suggestion ? `\n> 💡 建议：${i.suggestion}` : "",
        i.diff ? `\n\n\`\`\`diff\n${i.diff}\n\`\`\`` : "",
      ].join(""),
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
  const candidates = extractJsonCandidates(String(raw));
  for (const c of candidates) {
    try {
      const data = JSON.parse(c);
      const issues = Array.isArray(data.issues)
        ? data.issues.map(normalizeIssue).filter(Boolean)
        : [];
      if (typeof data === "object" && data !== null) {
        return { summary: typeof data.summary === "string" ? data.summary : "", issues };
      }
    } catch (err) {
      // 该候选解析失败，尝试下一个
    }
  }
  return null;
}

function extractJsonCandidates(raw) {
  const candidates = [];
  const text = raw.trim();
  candidates.push(text.replace(/```(?:json)?/gi, "").trim());
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m;
  while ((m = fenceRe.exec(text))) candidates.push(m[1].trim());
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1));
  return candidates;
}

const SEVERITIES = ["critical", "important", "normal"];

function normalizeIssue(raw) {
  if (typeof raw !== "object" || raw === null) return null;
  const file = typeof raw.file === "string" ? raw.file.trim() : "";
  const comment = typeof raw.comment === "string" ? raw.comment.trim() : "";
  const line = typeof raw.line === "number" ? Math.floor(raw.line) : 0;
  const severity = SEVERITIES.includes(raw.severity) ? raw.severity : "important";
  const suggestion = typeof raw.suggestion === "string" ? raw.suggestion.trim() : "";
  const diff = typeof raw.diff === "string" ? raw.diff.trim() : "";
  if (!file || !comment) return null;
  const issue = { severity, file, line: line > 0 ? line : 0, comment };
  if (suggestion) issue.suggestion = suggestion;
  if (diff) issue.diff = diff;
  return issue;
}

function renderMarkdown(result) {
  const lines = [];
  if (result.summary) lines.push(`**变更概述**：${result.summary}`, "");
  if (result.issues.length > 0) {
    const critical = result.issues.filter((i) => i.severity === "critical").length;
    const important = result.issues.filter((i) => i.severity === "important").length;
    const normal = result.issues.filter((i) => i.severity === "normal").length;
    lines.push(`🔍 **发现 ${result.issues.length} 个问题**（critical ${critical} / important ${important} / normal ${normal}）`, "");
  }
  lines.push("<details>", "<summary>🤖 审查评论</summary>", "");
  for (const sev of SEVERITIES) {
    const group = result.issues.filter((i) => i.severity === sev);
    if (group.length === 0) continue;
    lines.push(`### ${SEVERITY_LABELS[sev]}`, "");
    for (const i of group) {
      const loc = i.file + (i.line > 0 ? `:${i.line}` : "");
      lines.push(`- **\`${loc}\`**：${i.comment}`);
      if (i.suggestion) lines.push(`  > 💡 建议：${i.suggestion}`);
      if (i.diff) {
        lines.push("", "  ```diff");
        for (const dl of String(i.diff).split("\n")) lines.push(dl ? "  " + dl : "  ");
        lines.push("  ```");
      }
    }
    lines.push("");
  }
  if (result.issues.length === 0) lines.push("未发现明显问题。", "");
  lines.push("</details>");
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
    fileDetails: files
      .map((f) => ({ filename: f.filename || "", additions: f.additions || 0, deletions: f.deletions || 0 }))
      .filter((f) => f.filename),
  };
}

function renderReport(stats, content) {
  const table =
    stats.fileDetails && stats.fileDetails.length > 0
      ? "\n\n| 文件 | 变更 |\n| --- | --- |\n" +
        stats.fileDetails.map((f) => `| \`${f.filename}\` | +${f.additions} / -${f.deletions} |`).join("\n")
      : "";
  const info = `
<details>
<summary>ℹ️ 审查信息</summary>

- **审查文件**：${stats.files} 个
- **变更规模**：+${stats.additions} / -${stats.deletions} 行

</details>`;
  return `## 海姆达尔 · 代码审查报告

**变更摘要**：本次 PR 共改动 ${stats.files} 个文件，+${stats.additions} / -${stats.deletions} 行。${table}

${content}

${info}`;
}

main().catch((err) => {
  console.error("海姆达尔审查失败：", err);
  process.exit(1);
});
