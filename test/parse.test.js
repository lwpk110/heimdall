// 审查内核解析层测试（针对编译后的 lib/review/parse.js）
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseReview, renderMarkdown } = require("../lib/review/parse.js");

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
  const md = renderMarkdown(result);
  assert.ok(md.includes("### 🔴 严重问题"));
  assert.ok(md.includes("### 🟢 良好实践"));
  // critical 在 normal 之前
  assert.ok(md.indexOf("🔴") < md.indexOf("🟢"));
  // line 0 的文件不带行号
  assert.ok(md.includes("`a.ts`**：风格"));
  assert.ok(md.includes("`b.ts:5`**：严重"));
});

test("parseReview：suggestion 字段解析与渲染", () => {
  const raw = JSON.stringify({
    summary: "s",
    issues: [{ severity: "critical", file: "a.ts", line: 0, comment: "问题", suggestion: "修复建议" }],
  });
  const result = parseReview(raw);
  assert.equal(result.issues[0].suggestion, "修复建议");
  const md = renderMarkdown(result);
  assert.ok(md.includes("💡 建议：修复建议"));
  // line>0 的问题详情在行内评论，body 不显示 suggestion（避免重复）
  const md3 = renderMarkdown({ summary: "", issues: [{ severity: "critical", file: "b.ts", line: 5, comment: "c", suggestion: "s" }] });
  assert.ok(!md3.includes("💡 建议"));
});

test("parseReview：diff 字段解析与渲染", () => {
  const raw = JSON.stringify({
    summary: "s",
    issues: [{ severity: "important", file: "b.ts", line: 0, comment: "c", diff: "- const x = 1;\n+ const x = 2;" }],
  });
  const result = parseReview(raw);
  assert.equal(result.issues[0].diff, "- const x = 1;\n+ const x = 2;");
  const md = renderMarkdown(result);
  assert.ok(md.includes("```diff"));
  assert.ok(md.includes("- const x = 1;"));
  assert.ok(md.includes("+ const x = 2;"));
  // line>0 的问题 diff 详情在行内评论，body 不显示（避免重复）
  const md3 = renderMarkdown({ summary: "", issues: [{ severity: "normal", file: "a.ts", line: 1, comment: "c", diff: "- x\n+ y" }] });
  assert.ok(!md3.includes("```diff"));
  // 无 diff 时不渲染代码块
  const md2 = renderMarkdown({ summary: "", issues: [{ severity: "normal", file: "a.ts", line: 1, comment: "c" }] });
  assert.ok(!md2.includes("```diff"));
});

test("renderMarkdown：空 issue 输出提示", () => {
  const md = renderMarkdown({ summary: "", issues: [] });
  assert.ok(md.includes("未发现明显问题"));
});
