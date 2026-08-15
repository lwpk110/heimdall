// 仓库配置模块测试（针对编译后的 lib/review/repo-config.js）
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  parseHeimdallConfig,
  matchesAnyGlob,
  filterFiles,
  filterByMinSeverity,
} = require("../lib/review/repo-config.js");

test("parseHeimdallConfig：标量 / 内联数组 / 块列表 / 块文本 / 注释", () => {
  const yaml = `# 注释行应被忽略
version: 1
include: ["*.ts", "*.js"]
exclude:
  - "**/generated/**"
  - "**/package-lock.json"
min_severity: important
block_on_critical: true
manual_reviewers:
  - octocat
  - steven
instructions: |
  禁止使用 any。
  必须处理错误。`;
  const cfg = parseHeimdallConfig(yaml);
  assert.equal(cfg.version, 1);
  assert.deepEqual(cfg.include, ["*.ts", "*.js"]);
  assert.deepEqual(cfg.exclude, ["**/generated/**", "**/package-lock.json"]);
  assert.equal(cfg.min_severity, "important");
  assert.equal(cfg.block_on_critical, true);
  assert.deepEqual(cfg.manual_reviewers, ["octocat", "steven"]);
  assert.ok(cfg.instructions.includes("禁止使用 any"));
  assert.ok(cfg.instructions.includes("必须处理错误。"));
});

test("parseHeimdallConfig：未知键与空值忽略", () => {
  const cfg = parseHeimdallConfig("trigger:\n  - on_open\nunknown_key: x\n");
  assert.equal(cfg.trigger, undefined);
  assert.equal(cfg.unknown_key, undefined);
});

test("parseHeimdallConfig：引号剥离与布尔/数字", () => {
  const cfg = parseHeimdallConfig("instructions: '单引号文本'\nmin_severity: critical\nblock_on_critical: false");
  assert.equal(cfg.instructions, "单引号文本");
  assert.equal(cfg.min_severity, "critical");
  assert.equal(cfg.block_on_critical, false);
});

test("glob：** 跨目录、* 限单层、? 单字符、无斜杠模式匹配文件名", () => {
  assert.equal(matchesAnyGlob("src/generated/schema.ts", ["**/generated/**"]), true);
  assert.equal(matchesAnyGlob("public/app.min.js", ["**/*.min.js"]), true);
  // 无斜杠模式按文件名匹配任意层级（友好语义：*.ts 表示所有 .ts 文件）
  assert.equal(matchesAnyGlob("src/auth.ts", ["*.ts"]), true);
  assert.equal(matchesAnyGlob("src/deep/auth.ts", ["*.ts"]), true);
  // 带目录的模式按完整路径匹配
  assert.equal(matchesAnyGlob("src/deep/auth.ts", ["src/*.ts"]), false);
  assert.equal(matchesAnyGlob("src/deep/auth.ts", ["**/*.ts"]), true);
  assert.equal(matchesAnyGlob("src/a.ts", ["src/?.ts"]), true);
  assert.equal(matchesAnyGlob("src/ab.ts", ["src/?.ts"]), false);
});

test("glob：正则元字符转义", () => {
  assert.equal(matchesAnyGlob("a.b.ts", ["a.b.ts"]), true);
  assert.equal(matchesAnyGlob("axb.ts", ["a.b.ts"]), false);
});

test("filterFiles：include/exclude 过滤，exclude 优先", () => {
  const cfg = parseHeimdallConfig("include: [\"*.ts\"]\nexclude: [\"**/generated/**\"]");
  const files = [
    { filename: "src/auth.ts" },
    { filename: "src/generated/gen.ts" },
    { filename: "README.md" },
  ];
  const kept = filterFiles(files, cfg).map((f) => f.filename);
  assert.deepEqual(kept, ["src/auth.ts"]);
});

test("filterFiles：未配置时不过滤", () => {
  const files = [{ filename: "a.ts" }, { filename: "b.md" }];
  assert.equal(filterFiles(files, {}).length, 2);
});

test("filterByMinSeverity：按阈值过滤", () => {
  const result = {
    summary: "s",
    issues: [
      { severity: "critical", file: "a", line: 1, comment: "c" },
      { severity: "important", file: "b", line: 2, comment: "i" },
      { severity: "normal", file: "c", line: 3, comment: "n" },
    ],
  };
  assert.equal(filterByMinSeverity(result, "important").issues.length, 2);
  assert.equal(filterByMinSeverity(result, "critical").issues.length, 1);
  assert.equal(filterByMinSeverity(result, undefined).issues.length, 3);
});

test("parseHeimdallConfig：行尾注释剥离与 @ 前缀清洗", () => {
  const yaml = `
block_on_critical: true # 阻断合并
min_severity: important # 最小严重度
manual_reviewers:
  - "@octocat"
  - "@steven"
`;
  const cfg = parseHeimdallConfig(yaml);
  assert.equal(cfg.block_on_critical, true);
  assert.equal(cfg.min_severity, "important");
  assert.deepEqual(cfg.manual_reviewers, ["octocat", "steven"]);
});
