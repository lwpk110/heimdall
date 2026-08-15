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
const { createObserver, resolveObserverOptions, applyLogOverrides, newReviewId } = require("./observability");

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
  REVIEW_LANGUAGE,
  MAX_DIFF_LENGTH = "40000",
} = process.env;

const LANGUAGE = ["en", "zh", "bilingual"].includes((REVIEW_LANGUAGE || "").toLowerCase())
  ? (REVIEW_LANGUAGE || "").toLowerCase()
  : "en";

/** 创建一次审查的 observer（上下文：repo/pr/trigger） */
function makeObserver(trigger) {
  return createObserver(resolveObserverOptions("actions", process.env)).child({
    repo: GITHUB_REPOSITORY,
    pr: pr.number,
    reviewId: newReviewId(),
    trigger,
  });
}

/** 预检阶段的跳过事件（进程将退出，用临时 observer 打一行） */
function emitSkip(reason, msg, extra) {
  createObserver(resolveObserverOptions("actions", process.env))
    .child({ repo: GITHUB_REPOSITORY, reviewId: newReviewId(), trigger: "unknown" })
    .invocation("review.skip", msg, Object.assign({ reason }, extra));
}

function buildSystemPrompt(language = LANGUAGE) {
  const directive = {
    en: "\n\n【输出语言】\nUse English for all output (summary, comment, suggestion).",
    zh: "\n\n【输出语言】\n所有输出（summary、comment、suggestion）使用中文。",
    bilingual:
      "\n\n【输出语言】\nOutput in English as the primary language, with concise Chinese in parentheses for key points (summary, comment).",
  };
  return SYSTEM_PROMPT + directive[language];
}

const SYSTEM_PROMPT = `你是"海姆达尔"（Heimdall）——阿斯加德彩虹桥（Bifrost）的守护者，能洞悉九界中的一切；同时你是一名极其严格的资深代码审查专家，以 GitHub Copilot Code Review 同等的专业水准审查每个 Pull Request。

【审查流程】
1. 先通读整个 diff，理解本次 PR 的目的、改动范围与整体影响
2. 逐文件分析，聚焦高风险变更（逻辑核心、安全敏感、数据迁移、对外接口、并发）
3. 权衡问题严重度，只上报值得开发者注意的问题，宁缺毋滥
4. 输出前逐项核对必查清单（任何一项命中都必须上报，不得遗漏）：
   □ 含敏感字段（passwordHash/secret/token/apiKey）的对象是否被整体赋值进响应/DTO 或直接返回（如 post.author = user）→ 敏感字段泄露，报并建议公开 DTO
   □ 是否调用了未定义的函数/方法/符号（会 ReferenceError 或编译错）→ 报并建议注入依赖
   □ 输入是否未经类型/格式校验就直接使用（JSON.parse、索引、运算）→ 报输入校验缺失
   □ 是否存在明显错误处理缺失（吞异常、未处理失败分支）

【审查维度】（按优先级）
1. 正确性：逻辑错误、边界条件、竞态条件、空值/越界、死代码、类型不匹配、未定义引用/方法（会编译或运行时报错）
2. 安全性：注入、越权、敏感信息泄露（含将敏感字段如 passwordHash/密钥暴露给客户端或响应对象）、认证授权缺陷、不安全依赖、不安全的反序列化、token/凭证配置（过期时间过长、未限定 scope、硬编码密钥）
3. 信任边界：输入来自客户端/外部时，服务端不得信任任何客户端提供的派生字段（如 passwordHash、role、id、isAdmin），须按标识重新加载权威数据再校验——客户端可伪造的字段若被信任即越权/绕过
4. 可靠性：错误处理缺失、异常被吞、资源未释放、非幂等、并发一致性、输入类型/格式未校验（如 JSON.parse 未验证输入是否为字符串）
5. 性能：不必要的循环、N+1 查询、内存泄漏、无界数据结构
6. 可维护性：命名、结构、重复代码、违背现有模式、可测试性、可读性
7. 变更完整性：新增功能是否缺测试、破坏性变更是否有迁移/兼容处理、文档是否同步

【必须检查的硬规则】（命中即报 critical 或 important，即使未被上面维度显式覆盖）
1. 客户端/外部输入的派生字段被服务端信任：如直接比较客户端传来的 passwordHash、信任客户端提供的 role/id/isAdmin——必须指出并建议按标识重新加载权威数据校验（这是越权/认证绕过的常见根因）
2. 硬编码密钥 / 凭据 / 密码
3. SQL / 命令 / 模板注入（字符串拼接用户输入）
4. 敏感信息（密钥、token、密码）输出到日志、响应或前端
5. 敏感字段泄露传导：含敏感字段（passwordHash / secret / token / apiKey）的完整对象被整体赋值进响应模型或直接返回（如 post.author = user、return user）→ 敏感字段会随响应暴露给客户端，必须指出并建议用公开 DTO 只映射安全字段
6. 未定义引用：调用/引用的函数、方法、符号在当前作用域或导入中不存在（会编译错误或 ReferenceError）——必须报出，建议注入依赖或补定义
7. 伪实现 / 参数未使用：方法声明了参数却完全未使用（如 sign(uid, key) 忽略 key 参数），或返回假的 token/拼接串而非真实签名/加密（如 return "tok."+uid）→ 伪实现，token/结果可被任意伪造，报 important/critical 并建议用真实签名库（如 jsonwebtoken）
8. 时序攻击 / 非常量时间比较：密码、哈希、密钥等敏感值的比较使用 === / == 而非常量时间（timingSafeEqual / bcrypt.compare）→ 若涉及密码/密钥比较，报并建议恒时比较

【输出质量要求】
- summary（变更概述）：概括 PR 目的、主要改动、影响面与潜在风险，并给出建议的验证方式（如建议补充的测试、需要重点回归的点）
- 发现累积：diff 中每个独立问题都必须单独成条上报，禁止合并——吞异常、any 类型、输入校验、错误处理缺失等各自独立一条；同一问题的不同方面（如 N+1 与整对象泄露）也要分别报
- 覆盖完整：diff 中所有明显问题都要上报，不要因已报若干条就停止；宁多勿漏
- issues 每条包含：
  - comment：**行动式语气说明**——先直接告诉开发者应该怎么做（以"应/建议/改为"开头），再点明问题与影响（如"当前硬编码密钥存在泄露风险，应从环境变量读取并在缺失时启动失败"）
  - suggestion（可选）：**具体修复建议**——给出改法、推荐 API/模式、或修复思路（可含简短代码示意）；给不出明确建议时可省略
  - **一致性要求**：diff 必须与 comment/suggestion 的修复手段一致（如建议用 bcrypt，diff 就必须是 bcrypt，不得用 sha256 等次优方案）
  - **行为变更标注**：若修复会改变现有行为（返回值、抛错、API 契约），在 comment 末尾标注"此改动会改变 X 行为，需同步更新调用方与测试"
  - **验证建议**：suggestion 或 comment 中给出可操作的验证/测试手段（如密钥缺失时启动失败的用例、并发结果保序、异常传播断言）
  - 能定位到 diff 新增行的必须给真实行号（line），**line 必须等于问题代码在 PR 修改后的目标文件（New File）中的实际行号**；宁可填 0（进报告）也不要标错行
- 严重度判定：
  - critical：会导致 bug / 安全事故 / 数据错误（如硬编码密钥、SQL 注入、明文密码比较、信任客户端可控字段、敏感信息泄露）
  - important：可靠性 / 性能隐患、明显可改进（错误处理缺失如吞异常、输入未校验、N+1 查询、伪实现等属于 important，非 critical）
  - normal：风格、可读性、小建议
  - 标定要求：不要人为抬高严重度——能导致实际攻击/数据损坏才算 critical；其他按真实影响归 important / normal
- 避免噪音：重复问题合并为一条；无关紧要的挑刺不上报；没有把握的推断标注"建议核实"
- 认可良好实践：明显优秀的设计、正确的防御性写法可作为 normal 级 issue 提及（comment 写"良好实践"），保持审查的平衡与建设性
- 如果 diff 没有明显问题，summary 正常填写，issues 返回 []，不要为了凑数而挑刺

【输出格式】
- 只输出一个 JSON 对象，不要输出任何其他文字、不要使用 markdown、不要用代码块包裹，直接输出原始 JSON
- 严格遵循结构：
  {
    "summary": "变更概述说明...",
    "focus_areas": ["🔒 安全性：JWT 签发机制", "⚙️ 核心逻辑：路由权限拦截"],
    "verification_steps": ["Token 过期测试：验证签发的 JWT 是否在设定时间后被正确拒绝"],
    "issues": [
      {
        "severity": "critical",
        "file": "src/auth.ts",
        "line": 45,
        "comment": "行动式说明...",
        "suggestion": "文字修复建议...",
        "suggestion_code": "const token = jwt.sign({ uid: user.id }, this.key, { expiresIn: '1h' });",
        "diff": "- const token = jwt.sign({ uid: user.id }, this.key);\n+ const token = jwt.sign({ uid: user.id }, this.key, { expiresIn: '1h' });"
      }
    ]
  }
- severity 只允许 critical / important / normal
- focus_areas：提取 1-3 个主要涉及的风险领域标签（带 Emoji，如 🔒 安全性、⚙️ 核心逻辑、⚡ 性能、🌐 接口契约）
- verification_steps：给出 1-3 个针对本次变更建议补充的回归测试项或验证步骤
- suggestion_code（可选）：对于单行/小范围修改，提供直接替换的新代码片段（无需 diff 前缀，供 GitHub 1-Click Suggestion 使用）

【常见漏报问题的报告示例】（遇到同类情况必须上报）
敏感字段传导（整对象进响应导致 passwordHash 等泄露）：
{"summary":"重构响应模型","focus_areas":["🔒 安全性：敏感数据暴露"],"verification_steps":["接口断言测试：验证 API 响应 json 不含 passwordHash"],"issues":[{"severity":"critical","file":"demo.ts","line":12,"comment":"应将 User 对象的敏感字段（passwordHash）排除，仅返回公开 DTO。当前 post.author 直接引用完整 User 对象，passwordHash 会随响应泄露给客户端。","suggestion":"定义公开 AuthorDTO（只含 id/username），映射后再赋值给 post.author","suggestion_code":"post.author = toPublicAuthor(author);","diff":"- post.author = author;\n+ post.author = toPublicAuthor(author);"}]}
未定义引用（调用不存在的函数/方法）：
{"summary":"更新签名逻辑","focus_areas":["⚙️ 核心逻辑：未定义方法"],"verification_steps":["运行单元测试：验证 sign 方法被正确定义与调用"],"issues":[{"severity":"critical","file":"demo.ts","line":20,"comment":"sign 函数未定义，此处调用会抛 ReferenceError。应定义 sign 方法或注入签名依赖。","suggestion":"导入 jsonwebtoken 并注入 sign，或声明方法","suggestion_code":"return jwt.sign({ uid: user.id }, this.key, { expiresIn: '1h' });","diff":"- return this.sign({uid:user.id}, this.key, '7d');\n+ return jwt.sign({uid:user.id}, this.key, {expiresIn:'1h'});"}]}`;

const event = JSON.parse(fs.readFileSync(GITHUB_EVENT_PATH, "utf8"));
// pull_request 事件与 issue_comment（PR 评论 @heimdall review）事件都支持
const pr = event.pull_request || (event.issue?.pull_request ? { number: event.issue.number } : null);
if (!pr) {
  emitSkip("non_pr_event", "非 PR 事件，跳过");
  process.exit(0);
}
if (event.issue) {
  const body = event.comment?.body ?? "";
  if (!/@(?:coder)?heimdall(?:\s+review)?\b/i.test(body)) {
    emitSkip("no_trigger_comment", "非触发评论，跳过");
    process.exit(0);
  }
  if (event.comment?.user?.type === "Bot") {
    emitSkip("bot_pr", "机器人评论，跳过");
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
  emitSkip("missing_api_key", `未配置 ${keyName}，本次跳过审查`, { key: keyName });
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

async function fetchTimeout(url, options, ms = 60000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAllFiles() {
  const allFiles = [];
  let page = 1;
  while (true) {
    const batch = await gh(`/repos/${owner}/${repo}/pulls/${pr.number}/files?per_page=100&page=${page}`);
    allFiles.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return allFiles;
}

function formatSafeDiff(files, maxDiffLength) {
  const blocks = [];
  let currentLen = 0;
  let truncated = false;

  for (const f of files) {
    if (!f.patch) continue;
    const header = `### ${f.filename}\n\`\`\`diff\n`;
    const footer = `\n\`\`\``;

    if (currentLen + header.length + footer.length > maxDiffLength) {
      truncated = true;
      break;
    }

    let fileContent = header;
    currentLen += header.length;
    const patchLines = String(f.patch).split("\n");

    let linesAdded = 0;
    for (const line of patchLines) {
      const lineLen = line.length + 1;
      if (currentLen + lineLen + footer.length > maxDiffLength) {
        truncated = true;
        break;
      }
      fileContent += (linesAdded > 0 ? "\n" : "") + line;
      currentLen += lineLen;
      linesAdded++;
    }

    fileContent += footer;
    currentLen += footer.length;
    blocks.push(fileContent);

    if (truncated) break;
  }

  let result = blocks.join("\n\n");
  if (truncated && result.trim()) {
    result += "\n\n[⚠️ Diff 规模过大，已在文件/行边界处自动截断以适应 LLM 上下文]";
  }
  return result;
}

async function generateReview(diff, systemPrompt = SYSTEM_PROMPT) {
  if (provider === "openai") {
    const apiKey = AI_API_KEY || OPENAI_API_KEY;
    if (!apiKey) throw new Error("缺少 OPENAI_API_KEY");
    const baseUrl = (AI_BASE_URL || OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
    const res = await fetchTimeout(`${baseUrl}/chat/completions`, {
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
    const res = await fetchTimeout(
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
  const res = await fetchTimeout(`${baseUrl}/v1/messages`, {
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
  return (data.content || []).find((b) => b.type === "text")?.text || "";
}

async function postReview(body) {
  await gh(`/repos/${owner}/${repo}/pulls/${pr.number}/reviews`, {
    method: "POST",
    body: { event: "COMMENT", body },
  });
}

async function main() {
  let obs = makeObserver(event.issue ? "manual" : "auto");
  const reviewSpan = obs.start();
  obs.info("review.start", "开始审查");

  // 1. 读取配置、diff 与变更统计
  const repoConfig = await loadRepoConfig();
  obs = applyLogOverrides(obs, repoConfig.observability && repoConfig.observability.logs);
  if (event.issue && !isAllowedManualReviewer(repoConfig.manual_reviewers, event.comment?.user?.login)) {
    obs.invocation("review.skip", "评论者不在 manual_reviewers 白名单，忽略触发", { reason: "reviewer_not_whitelisted", author: event.comment?.user?.login });
    return;
  }
  // 默认仅按需审查：auto_review 未显式设为 true 时，PR 事件跳过自动审查（仅 @CoderHeimdall 触发）
  if (!event.issue && repoConfig.auto_review !== true) {
    obs.invocation("review.skip", "默认仅按需审查，跳过自动审查（可在 PR 评论发 @CoderHeimdall 手动触发；配置 auto_review: true 开启自动）", { reason: "not_auto_review" });
    return;
  }
  // 同 commit 去重：自动或手动触发时，该 commit 已审查过则跳过，避免重复审查刷屏
  let headSha = event.pull_request?.head?.sha;
  if (!headSha) {
    try {
      const prData = await gh(`/repos/${owner}/${repo}/pulls/${pr.number}`);
      headSha = prData.head?.sha;
    } catch (err) {
      obs.warn("review.skip", "获取 PR head 失败，跳过去重", { reason: "head_fetch_failed", detail: err.message });
    }
  }
  if (headSha) obs = obs.child({ sha: headSha });
  if (headSha) {
    const existing = await gh(`/repos/${owner}/${repo}/pulls/${pr.number}/reviews?per_page=100`);
    const reviewed = existing.some(
      (r) => r.commit_id === headSha && (r.body || "").includes("海姆达尔")
    );
    if (reviewed) {
      obs.invocation("review.skip", "该 commit 已审查过，跳过重复审查", { reason: "dup_review" });
      return;
    }
  }
  const files = await fetchAllFiles();
  const reviewable = filterFiles(files, repoConfig);
  const stats = diffStats(reviewable);
  const diff = formatSafeDiff(reviewable, Number(MAX_DIFF_LENGTH));
  obs.debug("review.diff", "读取变更", { files: stats.files, additions: stats.additions, deletions: stats.deletions, diffBytes: diff.length });

  if (!diff.trim()) {
    await postReview(renderReport(stats, "", undefined, LANGUAGE, LABELS[LANGUAGE]?.noChange));
    obs.invocation("review.invocation", "无可审查变更", { outcome: "empty", durationMs: reviewSpan.elapsed() });
    return;
  }

  const systemPrompt = repoConfig.instructions
    ? `${buildSystemPrompt(LANGUAGE)}\n\n### Team Custom Instructions / 团队自定义审查指令\n${repoConfig.instructions}`
    : buildSystemPrompt(LANGUAGE);

  // 2. 调用 LLM
  const llmSpan = obs.start();
  let rawReport;
  let outcome = "posted";
  try {
    rawReport = await generateReview(diff, systemPrompt);
    llmSpan.finish("llm.done", { provider, model: AI_MODEL, status: "ok" });
  } catch (err) {
    outcome = "failed";
    obs.error("review.error", `LLM 调用失败：${err.message}`, { reason: "llm_error", provider, model: AI_MODEL, durationMs: llmSpan.elapsed() });
    await postReview(renderReport(stats, `⚠️ ${LABELS[LANGUAGE]?.reviewFailed}：${err.message}`, undefined, LANGUAGE));
    obs.invocation("review.invocation", "审查失败", { outcome: "failed", reason: "llm_error", durationMs: reviewSpan.elapsed() });
    process.exit(1);
  }

  // 3. 解析结构化结果，行内评论失败时降级为整体报告
  const result = parseReview(rawReport);
  if (!result) {
    outcome = "parse_fallback";
    obs.warn("review.parse", "结构化解析失败，降级为整体报告", { status: "fallback" });
    await postReview(renderReport(stats, rawReport, undefined, LANGUAGE));
    obs.invocation("review.invocation", "解析失败，降级为整体报告", { outcome: "parse_fallback", durationMs: reviewSpan.elapsed() });
    return;
  }
  obs.info("review.parse", "审查结果解析成功", { status: "ok", issues: result.issues.length });
  const filtered = filterByMinSeverity(result, repoConfig.min_severity);
  filtered.issues = validateIssueLines(filtered.issues, reviewable);
  const counts = { critical: 0, important: 0, normal: 0 };
  for (const i of filtered.issues) counts[i.severity]++;

  // block_on_critical：存在 critical 时设置状态阻断合并，无则置成功
  if (repoConfig.block_on_critical) {
    if (headSha) {
      await setCriticalStatus(headSha, counts.critical);
    }
  }

  const L = LABELS[LANGUAGE] || LABELS.en;
  const body = renderReport(stats, renderMarkdown(filtered, LANGUAGE), filtered, LANGUAGE);
  const comments = filtered.issues
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

  if (comments.length === 0) {
    await postReview(body);
  } else {
    try {
      await postReviewWithComments(body, comments);
    } catch (err) {
      obs.error("review.error", `行内评论发布失败，降级为整体报告：${err.message}`, { reason: "post_inline_failed" });
      await postReview(body);
    }
  }

  // 标记该 commit 已完成海姆达尔审查
  if (headSha) {
    try {
      await gh(`/repos/${owner}/${repo}/statuses/${headSha}`, {
        method: "POST",
        body: { state: "success", context: "heimdall/reviewed", description: "已完成海姆达尔审查" },
      });
    } catch (err) {
      // 忽略权限缺失
    }
  }

  obs.info("review.post", "审查已发布", counts);
  obs.invocation("review.invocation", "审查完成", { outcome: "posted", durationMs: reviewSpan.elapsed(), ...counts });
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
  const lines = text.split(/\r?\n/);
  const parsed = parseObject(lines, 0, -1);
  return parsed.value || {};
}

function lineIndent(line) {
  const m = /^(\s*)\S/.exec(line);
  return m ? m[1].length : -1;
}

function parseObject(lines, start, parentIndent, depth) {
  if (depth === undefined) depth = 0;
  if (depth > 50) return { value: {}, next: start }; // 深度保护：避免病态嵌套导致栈溢出
  const obj = {};
  let i = start;
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith("#")) { i++; continue; }
    const indent = lineIndent(lines[i]);
    if (indent <= parentIndent) break;
    const match = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(trimmed);
    if (!match) { i++; continue; }
    const key = match[1];
    const rest = match[2].trim();
    i++;

    if (rest === "|") {
      const block = [];
      // 块文本：保留内部空行，直到遇到缩进 <= 键的行（或结尾）才结束
      while (i < lines.length) {
        const li = lineIndent(lines[i]);
        if (li === -1) {
          block.push("");
          i++;
          continue;
        }
        if (li > indent) {
          block.push(lines[i].replace(/^\s+/, ""));
          i++;
          continue;
        }
        break;
      }
      while (block.length && block[block.length - 1] === "") block.pop();
      if (block.length) obj[key] = block.join("\n");
      continue;
    }
    if (rest.startsWith("[")) {
      const inner = rest.slice(1, rest.lastIndexOf("]"));
      obj[key] = inner.split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
      continue;
    }
    if (rest === "") {
      // 先跳过空行与注释，再判断子值是列表还是嵌套 map
      let j = i;
      while (j < lines.length) {
        const t = lines[j].trim();
        if (t === "" || t.startsWith("#")) {
          j++;
          continue;
        }
        break;
      }
      if (j < lines.length) {
        const nIndent = lineIndent(lines[j]);
        if (nIndent > indent && /^\s*-/.test(lines[j])) {
          const items = [];
          let k = j;
          while (k < lines.length && lineIndent(lines[k]) > indent && /^\s*-/.test(lines[k])) {
            items.push(lines[k].replace(/^\s*-\s*/, "").trim().replace(/^["']|["']$/g, ""));
            k++;
          }
          obj[key] = items;
          i = k;
          continue;
        }
        if (nIndent > indent && /^[A-Za-z_][\w-]*:/.test(lines[j].trim())) {
          const sub = parseObject(lines, j, indent, depth + 1);
          obj[key] = sub.value;
          i = sub.next;
          continue;
        }
      }
      obj[key] = undefined;
      continue;
    }
    obj[key] = parseScalar(rest);
  }
  return { value: obj, next: i };
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
  const cleanLogin = String(login).replace(/^@/, "").trim().toLowerCase();
  return whitelist.some((name) => String(name).replace(/^@/, "").trim().toLowerCase() === cleanLogin);
}

const SEVERITY_RANK = { critical: 3, important: 2, normal: 1 };

function filterByMinSeverity(result, minSeverity) {
  if (!minSeverity) return result;
  const min = SEVERITY_RANK[minSeverity];
  return {
    summary: result.summary,
    focusAreas: result.focusAreas,
    verificationSteps: result.verificationSteps,
    issues: result.issues.filter((i) => SEVERITY_RANK[i.severity] >= min),
  };
}

// 解析 diff patch，返回新增行行号集合，用于校验 LLM 行号
function parsePatchLines(patch) {
  const lines = new Set();
  let newLine = 0;
  for (const raw of String(patch).split("\n")) {
    const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (m) {
      newLine = Number(m[2]);
      continue;
    }
    if (raw.startsWith("+") && !raw.startsWith("+++")) {
      lines.add(newLine);
      newLine++;
    } else if (raw.startsWith("-") && !raw.startsWith("---")) {
      // 删除行
    } else if (raw.startsWith("\\")) {
      // no newline 标记
    } else {
      newLine++;
    }
  }
  return lines;
}

// 行号不在 diff 新增行集合中的 issue 归 0（只进报告，不生成行内评论）
function validateIssueLines(issues, files) {
  const valid = new Map();
  for (const f of files) if (f.patch) valid.set(f.filename, parsePatchLines(f.patch));
  return issues.map((i) => (i.line > 0 && valid.get(i.file) && valid.get(i.file).has(i.line) ? i : { ...i, line: 0 }));
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
      const data = parseLooseJson(c);
      if (typeof data === "object" && data !== null) {
        const issues = Array.isArray(data.issues)
          ? data.issues.map(normalizeIssue).filter(Boolean)
          : [];
        const rawFocus = Array.isArray(data.focus_areas) ? data.focus_areas : Array.isArray(data.focusAreas) ? data.focusAreas : [];
        const focusAreas = rawFocus.map(String).filter(Boolean);
        const rawSteps = Array.isArray(data.verification_steps) ? data.verification_steps : Array.isArray(data.verificationSteps) ? data.verificationSteps : [];
        const verificationSteps = rawSteps.map(String).filter(Boolean);

        const result = {
          summary: typeof data.summary === "string" ? data.summary : "",
          issues,
        };
        if (focusAreas.length > 0) result.focusAreas = focusAreas;
        if (verificationSteps.length > 0) result.verificationSteps = verificationSteps;
        return result;
      }
    } catch (err) {
      // 该候选解析失败，尝试下一个
    }
  }
  return null;
}

// 宽松 JSON 解析：修复字符串字面量中的未转义换行（LLM 输出常见）
function parseLooseJson(text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    let out = "";
    let inStr = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        if (c === "\\") {
          out += c + (text[i + 1] || "");
          i++;
          continue;
        }
        if (c === '"') inStr = false;
        if (c === "\n" || c === "\r") {
          out += "\\n";
          continue;
        }
        out += c;
      } else {
        if (c === '"') inStr = true;
        out += c;
      }
    }
    return JSON.parse(out);
  }
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
  const suggestionCode = typeof raw.suggestion_code === "string"
    ? raw.suggestion_code.trim()
    : typeof raw.suggestionCode === "string"
    ? raw.suggestionCode.trim()
    : "";
  const diff = typeof raw.diff === "string" ? raw.diff.trim() : "";
  if (!file || !comment) return null;
  const issue = { severity, file, line: line > 0 ? line : 0, comment };
  if (suggestion) issue.suggestion = suggestion;
  if (suggestionCode) issue.suggestionCode = suggestionCode;
  if (diff) issue.diff = diff;
  return issue;
}

function renderMarkdown(result, language = LANGUAGE) {
  const L = LABELS[language] || LABELS.en;
  const lines = [];
  if (result.summary) {
    lines.push(L.overview, result.summary, "");
  }

  if (result.focusAreas && result.focusAreas.length > 0) {
    lines.push(L.focusAreas);
    for (const area of result.focusAreas) {
      lines.push(`- ${area}`);
    }
    lines.push("");
  }

  if (result.verificationSteps && result.verificationSteps.length > 0) {
    lines.push(L.verification);
    for (const step of result.verificationSteps) {
      lines.push(`- [ ] ${step}`);
    }
    lines.push("");
  }

  lines.push("<details>", `<summary>${L.reviewComments}</summary>`, "");

  const inlineIssues = result.issues.filter((i) => i.line > 0);
  const orphanIssues = result.issues.filter((i) => i.line === 0);
  if (inlineIssues.length > 0) {
    lines.push(L.tableHeader, "| :---: | --- | --- | :---: |");
    for (const i of inlineIssues) {
      const fixStatus = i.suggestionCode ? L.fixClick : i.diff ? L.fixDiff : L.fixNote;
      lines.push(`| ${SEVERITY_ICONS[i.severity]} | \`${i.file}:${i.line}\` | ${i.comment} | ${fixStatus} |`);
    }
    lines.push("");
  }
  for (const sev of SEVERITIES) {
    const group = orphanIssues.filter((i) => i.severity === sev);
    if (group.length === 0) continue;
    lines.push(L.severity[sev], "");
    for (const i of group) {
      lines.push(`- **\`${i.file}\`**：${i.comment}`);
      if (i.suggestion) lines.push(`  > ${L.suggestion}：${i.suggestion}`);
      if (i.suggestionCode) {
        lines.push("", "  ```suggestion");
        for (const dl of String(i.suggestionCode).split("\n")) lines.push(dl ? "  " + dl : "  ");
        lines.push("  ```");
      } else if (i.diff) {
        lines.push("", "  ```diff");
        for (const dl of String(i.diff).split("\n")) lines.push(dl ? "  " + dl : "  ");
        lines.push("  ```");
      }
    }
    lines.push("");
  }
  if (result.issues.length === 0) lines.push(L.noIssues, "");
  lines.push("</details>");
  return lines.join("\n").trim();
}

const SEVERITY_ICONS = { critical: "🔴", important: "🟡", normal: "🟢" };

const LABELS = {
  en: {
    overview: "### 📖 Overview",
    focusAreas: "#### 🎯 Focus Areas",
    verification: "### 🧪 Suggested Regression Tests",
    reviewComments: "🔍 Review Comments & Issues",
    tableHeader: "| Severity | Location | Issue | Fix Support |",
    fixClick: "⚡ 1-Click Suggestion",
    fixDiff: "💡 Diff Provided",
    fixNote: "📝 Note",
    suggestion: "💡 Suggestion",
    noIssues: "No significant issues found.",
    severity: { critical: "### 🔴 Critical", important: "### 🟡 Important", normal: "### 🟢 Normal" },
    reportTitle: "🛡️ Heimdall · Code Review Report",
    reportSubtitle: "*\"Guard every line, watch the gate\"*",
    status: "Status", risk: "Risk", scale: "Change",
    statusBlock: "🔴 **BLOCK MERGE**", statusAttention: "🟡 **Needs Attention**", statusPass: "🟢 **Pass**",
    filesDetail: "File Changes", fileCol: "File", changeCol: "Change",
    reviewInfo: "Review Info", filesReviewed: "Files reviewed", changeSize: "Change size",
    guardian: "Guardian persona", noChange: "No reviewable code changes in this PR.",
    reviewFailed: "Review failed", fixSuggestion: "Fix Suggestion",
  },
  zh: {
    overview: "### 📖 变更概述",
    focusAreas: "#### 🎯 重点复核领域",
    verification: "### 🧪 建议回归测试清单",
    reviewComments: "🔍 审查评论与问题清单",
    tableHeader: "| 严重度 | 位置 | 问题 | 修复支持 |",
    fixClick: "⚡ 1-Click Suggestion",
    fixDiff: "💡 附 Diff 代码",
    fixNote: "📝 说明",
    suggestion: "💡 建议",
    noIssues: "未发现明显问题。",
    severity: { critical: "### 🔴 严重问题", important: "### 🟡 建议改进", normal: "### 🟢 良好实践" },
    reportTitle: "🛡️ 海姆达尔 (Heimdall) · 代码审查报告",
    reportSubtitle: "*\"看穿每一行代码，守护合并之门\"*",
    status: "审查状态", risk: "风险分布", scale: "变更规模",
    statusBlock: "🔴 **阻断合并**", statusAttention: "🟡 **需关注**", statusPass: "🟢 **可以通过**",
    filesDetail: "文件变更明细", fileCol: "文件", changeCol: "变更规模",
    reviewInfo: "审查环境与元数据", filesReviewed: "审查文件", changeSize: "变更规模",
    guardian: "守护者人设", noChange: "本次 PR 没有可审查的代码变更。",
    reviewFailed: "审查失败", fixSuggestion: "修复建议",
  },
  bilingual: {
    overview: "### 📖 Overview / 变更概述",
    focusAreas: "#### 🎯 Focus Areas / 重点复核领域",
    verification: "### 🧪 Suggested Regression Tests / 建议回归测试清单",
    reviewComments: "🔍 Review Comments & Issues / 审查评论与问题清单",
    tableHeader: "| Severity / 严重度 | Location / 位置 | Issue / 问题 | Fix / 修复支持 |",
    fixClick: "⚡ 1-Click Suggestion",
    fixDiff: "💡 Diff Provided / 附 Diff",
    fixNote: "📝 Note / 说明",
    suggestion: "💡 Suggestion / 建议",
    noIssues: "No significant issues found. / 未发现明显问题。",
    severity: { critical: "### 🔴 Critical / 严重问题", important: "### 🟡 Important / 建议改进", normal: "### 🟢 Normal / 良好实践" },
    reportTitle: "🛡️ Heimdall · Code Review Report / 海姆达尔代码审查报告",
    reportSubtitle: "*\"Guard every line, watch the gate\" / \"看穿每一行代码，守护合并之门\"*",
    status: "Status / 审查状态", risk: "Risk / 风险分布", scale: "Change / 变更规模",
    statusBlock: "🔴 **BLOCK MERGE / 阻断合并**", statusAttention: "🟡 **Needs Attention / 需关注**", statusPass: "🟢 **Pass / 可以通过**",
    filesDetail: "File Changes / 文件变更明细", fileCol: "File / 文件", changeCol: "Change / 变更规模",
    reviewInfo: "Review Info / 审查环境与元数据", filesReviewed: "Files reviewed / 审查文件", changeSize: "Change size / 变更规模",
    guardian: "Guardian / 守护者人设", noChange: "No reviewable code changes. / 本次 PR 没有可审查的代码变更。",
    reviewFailed: "Review failed / 审查失败", fixSuggestion: "Fix Suggestion / 修复建议",
  },
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

function renderReport(stats, content, result, language = LANGUAGE, noChangeMessage) {
  const L = LABELS[language] || LABELS.en;
  const issues = (result && result.issues) || [];
  const critical = issues.filter((i) => i.severity === "critical").length;
  const important = issues.filter((i) => i.severity === "important").length;
  const normal = issues.filter((i) => i.severity === "normal").length;

  const statusBadge = critical > 0 ? L.statusBlock : important > 0 ? L.statusAttention : L.statusPass;
  const issueCounts = `🔴 **${critical} Critical** · 🟡 **${important} Important** · 🟢 **${normal} Normal**`;
  const scale = `🟢 +${stats.additions} / 🔴 -${stats.deletions} (${stats.files})`;

  const table =
    stats.fileDetails && stats.fileDetails.length > 0
      ? `\n### 📝 ${L.filesDetail}\n\n| ${L.fileCol} | ${L.changeCol} |\n| --- | :---: |\n` +
        stats.fileDetails.map((f) => `| \`${f.filename}\` | 🟢 +${f.additions} / 🔴 -${f.deletions} |`).join("\n")
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

main().catch((err) => {
  console.error("海姆达尔审查失败：", err);
  process.exit(1);
});
