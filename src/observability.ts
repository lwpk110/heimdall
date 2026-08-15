/**
 * Heimdall 可观测性模块（零依赖，JSON-lines 结构化日志）
 *
 * 三种运行时共用：
 * - Probot（Node）：import 本模块
 * - Cloudflare Workers：import 本模块（仅依赖 console/Date/JSON/Math，nodejs_compat 无需额外包）
 * - GitHub Actions：scripts/observability.js 为同逻辑的 CommonJS 镜像，改动需同步
 *
 * 门控规则：
 * - info/debug 详细事件：受 enabled 与 level 双重控制
 * - warn/error：不受 enabled 控制（失败永远可见），warn 受 level 控制，error 恒输出
 * - invocation 调用摘要：仅受 invocationLogs 控制，与 enabled、level 无关
 */
export type LogLevel = "error" | "warn" | "info" | "debug";

const LEVEL_RANK: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

export interface ObserverContext {
  repo?: string;
  pr?: number;
  sha?: string;
  reviewId?: string;
  trigger?: string;
}

export interface ObserverOptions {
  /** 运行时标识：probot | worker | actions */
  mode: string;
  /** 详细事件日志总开关（默认 true） */
  enabled?: boolean;
  /** 每次审查的调用摘要（默认 true，独立于 enabled/level） */
  invocationLogs?: boolean;
  /** 详细日志级别过滤（默认 info） */
  level?: LogLevel;
  context?: ObserverContext;
}

export interface Span {
  /** 结束计时并输出一条 info 事件（自动带 durationMs；受详细日志门控） */
  finish(event: string, fields?: Record<string, unknown>): void;
  /** 已流逝毫秒数（用于失败路径单独输出 error 事件） */
  elapsed(): number;
}

export interface Observer {
  readonly level: LogLevel;
  readonly enabled: boolean;
  readonly invocationLogs: boolean;
  /** 派生绑定上下文的新 observer */
  child(context: ObserverContext): Observer;
  /** 变更门控与上下文（用于应用仓库级覆盖） */
  apply(overrides: { enabled?: boolean; invocationLogs?: boolean; level?: LogLevel; context?: ObserverContext }): Observer;
  /** 计时器 */
  start(): Span;
  info(event: string, msg: string, fields?: Record<string, unknown>): void;
  warn(event: string, msg: string, fields?: Record<string, unknown>): void;
  error(event: string, msg: string, fields?: Record<string, unknown>): void;
  debug(event: string, msg: string, fields?: Record<string, unknown>): void;
  /** 调用摘要（受 invocationLogs 控制，始终 info 级） */
  invocation(event: string, msg: string, fields?: Record<string, unknown>): void;
}

/** 从 env（process.env 或 Worker Env）解析默认配置 */
export function resolveObserverOptions(mode: string, env: Record<string, string | undefined>): ObserverOptions {
  const levelRaw = (env.HEIMDALL_LOG_LEVEL ?? "info").toLowerCase();
  const level: LogLevel = levelRaw in LEVEL_RANK ? (levelRaw as LogLevel) : "info";
  return {
    mode,
    enabled: env.HEIMDALL_LOG_ENABLED !== "false",
    invocationLogs: env.HEIMDALL_INVOCATION_LOGS !== "false",
    level,
  };
}

/** 应用仓库级 observability 覆盖（shape: { enabled?, invocation_logs? }），未配置时保持原样 */
export function applyLogOverrides(
  obs: Observer,
  overrides?: { enabled?: boolean; invocation_logs?: boolean }
): Observer {
  if (!overrides) return obs;
  if (overrides.enabled === undefined && overrides.invocation_logs === undefined) return obs;
  return obs.apply({ enabled: overrides.enabled, invocationLogs: overrides.invocation_logs });
}

export function createObserver(options: ObserverOptions): Observer {
  const mode = options.mode;
  const enabled = options.enabled !== false;
  const invocationLogs = options.invocationLogs !== false;
  const level = options.level ?? "info";
  const context: ObserverContext = options.context ?? {};

  function shouldEmit(lvl: LogLevel): boolean {
    return LEVEL_RANK[lvl] <= LEVEL_RANK[level];
  }

  function emit(lvl: LogLevel, event: string, msg: string, fields?: Record<string, unknown>): void {
    const line: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level: lvl,
      event,
      mode,
      ...context,
      ...fields,
      msg,
    };
    if (lvl === "error") console.error(JSON.stringify(line));
    else console.log(JSON.stringify(line));
  }

  function emitInfo(event: string, msg: string, fields?: Record<string, unknown>): void {
    if (enabled && shouldEmit("info")) emit("info", event, msg, fields);
  }

  function start(): Span {
    const started = Date.now();
    return {
      finish: (event, fields) => emitInfo(event, "", { ...fields, durationMs: Date.now() - started }),
      elapsed: () => Date.now() - started,
    };
  }

  const observer: Observer = {
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
      return createObserver({ mode, enabled, invocationLogs, level, context: { ...context, ...next } });
    },
    apply(overrides) {
      return createObserver({
        mode,
        enabled: overrides.enabled ?? enabled,
        invocationLogs: overrides.invocationLogs ?? invocationLogs,
        level: overrides.level ?? level,
        context: { ...context, ...overrides.context },
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

  return observer;
}

/** 生成一次审查的关联 ID（h-<base36 时间戳><随机后缀>，足够唯一即可，非密码学用途） */
export function newReviewId(): string {
  return `h-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}
