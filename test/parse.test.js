// 审查内核解析层测试（针对编译后的 lib/review/parse.js）
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseReview, renderMarkdown, formatSafeDiff } = require("../lib/review/parse.js");

test("parseReview：标准 JSON 解析", () => {
  const raw = JSON.stringify({
    summary: "重构认证模块",
    issues: [
      { severity: "critical", file: "src/a.ts", line: 45, comment: "越权风险" },
    ],
  });
  const result = parseReview(raw);
  assert.ok(result);
  assert.equal(result.summary, "重构认证模块");
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].severity, "critical");
  assert.equal(result.issues[0].line, 45);
});

test("parseReview：JSON 被代码块包裹仍可解析", () => {
  const raw = "```json\n{\"summary\":\"s\",\"issues\":[]}\n```";
  const result = parseReview(raw);
  assert.ok(result);
  assert.equal(result.summary, "s");
});

test("parseReview：JSON 前后有杂讯文字仍可解析", () => {
  const raw = `好的，审查结果如下：\n{"summary":"s","issues":[{"severity":"important","file":"b.ts","line":3,"comment":"c"}]}\n以上。`;
  const result = parseReview(raw);
  assert.ok(result);
  assert.equal(result.issues[0].file, "b.ts");
});

test("parseReview：非 JSON 返回 null", () => {
  assert.equal(parseReview("### 严重问题\n这不是 JSON"), null);
  assert.equal(parseReview(""), null);
  assert.equal(parseReview("{broken"), null);
});

test("parseReview：非法 issue 条目被过滤，缺失字段容错", () => {
  const raw = JSON.stringify({
    summary: "s",
    issues: [
      { severity: "critical", file: "a.ts", line: 1, comment: "ok" },
      { severity: "unknown", file: "b.ts", line: 2, comment: "severity 兜底为 important" },
      { file: "c.ts", comment: "缺少 severity，兜底为 important" },
      { severity: "normal", comment: "缺少 file" },
      { severity: "normal", file: "d.ts" },
    ],
  });
  const result = parseReview(raw);
  // 3 条有效：前三条保留（severity 兜底 important），缺 file / 缺 comment 的被过滤
  assert.equal(result.issues.length, 3);
  assert.equal(result.issues[0].severity, "critical");
  assert.equal(result.issues[1].severity, "important");
  assert.equal(result.issues[2].severity, "important");
});

test("parseReview：line 为 0 或负数时归零", () => {
  const raw = JSON.stringify({
    summary: "",
    issues: [{ severity: "normal", file: "a.ts", line: -3, comment: "c" }],
  });
  assert.equal(parseReview(raw).issues[0].line, 0);
});

test("renderMarkdown：按严重度分组，line 0 不带行号", () => {
  const result = {
    summary: "变更概述",
    issues: [
      { severity: "normal", file: "a.ts", line: 0, comment: "风格" },
      { severity: "critical", file: "b.ts", line: 5, comment: "严重" },
    ],
  };
  const md = renderMarkdown(result, "zh");
  // line>0 的问题进表格汇总
  assert.ok(md.includes("| 严重度 | 位置 | 问题 |"));
  assert.ok(md.includes("🔴"));
  assert.ok(md.includes("`b.ts:5`"));
  // line=0 的问题在分级标题下
  assert.ok(md.includes("### 🟢 良好实践"));
  assert.ok(md.includes("`a.ts`**：风格"));
});

test("parseReview：suggestion 字段解析与渲染", () => {
  const raw = JSON.stringify({
    summary: "s",
    issues: [{ severity: "critical", file: "a.ts", line: 0, comment: "问题", suggestion: "修复建议" }],
  });
  const result = parseReview(raw);
  assert.equal(result.issues[0].suggestion, "修复建议");
  const md = renderMarkdown(result, "zh");
  assert.ok(md.includes("💡 建议：修复建议"));
  // line>0 的问题详情在行内评论，body 不显示 suggestion（避免重复）
  const md3 = renderMarkdown({ summary: "", issues: [{ severity: "critical", file: "b.ts", line: 5, comment: "c", suggestion: "s" }] }, "zh");
  assert.ok(!md3.includes("💡 建议"));
});

test("parseReview：diff 字段解析与渲染", () => {
  const raw = JSON.stringify({
    summary: "s",
    issues: [{ severity: "important", file: "b.ts", line: 0, comment: "c", diff: "- const x = 1;\n+ const x = 2;" }],
  });
  const result = parseReview(raw);
  assert.equal(result.issues[0].diff, "- const x = 1;\n+ const x = 2;");
  const md = renderMarkdown(result, "zh");
  assert.ok(md.includes("```diff"));
  assert.ok(md.includes("- const x = 1;"));
  assert.ok(md.includes("+ const x = 2;"));
  // line>0 的问题 diff 详情在行内评论，body 不显示（避免重复）
  const md3 = renderMarkdown({ summary: "", issues: [{ severity: "normal", file: "a.ts", line: 1, comment: "c", diff: "- x\n+ y" }] }, "zh");
  assert.ok(!md3.includes("```diff"));
  // 无 diff 时不渲染代码块
  const md2 = renderMarkdown({ summary: "", issues: [{ severity: "normal", file: "a.ts", line: 1, comment: "c" }] }, "zh");
  assert.ok(!md2.includes("```diff"));
});

test("renderMarkdown：空 issue 输出提示", () => {
  const md = renderMarkdown({ summary: "", issues: [] }, "zh");
  assert.ok(md.includes("未发现明显问题"));
});

test("parseReview：focus_areas, verification_steps 与 suggestion_code 解析渲染", () => {
  const raw = JSON.stringify({
    summary: "重构登录体系",
    focus_areas: ["🔒 安全性：JWT 机制", "⚙️ 核心逻辑"],
    verification_steps: ["运行单元测试", "验证 Token 过期"],
    issues: [
      {
        severity: "critical",
        file: "src/auth.ts",
        line: 10,
        comment: "缺失过期限制",
        suggestion_code: "const t = jwt.sign(payload, key, { expiresIn: '1h' });",
      },
    ],
  });
  const result = parseReview(raw);
  assert.ok(result);
  assert.equal(result.focusAreas.length, 2);
  assert.equal(result.verificationSteps.length, 2);
  assert.equal(result.issues[0].suggestionCode, "const t = jwt.sign(payload, key, { expiresIn: '1h' });");

  const md = renderMarkdown(result, "zh");
  assert.ok(md.includes("🎯 重点复核领域"));
  assert.ok(md.includes("🔒 安全性：JWT 机制"));
  assert.ok(md.includes("🧪 建议回归测试清单"));
  assert.ok(md.includes("[ ] 验证 Token 过期"));
  assert.ok(md.includes("⚡ 1-Click Suggestion"));
});

test("formatSafeDiff：按文件与行边界安全截断与提示", () => {
  const files = [
    { filename: "a.ts", patch: "+ const line1 = 1;\n+ const line2 = 2;\n+ const line3 = 3;" },
    { filename: "b.ts", patch: "+ const b1 = 1;" },
  ];
  // 限制长度较小时，不破坏 ```diff 代码块结构，且添加截断提示
  const res = formatSafeDiff(files, 80);
  assert.ok(res.includes("### a.ts"));
  assert.ok(res.includes("```diff"));
  assert.ok(res.includes("```"));
  assert.ok(res.includes("⚠️ Diff 规模过大"));
});
