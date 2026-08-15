# Heimdall 可观测性设计（Observability Design）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-08-15 |
| 状态 | 已实施 |
| 目标 | 诊断审查失败与跳过（diagnose failures & skips） |
| 范围 | 三种运行时（Probot / Cloudflare Workers / GitHub Actions） |

---

## 1. 背景与目标

当前 Heimdall 的可观测性极弱：三种运行时里散落着中文 `console.log` / `console.error`，没有时间戳、没有关联 ID、没有耗时、没有结构化数据。GitHub 状态检查（`heimdall/reviewed`、`heimdall/critical`）是唯一的机器可读信号。

**核心目标**：让每个「为什么跳过 / 为什么失败」都能被一条结构化日志回答。次目标：阶段耗时可见（辅助诊断慢审查）。

**非目标**（用户明确排除）：聚合指标（usage/quality metrics）、外部导出（OTel/Datadog/webhook）、按仓库统计成本。

## 2. 关键决策记录

| 决策点 | 结论 |
| --- | --- |
| 日志格式 | **JSON-lines**，一行一个事件 |
| 覆盖模式 | **全部三种**运行时 |
| 级别控制 | 环境变量 `HEIMDALL_LOG_LEVEL`（`error\|warn\|info\|debug`，默认 `info`） |
| 实现方案 | **方案 A**：共享零依赖 observability 模块 |
| Actions 镜像 | **方案 A**：独立 `scripts/observability.js`，`heimdall-review.js` require 它（复制文件数 2 → 3） |
| 配置位置 | **两者结合**：环境变量设默认，`.github/heimdall.yml` 可逐仓库覆盖 |
| `enabled` 语义 | **详细日志默认开**；`invocation_logs` 为始终开启的调用摘要 |

## 3. 配置模型

**优先级（高 → 低）**：仓库级 `.github/heimdall.yml` > 环境变量 > 默认值。

### 3.1 环境变量（运维默认）

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `HEIMDALL_LOG_ENABLED` | `true` | 详细事件日志总开关 |
| `HEIMDALL_INVOCATION_LOGS` | `true` | 每条审查固定一行调用摘要 |
| `HEIMDALL_LOG_LEVEL` | `info` | 详细日志过滤级别：`error\|warn\|info\|debug` |

### 3.2 仓库级覆盖（`.github/heimdall.yml`）

```yaml
observability:
  logs:
    enabled: false       # 本仓库关掉详细日志
    invocation_logs: true
```

### 3.3 语义

- `logs.enabled = true`（默认）→ 输出各阶段 info/debug 事件
- `logs.enabled = false` → info/debug 不输出；`warn`/`error` 不受 `enabled` 门控（失败不会被 `enabled` 隐藏）
- `warn` 仍受 `HEIMDALL_LOG_LEVEL` 过滤（`level=error` 时 `warn` 被过滤），`error` 恒输出
- `invocation_logs = true`（默认）→ 每次审查固定一行 `review.invocation`（repo/pr/sha/耗时/结果/问题数），与 `enabled`、级别无关
- `HEIMDALL_LOG_LEVEL` 只过滤 info/warn 详细日志，不影响 error 与调用摘要

**解析器约束**：手写 YAML 解析器（`src/review/repo-config.ts` 及 Actions 副本）当前不支持嵌套 map，需扩展 `observability:` 块的递归解析；`RepoConfig` 新增 `observability` 字段。Worker 的 `Env` 接口新增三个变量。

## 4. 共享模块与输出格式

**`src/observability.ts`**（零依赖，镜像到 `scripts/observability.js`）：

```ts
createObserver({ mode, enabled, invocationLogs, level }) → Observer
  .info/.warn/.error/.debug(event, msg, fields?)
  .start() → Span           // finish(event, fields?) 自动带 durationMs
  .child({ repo, pr, sha }) → Observer   // 上下文绑定
```

每行 JSON 格式：

```json
{"ts":"2026-08-16T02:40:00.000Z","level":"info","event":"review.start","mode":"worker","repo":"octocat/hello-world","pr":12,"sha":"abc1234","msg":"开始审查"}
```

底层走 `console.log` / `console.error`：Probot 落 stdout，Worker 落 Workers Logs，Actions 落 workflow 日志。不引入任何依赖。

## 5. 事件目录

### 5.1 阶段事件

`review.start` → `review.config` → `review.diff`（debug）→ `llm.done` → `review.parse` → `review.post`，终态由 `review.invocation` 汇总

阶段事件携带：`durationMs`、`provider`、`model`、问题数（critical/important/normal）、文件数、diff 字节数（字节数细节放 debug）。

### 5.2 跳过事件 `review.skip`（机器可读 `reason`）

| reason | 含义 |
| --- | --- |
| `draft_pr` | 草稿 PR |
| `bot_pr` | 机器人发起的 PR/评论 |
| `not_auto_review` | 默认仅按需审查，非自动触发 |
| `reviewer_not_whitelisted` | 触发者不在 manual_reviewers |
| `dup_review` | 同 commit 已有 review（hasExistingReview） |
| `dup_cache` | Worker 模块级缓存命中 |
| `dup_status` | 已有 heimdall/reviewed 成功状态 |
| `missing_api_key` | 未配置 AI 密钥（Actions 预检；Probot/Worker 走 `llm_error`） |
| `non_pr_event` | 非 PR 事件 |
| `no_trigger_comment` | 评论未匹配触发词 |

### 5.3 失败事件 `review.error`（`reason`）

| reason | 含义 |
| --- | --- |
| `llm_error` | LLM 调用失败（HTTP 状态、缺 key、超时） |
| `post_inline_failed` | 行内评论发布失败，降级为整体报告 |

> 解析失败（`parse_failed`）不走 `review.error`，而是 `warn` 级的 `review.parse`（`status: fallback`）。

### 5.4 调用摘要 `review.invocation`

受 `invocation_logs` 控制，独立于 `enabled` 与级别。一行包含：repo / pr / sha / trigger / durationMs / outcome（posted / skipped / empty / failed / parse_fallback）/ 问题数。

## 6. 各运行时接线

| 运行时 | 接线 |
| --- | --- |
| Probot | `src/review/index.ts` 在 `runReview` 内创建 observer；`src/app.ts` 中 `runReview` **之前**的跳过也用 observer（草稿/机器人/非自动/白名单） |
| Worker | `import "../src/observability"`；`Env` 接口加三变量；替换现有 console 调用 |
| Actions | `scripts/observability.js` 镜像，`heimdall-review.js` `require`；复制文件数 2 → 3，README 快速开始同步 |

**顺序细节**：draft/bot 等跳过发生在读取 `.github/heimdall.yml` 之前，此时仅环境变量默认生效；仓库级覆盖在配置加载后、后续事件前应用。`warn`/`error` 始终输出。

## 7. 测试

`test/observability.test.js`（node:test，跑编译后的 `lib/`）：

- JSON 行格式（可解析、含 ts/level/event/msg）
- 级别过滤（info 时 debug 被过滤；error 恒输出）
- `Span.finish` 自动带 `durationMs`
- `enabled=false` 时只出调用摘要 + warn/error
- `child()` 上下文继承
- YAML 解析器对 `observability:` 嵌套块的支持
- 现有 `npm test` 全部保持通过

## 8. 文档清单

- `.env.example`：加三个变量及注释
- `README.md` / `README.zh-CN.md`：新增 Observability 小节（事件/reason 码、`observability` 块、三变量）
- `AGENTS.md`：observability 模块与 `scripts/observability.js` 镜像同步约定
- 本文档提交至 `docs/superpowers/specs/2026-08-16-observability-design.md`

## 9. 文件改动清单

**新增**：
- `src/observability.ts`
- `scripts/observability.js`
- `test/observability.test.js`
- `docs/superpowers/specs/2026-08-16-observability-design.md`

**修改**：
- `src/review/index.ts`（接线 + 迁移 console）
- `src/app.ts`（跳过事件）
- `worker/index.ts`（接线 + Env + 迁移）
- `scripts/heimdall-review.js`（require 镜像 + 迁移）
- `template/heimdall-review.yml`（注释提及第三个文件）
- `src/review/repo-config.ts` + Actions 副本（YAML 嵌套解析 + `observability` 字段）
- `README.md` / `README.zh-CN.md` / `.env.example` / `AGENTS.md`
