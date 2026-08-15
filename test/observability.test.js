// 可观测性模块测试（针对编译后的 lib/observability.js）
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  createObserver,
  resolveObserverOptions,
  applyLogOverrides,
  newReviewId,
} = require("../lib/observability.js");

/** 捕获 console.log/error 输出（observer 方法均为同步调用） */
function captureLogs(fn) {
  const logs = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (line) => logs.push({ level: "log", line });
  console.error = (line) => logs.push({ level: "error", line });
  try {
    fn();
  } finally {
    console.log = origLog;
    console.error = origError;
  }
  return logs;
}

/** 执行 fn 并断言只输出一行，返回解析后的 JSON 行 */
function lineFor(fn) {
  const logs = captureLogs(fn);
  assert.equal(logs.length, 1, `期望 1 行日志，实际 ${logs.length} 行: ${JSON.stringify(logs)}`);
  return JSON.parse(logs[0].line);
}

test("JSON-lines：单行可解析，含 ts/level/event/mode/msg 与自定义字段", () => {
  const line = lineFor(() => createObserver({ mode: "probot" }).info("review.start", "开始审查", { pr: 12 }));
  assert.equal(line.event, "review.start");
  assert.equal(line.level, "info");
  assert.equal(line.mode, "probot");
  assert.equal(line.msg, "开始审查");
  assert.equal(line.pr, 12);
  assert.ok(typeof line.ts === "string" && !Number.isNaN(Date.parse(line.ts)));
});

test("级别过滤：info 时 debug 被过滤，error 恒输出", () => {
  const logs = captureLogs(() => {
    const obs = createObserver({ mode: "test", level: "info" });
    obs.info("a", "i");
    obs.debug("b", "d");
    obs.warn("c", "w");
    obs.error("d", "e");
  });
  assert.deepEqual(logs.map((l) => JSON.parse(l.line).event), ["a", "c", "d"]);
});

test("级别过滤：debug 级别输出 info 与 debug", () => {
  const logs = captureLogs(() => {
    const obs = createObserver({ mode: "test", level: "debug" });
    obs.debug("a", "d");
    obs.info("b", "i");
  });
  assert.deepEqual(logs.map((l) => JSON.parse(l.line).event), ["a", "b"]);
});

test("Span.finish 自动带 durationMs", () => {
  const line = lineFor(() => {
    const obs = createObserver({ mode: "test" });
    const span = obs.start();
    span.finish("llm.done", { status: "ok" });
  });
  assert.equal(line.event, "llm.done");
  assert.equal(line.status, "ok");
  assert.ok(typeof line.durationMs === "number" && line.durationMs >= 0);
});

test("enabled=false：info 被关，error 与 invocation 仍输出", () => {
  const logs = captureLogs(() => {
    const obs = createObserver({ mode: "test", enabled: false });
    obs.info("a", "i");
    obs.error("b", "e");
    obs.invocation("c", "s");
  });
  assert.deepEqual(logs.map((l) => JSON.parse(l.line).event), ["b", "c"]);
});

test("invocationLogs=false：invocation 被关，error 仍输出", () => {
  const logs = captureLogs(() => {
    const obs = createObserver({ mode: "test", invocationLogs: false });
    obs.invocation("a", "s");
    obs.error("b", "e");
  });
  assert.deepEqual(logs.map((l) => JSON.parse(l.line).event), ["b"]);
});

test("child 绑定上下文，父 observer 不受影响", () => {
  const logs = captureLogs(() => {
    const base = createObserver({ mode: "test" });
    base.info("a", "parent");
    base.child({ repo: "octo/app", pr: 3, reviewId: "h-1" }).info("b", "child");
  });
  const parsed = logs.map((l) => JSON.parse(l.line));
  assert.equal(parsed[0].repo, undefined);
  assert.equal(parsed[1].repo, "octo/app");
  assert.equal(parsed[1].pr, 3);
  assert.equal(parsed[1].reviewId, "h-1");
});

test("applyLogOverrides：覆盖 enabled，未配置保持原样", () => {
  const logs = captureLogs(() => {
    const base = createObserver({ mode: "test", enabled: true });
    applyLogOverrides(base, undefined).info("a", "kept");
    applyLogOverrides(base, { enabled: false }).info("b", "off");
    applyLogOverrides(base, { invocation_logs: false }).error("c", "err");
  });
  assert.deepEqual(logs.map((l) => JSON.parse(l.line).event), ["a", "c"]);
});

test("resolveObserverOptions：默认值与 env 覆盖", () => {
  assert.deepEqual(resolveObserverOptions("worker", {}), {
    mode: "worker",
    enabled: true,
    invocationLogs: true,
    level: "info",
  });
  const opts = resolveObserverOptions("worker", {
    HEIMDALL_LOG_ENABLED: "false",
    HEIMDALL_INVOCATION_LOGS: "false",
    HEIMDALL_LOG_LEVEL: "debug",
  });
  assert.equal(opts.enabled, false);
  assert.equal(opts.invocationLogs, false);
  assert.equal(opts.level, "debug");
  assert.equal(resolveObserverOptions("worker", { HEIMDALL_LOG_LEVEL: "verbose" }).level, "info");
});

test("newReviewId 前缀", () => {
  assert.match(newReviewId(), /^h-[a-z0-9]+$/);
});
