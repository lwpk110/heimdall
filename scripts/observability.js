#!/usr/bin/env node
/**
 * 海姆达尔 (Heimdall) 可观测性模块 —— GitHub Actions 模式镜像
 *
 * 与 src/observability.ts 同逻辑（CommonJS 零依赖），改动需同步。
 * 由 scripts/heimdall-review.js require 使用，随其一起复制到被审查的仓库。
 */
"use strict";

const LEVEL_RANK = { error: 0, warn: 1, info: 2, debug: 3 };

/** 从 process.env 解析默认配置 */
function resolveObserverOptions(mode, env) {
  const levelRaw = String((env && env.HEIMDALL_LOG_LEVEL) || "info").toLowerCase();
  const level = levelRaw in LEVEL_RANK ? levelRaw : "info";
  return {
    mode,
    enabled: (env && env.HEIMDALL_LOG_ENABLED) !== "false",
    invocationLogs: (env && env.HEIMDALL_INVOCATION_LOGS) !== "false",
    level,
  };
}

/** 应用仓库级 observability 覆盖（shape: { enabled?, invocation_logs? }），未配置时保持原样 */
function applyLogOverrides(obs, overrides) {
  if (!overrides) return obs;
  if (overrides.enabled === undefined && overrides.invocation_logs === undefined) return obs;
  return obs.apply({ enabled: overrides.enabled, invocationLogs: overrides.invocation_logs });
}

function createObserver(options) {
  const mode = options.mode;
  const enabled = options.enabled !== false;
  const invocationLogs = options.invocationLogs !== false;
  const level = options.level || "info";
  const context = options.context || {};

  function shouldEmit(lvl) {
    return LEVEL_RANK[lvl] <= LEVEL_RANK[level];
  }

  function emit(lvl, event, msg, fields) {
    const line = Object.assign({ ts: new Date().toISOString(), level: lvl, event, mode }, context, fields, { msg });
    if (lvl === "error") console.error(JSON.stringify(line));
    else console.log(JSON.stringify(line));
  }

  function emitInfo(event, msg, fields) {
    if (enabled && shouldEmit("info")) emit("info", event, msg, fields);
  }

  function start() {
    const started = Date.now();
    return {
      finish: (event, fields) => emitInfo(event, "", Object.assign({}, fields, { durationMs: Date.now() - started })),
      elapsed: () => Date.now() - started,
    };
  }

  return {
    get level() {
      return level;
    },
    get enabled() {
      return enabled;
    },
    get invocationLogs() {
      return invocationLogs;
    },
    child(next) {
      return createObserver({ mode, enabled, invocationLogs, level, context: Object.assign({}, context, next) });
    },
    apply(overrides) {
      return createObserver({
        mode,
        enabled: overrides.enabled !== undefined ? overrides.enabled : enabled,
        invocationLogs: overrides.invocationLogs !== undefined ? overrides.invocationLogs : invocationLogs,
        level: overrides.level || level,
        context: Object.assign({}, context, overrides.context),
      });
    },
    start,
    info: (event, msg, fields) => emitInfo(event, msg, fields),
    debug: (event, msg, fields) => {
      if (enabled && shouldEmit("debug")) emit("debug", event, msg, fields);
    },
    warn: (event, msg, fields) => {
      if (shouldEmit("warn")) emit("warn", event, msg, fields);
    },
    error: (event, msg, fields) => emit("error", event, msg, fields),
    invocation: (event, msg, fields) => {
      if (invocationLogs) emit("info", event, msg, fields);
    },
  };
}

/** 生成一次审查的关联 ID */
function newReviewId() {
  return "h-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

module.exports = { createObserver, resolveObserverOptions, applyLogOverrides, newReviewId };
