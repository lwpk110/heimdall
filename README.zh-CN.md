# 海姆达尔 (Heimdall)

> "我能看见九界中的一切，也包括你代码里的每一个问题。" —— 海姆达尔

**海姆达尔是一个 AI 代码审查机器人**：把它接入你的 GitHub 仓库后，它会自动（或按需）审查每个 Pull Request 的 diff，以 GitHub Review 的形式发布专业的中文审查报告——包含变更摘要、严重度分级、行内评论、可执行的 diff 修复建议。

**核心特性：模型自由。** 你**自己配置模型**——支持 Claude / GPT / Gemini / 本地模型（Ollama / vLLM），可通过统一 `AI_API_KEY` + `AI_BASE_URL` 走任意代理网关，代码和审查内容都经你自己的配置。

### 🥲 为什么会有海姆达尔？（答：被 Copilot 的“单方面契约变更”气出来的）

> 故事要从那个充满“资本智慧”的订阅套餐说起 ——
> 
> 某天，Copilot 突然打着“优化体验”的旗号重新定义了契约：给你的模型偷偷降级了，Token 上限悄悄缩水了，连可用模型列表都给你阉割了一轮。最绝的是，那每月 10 美元的订阅费按时扣得挺爽，但你的 Code Review 配额**往往还没到月中，就弹窗告急：“您的配额已用尽，请升级商业版或购买额外 Credits”**。
> 
> 到了月底一算账：**钱是一分没少交，Token 是一中旬就消耗光，真正需要 Code Review 守卫代码的时候全打水漂，只为科技巨头的财报添砖加瓦了。** 🤡
>
> **海姆达尔（Heimdall）就是为了打破这种割韭菜枷锁而生的：**
> - **模型自由**：你想用 Claude 3.5 Sonnet 就用 Claude，想用 GPT-4o 就用 GPT-4o，甚至挂本地 Ollama / DeepSeek 跑私有模型，全凭你说了算！
> - **成本掌控**：按实际 Token 用量付费，或者走团队 API 代理网关，告别“一口价订阅但中途断供”的糟心体验。
> - **永远可靠**：彩虹桥的守护者从不单方面修改服务条款，也不搞“配额用尽请打钱”的套路！

## 特性

- **三形态部署**：GitHub Actions（单仓库自用、零服务器）、Cloudflare Workers（无服务器、可作为 GitHub App 分发到任意仓库）、Probot / Docker 自托管（代码不出内网）
- **按需审查（默认）**：PR 打开不自动审查，在 PR 评论发 `@CoderHeimdall` 才审查（类似 Copilot 按需模式）；配 `auto_review: true` 可恢复自动
- **可配置模型**：Claude / GPT / Gemini / 本地模型，支持统一 `AI_API_KEY` + `AI_BASE_URL` 代理网关
- **专业报告**：变更摘要 + 文件变更表格 + 严重度分级（🔴/🟡/🟢）+ 问题汇总 + 折叠块
- **行内评论 + diff**：每条问题挂在对应代码行，含行动式说明 + 💡 修复建议 + 可套用的 diff 代码块
- **`.github/heimdall.yml` 配置化**：include/exclude 文件过滤、min_severity 阈值、团队自定义审查指令、白名单、block_on_critical、auto_review
- **审查质量**：同 commit 去重、`heimdall/critical` 状态阻断合并、敏感字段传导/信任边界等深度检查、JSON 容错解析
- 跳过草稿 PR 与机器人发起的 PR；核心逻辑带单元测试（node:test）

---

## 快速开始（2 分钟，单仓库自用）

**最简单的方式（模式 A：GitHub Actions）**——给任意一个仓库加上 AI reviewer：

```bash
# 在「被审查的仓库」执行
mkdir -p .github/workflows scripts
cp template/heimdall-review.yml .github/workflows/
cp scripts/heimdall-review.js scripts/
```

然后在目标仓库 **Settings → Secrets and variables → Actions** 添加：

- `AI_API_KEY`（推荐，走代理网关）或 `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY`
- 可选 Variables：`AI_MODEL`、`AI_BASE_URL`

提一个 PR，在 PR 评论发 `@CoderHeimdall`（或 `@heimdall`）即可看到审查报告。想自动审查，在目标仓库放 `.github/heimdall.yml` 并设 `auto_review: true`。

## 两种模式怎么选

| | 模式 A：GitHub Actions | 模式 B：Cloudflare Workers |
| --- | --- | --- |
| 定位 | 单仓库自用、快速接入 | 团队多仓库 / 产品化分发 |
| 需要注册 GitHub App | 否 | 是 |
| 需要服务器 | 否 | 否（Cloudflare 边缘） |
| 安装方式 | 复制 3 个文件到目标仓库 | 安装 GitHub App |
| 部署成本 | 免费 | 免费额度内（大 diff 建议 Pro） |

- **只想给自己的仓库加个 AI reviewer** → 模式 A，2 分钟
- **团队统一使用 / 做成可安装的机器人** → 模式 B

---

## 模式 A：GitHub Actions

### 1. 复制文件到目标仓库

```bash
mkdir -p <目标仓库>/.github/workflows <目标仓库>/scripts
cp template/heimdall-review.yml <目标仓库>/.github/workflows/
cp scripts/heimdall-review.js <目标仓库>/scripts/
cp scripts/observability.js <目标仓库>/scripts/
```

### 2. 配置 AI

在目标仓库 **Settings → Secrets and variables → Actions**：

| Secret | 说明 |
| --- | --- |
| `AI_API_KEY` | 统一 API Key（走代理网关，推荐）|
| 或 `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` | 各提供方专属 Key |

| Variable | 说明 |
| --- | --- |
| `AI_MODEL` | 覆盖默认模型（见下方「模型配置」）|
| `AI_BASE_URL` | 代理网关 / 本地模型地址 |
| `AI_PROVIDER` | `anthropic` / `openai` / `gemini` |

### 3. 使用

- **按需（默认）**：PR 打开不审查，评论发 `@CoderHeimdall` 触发
- **自动**：放 `.github/heimdall.yml`，设 `auto_review: true`

---

## 模式 B：Cloudflare Workers（完整搭建流程）

> 这是把海姆达尔做成「可安装的 GitHub App」的完整流程，一次部署，可安装到任意仓库。**建议严格按顺序执行**（很多坑来自顺序错误）。

### 流程总览（5 步）

```
① 部署 Worker 到 Cloudflare  →  ② 注册 GitHub App  →  ③ 配置仓库 Secrets
→  ④ 安装 App + 改 Webhook  →  ⑤ 验证
```

### ① 部署 Worker 到 Cloudflare

```bash
npm install
npm run worker:dev          # 本地调试
npx wrangler login          # 首次需要登录 Cloudflare
npm run worker:deploy       # 部署，输出 https://heimdall.<你的子域>.workers.dev
```

部署成功后会得到 **Webhook 地址**（记下来，第②步要用）：

```
https://heimdall.<你的子域>.workers.dev/api/github/webhooks
```

### ② 注册 GitHub App

**方式一：Manifest 一键注册（推荐）**

把本仓库推到 GitHub 后，访问：

```
https://github.com/settings/apps/new?url=https://raw.githubusercontent.com/<你的用户名>/<仓库名>/main/app.yml
```

**方式二：手动注册**

GitHub → Settings → Developer settings → GitHub Apps → **New GitHub App**：

| 项 | 值 |
| --- | --- |
| **GitHub App name** | `CoderHeimdall`（全局唯一，重名加后缀）|
| **Webhook URL** | 第①步的 `https://heimdall.<你的子域>.workers.dev/api/github/webhooks` |
| **Webhook secret** | 生成随机串并保存（第③步要用）|
| **Permissions** | `Pull requests` → Read & write；`Contents` → Read-only；`Issues` → Read & write；**`Statuses` → Read & write**（去重标记 + block_on_critical 依赖）；`Metadata` → Read-only |
| **Subscribe to events** | **勾选 `pull_request`、`issue_comment`**（漏勾则收不到事件！）|

创建后：记录 **App ID**，生成并下载 **Private key（.pem）**。

### ③ 配置仓库 Secrets

在**本仓库**（部署 heimdall 的仓库）Settings → Secrets and variables → Actions 配置：

| Secret | 说明 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare Token（权限 `Workers Scripts: Edit`）|
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账号 ID |
| `GH_APP_ID` | GitHub App ID（**不能叫 `GITHUB_APP_ID`**，见坑点）|
| `GH_APP_PRIVATE_KEY` | App 私钥 **完整 PEM**（含 BEGIN/END 行与换行）|
| `GH_WEBHOOK_SECRET` | 第②步的 Webhook secret |
| `AI_API_KEY` / `AI_BASE_URL` | AI 配置（可选，见「模型配置」）|

配好后，推送到 `main` 或手动 Run `Deploy Worker` workflow，即可自动部署 Worker 并写入以上 Secrets。

### ④ 安装 App + 对接 Webhook

1. **Install App**：GitHub App 设置页 → 左侧 **Install App** → 安装到你的账号/仓库（可 All repositories）
2. **确认 Webhook**：App 设置页 → General → Webhook URL 是第①步地址；Webhook secret 与 `GH_WEBHOOK_SECRET` 一致
3. 若改名 App 或改动配置，**务必重新确认 Webhook URL 与事件订阅**（改名会重置 webhook！）

### ⑤ 验证

在已安装的仓库提一个 PR（或对已有 PR 评论 `@CoderHeimdall`），看 **Files changed** 页是否出现 `CoderHeimdall[bot]` 的审查报告。

---

## AI 模型配置（核心：自由选择模型）

海姆达尔**模型自由**——审查质量取决于你配置的模型。三种方式：

### 统一配置（推荐，走代理网关）

```bash
AI_API_KEY=<网关 Key>          # 一个 Key 走所有模型
AI_BASE_URL=https://<网关>/   # 如 https://api.appskit.dev
AI_MODEL=claude-sonnet-5       # 你的网关支持的模型 ID
```

### 各提供方专属

| 提供方 | 变量 | 默认模型 |
| --- | --- | --- |
| Anthropic | `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL` | claude-sonnet-4-5-20250929 |
| OpenAI | `OPENAI_API_KEY` / `OPENAI_BASE_URL` | gpt-4o |
| Gemini | `GEMINI_API_KEY` / `GEMINI_BASE_URL` | gemini-2.0-flash |
| 本地模型 | `OPENAI_API_KEY` + `OPENAI_BASE_URL=http://localhost:11434/v1` | Ollama / vLLM 等 OpenAI 兼容端点 |

### 配置优先级

`AI_API_KEY` / `AI_BASE_URL`（统一）优先，未设置则回退到各提供方专属配置。

> **注意**：`AI_MODEL` 必须是你所用网关/提供方**支持的模型 ID**。网关不支持会返回 `model_not_found`，设置 `AI_MODEL` 为网关支持的 ID 即可。

---

## 配置开关速查

想开某个能力？直接看这张表（「在哪设置」= 环境变量 / GitHub Actions Variable / `.github/heimdall.yml`）：

| 想开启的能力 | 开关 / 参数 | 在哪设置 |
| --- | --- | --- |
| **PR 打开自动审核**（默认是仅按需）| `auto_review: true` | `.github/heimdall.yml` |
| 手动触发审查 | PR 评论 `@CoderHeimdall` | 默认，无需配置 |
| 选择 AI 提供方 | `AI_PROVIDER = anthropic \| openai \| gemini` | 环境变量 / Actions Variable |
| 选择模型 | `AI_MODEL = <模型 ID>` | 环境变量 / Actions Variable / `wrangler.toml [vars]` |
| 走代理网关 / 本地模型 | `AI_BASE_URL = https://<网关>` | 环境变量 / Actions Variable |
| 提供方专属 base_url | `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL` / `GEMINI_BASE_URL` | 环境变量 / Actions Variable |
| diff 长度上限 | `MAX_DIFF_LENGTH`（默认 40000）| 环境变量 / `wrangler.toml [vars]` |
| 可观测：详细日志总开关 | `HEIMDALL_LOG_ENABLED`（**默认 true**）| 环境变量 / Actions Variable / `wrangler.toml [vars]` |
| 可观测：每次审查调用摘要 | `HEIMDALL_INVOCATION_LOGS`（**默认 true**）| 环境变量 / Actions Variable / `wrangler.toml [vars]` |
| 可观测：日志级别 | `HEIMDALL_LOG_LEVEL = error \| warn \| info \| debug`（**默认 info**）| 环境变量 / Actions Variable / `wrangler.toml [vars]` |
| 可观测：仓库级覆盖 | `observability.logs.enabled / invocation_logs` | `.github/heimdall.yml` |
| 只审查某些文件 | `include: ["*.ts", ...]` | `.github/heimdall.yml` |
| 排除某些文件 | `exclude: ["**/generated/**", ...]` | `.github/heimdall.yml` |
| 只显示 ≥ 某严重度 | `min_severity: important` | `.github/heimdall.yml` |
| 团队自定义审查指令 | `instructions: \| ...` | `.github/heimdall.yml` |
| 限制谁能手动触发 | `manual_reviewers: [octocat]` | `.github/heimdall.yml` |
| **有严重问题就阻止合并** | `block_on_critical: true`（+ 分支保护加 `heimdall/critical` 检查）| `.github/heimdall.yml` + GitHub 分支保护 |
| **审查报告语言** | `REVIEW_LANGUAGE = en \| zh \| bilingual`（**默认 en**，bilingual 中英并列）| 环境变量 / Actions Variable |
| 关闭自动、纯按需 | 不配置 `auto_review`（默认即仅按需）| — |

> 环境变量：自托管 `.env` / Worker 用 `wrangler secret put` 或 `[vars]` / Actions 用 Secrets + Variables。

## 配置文件 `.github/heimdall.yml`（可选）

在被审查仓库放一个 `.github/heimdall.yml` 即可定制审查，配置随仓库版本化：

```yaml
version: 1

# 只审查这些文件（glob，支持 * ** ?）；不配置则审查全部
include: ["*.ts", "*.js", "*.py", "*.go"]

# 排除这些文件（glob，优先级高于 include）
exclude: ["**/generated/**", "**/*.min.js", "**/package-lock.json"]

# 低于该严重度的 issue 不进报告：critical | important | normal
min_severity: normal

# 团队自定义审查指令，追加到海姆达尔的系统 prompt
instructions: |
  本项目使用 TypeScript，遵循 strict 模式。
  禁止使用 any。

# 可按需触发 @CoderHeimdall 的账号白名单；不配置表示人人可触发
manual_reviewers:
  - octocat

# 存在未解决 critical 问题时，把 heimdall/critical 状态置为 failure
# （在分支保护里把该检查加入 required status checks 即可真正阻断合并）
block_on_critical: true

# 设为 true 时开启自动审查；默认不配置 = 仅手动触发（@CoderHeimdall）
auto_review: true

# 仓库级可观测性覆盖（默认来自环境变量，见下方「可观测性」小节）
observability:
  logs:
    enabled: true
    invocation_logs: true
```

---

## 可观测性

海姆达尔向 stdout/console 输出 **JSON-lines** 结构化日志（GitHub Actions workflow 日志、Cloudflare Workers Logs、或自托管 stdout），一行一个事件，用每次审查的 `reviewId` 关联。

**开关（环境变量设运维默认，`.github/heimdall.yml` 可逐仓库覆盖）：**

| 环境变量 | 默认 | 含义 |
| --- | --- | --- |
| `HEIMDALL_LOG_ENABLED` | `true` | 详细阶段日志总开关（`review.*`、`llm.*`）|
| `HEIMDALL_INVOCATION_LOGS` | `true` | 每次审查固定一行调用摘要（`review.invocation`）|
| `HEIMDALL_LOG_LEVEL` | `info` | 级别过滤：`error \| warn \| info \| debug`（只影响详细日志）|

**仓库级覆盖**（在被审查仓库的 `.github/heimdall.yml`）：

```yaml
observability:
  logs:
    enabled: false      # 本仓库关掉详细日志
    invocation_logs: true
```

`enabled: false` 只关掉 info/debug 细节——`warn`/`error` 不受 `enabled` 门控（失败不会被 `enabled` 隐藏）。`warn` 仍受 `HEIMDALL_LOG_LEVEL` 过滤（`level=error` 时 `warn` 不输出）；`error` 恒输出。

**关键事件** —— 诊断「这个 PR 为什么跳过 / 失败」：
- `review.skip` + `reason`：`draft_pr` · `bot_pr` · `not_auto_review` · `reviewer_not_whitelisted` · `dup_review` · `dup_cache` · `dup_status` · `missing_api_key` · `non_pr_event` · `no_trigger_comment`
- `review.error` + `reason`：`llm_error` · `post_inline_failed`
- 阶段事件：`review.start` → `review.config` → `review.diff`（debug）→ `llm.done` → `review.parse` → `review.post`，终态由 `review.invocation` 汇总
- `review.invocation` —— 每次审查一行摘要（outcome、`durationMs`、各级别问题数）

示例行：

```json
{"ts":"2026-08-16T02:40:00.000Z","level":"info","event":"review.skip","mode":"worker","repo":"octocat/hello-world","pr":12,"sha":"abc1234","reviewId":"h-x1y2z3","reason":"not_auto_review","msg":"默认仅按需审查，跳过自动审查"}
```

## 审查报告样式

```markdown
## 海姆达尔 · 代码审查报告

**变更摘要**：本次 PR 共改动 2 个文件，🟢 +214 / 🔴 -58 行。

| 文件 | 变更 |
| --- | --- |
| `src/auth.ts` | 🟢 +120 / 🔴 -30 |
| `src/api.ts` | 🟢 +94 / 🔴 -28 |

**变更概述**：重构认证模块，切换为 JWT 校验……

🔍 **发现 3 个问题**（critical 1 / important 1 / normal 1）

<details><summary>🤖 审查评论</summary>

| 严重度 | 位置 | 问题 |
| --- | --- | --- |
| 🔴 | `src/auth.ts:45` | 应改为服务端加载权威数据，当前信任客户端传入字段存在越权风险 |
| 🟡 | `src/api.ts:88` | 应使用 Promise.all 并行，当前 N+1 查询 |
| 🟢 | `src/utils.ts:12` | 使用了不可变数据结构，赞 |

</details>

<details><summary>ℹ️ 审查信息</summary>

- 审查文件：2 个 / 变更规模：🟢 +214 / 🔴 -58 行

</details>
```

每条问题的**行内评论**挂在对应代码行，包含：行动式说明 + 影响 + `💡 修复建议` + 可直接套用的 `diff` 代码块。

---

## 搭建常见坑点（实战踩坑总结）

> 这些坑都是真实部署中踩过的，按此可避免重走弯路。

### 配置类

1. **GitHub repo secret 不能以 `GITHUB_` 开头**（保留给 `GITHUB_TOKEN` 等）。所以用 `GH_APP_ID` / `GH_APP_PRIVATE_KEY` / `GH_WEBHOOK_SECRET` 命名，workflow 再映射为 Worker 侧 secret。
2. **App 必须勾选 `pull_request` + `issue_comment` 事件**，否则收不到任何事件（Recent Deliveries 里只有 installation/ping）。勾选在 App 设置页 **Subscribe to events**。
3. **App 需要 `Statuses` 权限**（Read & write）。缺失时去重标记 `heimdall/reviewed` 和 `block_on_critical` 静默失效（403 被吞）。
4. **改 App 名会重置 Webhook 配置**——改名后必须重新确认 Webhook URL、secret 与事件订阅。
5. **Webhook URL 部署后才确定**：先部署 Worker（拿到 `https://heimdall.<子域>.workers.dev`），再注册 App 填 URL。
6. **Webhook secret 两端必须一致**：GitHub App 设置页的 secret 与仓库的 `GH_WEBHOOK_SECRET` 相同，否则 Worker 签名校验失败（401）。

### Worker / Cloudflare 类

7. **Cloudflare Worker 无全局 `Buffer`**——必须显式 `import { Buffer } from "node:buffer"`，否则 webhook 全 500（`Buffer is not defined`）。
8. **GitHub API 请求必须带 `User-Agent`**，否则返回 403 `Request forbidden by administrative rules`。
9. **Cloudflare free 计划 `waitUntil` 限 30 秒**：大 diff 的详细审查（多问题 + diff）可能超时被杀。两个缓解：
   - 请求里 `thinking: { type: "disabled" }` 禁用模型思考过程（大幅加速）
   - 升级 Cloudflare Pro（`waitUntil` 90s）
10. **私钥必须完整 PEM**：`GH_APP_PRIVATE_KEY` 要含 `-----BEGIN RSA PRIVATE KEY-----` 到 `-----END RSA PRIVATE KEY-----` 的完整多行内容，否则 `createPrivateKey` 报 `Failed to parse private key`。

### 审查行为类

11. **同一 commit 并发触发会重复审查**（自动 + 手动几乎同时）：已用 `hasExistingReview` + `heimdall/reviewed` 状态 + 模块级缓存三重去重。
12. **LLM 输出 JSON 里的代码换行可能非法**（diff 字段带真实换行）：已做宽松 JSON 解析容错。
13. **模型 ID 不匹配网关**会报 `model_not_found`——设 `AI_MODEL` 为网关支持的 ID。
14. **默认仅按需审查**：未配 `auto_review` 时 PR 不自动审，`@CoderHeimdall` 才审（避免噪音与成本）。

---

## 架构

三种形态共享同一套审查内核，抽象为「触发 → 配置 → 数据获取 → 模型调用 → 结果解析 → 回写」管线：

```
触发（PR 事件 / @CoderHeimdall 评论）
   │
   ▼
读取配置（.github/heimdall.yml）＋ 读取 PR diff（GitHub API，含 include/exclude 过滤）
   │
   ▼
调用 LLM（anthropic / openai / gemini / 本地模型，可自定义 base_url）
   │
   ▼
解析结构化结果（JSON → 严重度 / 文件 / 行号，含宽松容错）
   │
   ▼
以 Review 回写 PR（行内评论 + 整体报告；行号映射失败自动降级）
   │
   ▼
（可选）heimdall/critical 状态检查 → 阻断合并
```

## 目录结构

```
heimdall/
├── app.yml                     # GitHub App Manifest（含 statuses 权限、事件订阅）
├── .github/
│   ├── workflows/
│   │   ├── ci.yml              # 本仓库 CI：构建 + 单元测试
│   │   └── deploy.yml          # 模式 B：自动发布 Worker 到 Cloudflare
│   ├── ISSUE_TEMPLATE/         # Issue 模板
│   └── pull_request_template.md
├── template/heimdall-review.yml # 模式 A：审查 workflow（复制到目标仓库）
├── scripts/heimdall-review.js  # 模式 A：审查脚本（复制到目标仓库，零依赖）
├── worker/                     # 模式 B：Cloudflare Worker
│   ├── index.ts
│   └── wrangler.toml
├── src/                        # 共享审查内核
│   ├── index.ts                # 自托管入口
│   ├── app.ts                  # Probot 事件订阅
│   ├── config.ts               # 环境配置解析（AI 提供方 / base_url / 模型）
│   └── review/
│       ├── index.ts            # 审查主流程
│       ├── prompt.ts           # 海姆达尔人设 prompt（唯一来源，多次迭代至 85 分+）
│       ├── providers.ts        # AI 提供方
│       ├── parse.ts            # 结构化解析 + 报告渲染 + 宽松 JSON 容错
│       └── repo-config.ts      # heimdall.yml 解析 / 过滤 / 阈值 / 白名单
├── test/                       # 单元测试（node:test）
├── .claude/agents/critic.md    # 审查质量批评家 agent（量化评估 ≥85）
├── AGENTS.md / CONTRIBUTING.md / PRD.md   # 英文版；对应 *.zh-CN.md 中文版
├── Dockerfile                  # 可选：自托管服务
└── README.md / README.zh-CN.md # 英文版 / 中文版
```

## 常见问题

**怎么触发审查？**

默认按需：PR 打开不自动审，在 PR 评论发 `@CoderHeimdall`（或 `@heimdall`）即审查。配 `auto_review: true` 后 PR 打开自动审。

**审查会受上下文长度限制吗？**

会。`MAX_DIFF_LENGTH` 默认 40000 字符，超出截断；超大 PR 建议拆小或提高该值。

**行内评论的行号不准怎么办？**

能定位到 diff 新增行的以行内评论发布，无法定位或映射失败（422）自动降级进整体报告，不丢失内容。

**同一 commit 会重复审查吗？**

不会。自动 + 手动触发都有去重（review 查询 + 状态标记 + 模块缓存），同一 commit 只审一次；新 commit 才重新审。

## 路线图

已交付（M1–M4）：

- [x] 自动整体审查 + 海姆达尔人设
- [x] 变更摘要 + 严重度分级 + 行内评论 + diff 修复建议
- [x] `.github/heimdall.yml` 配置化（include/exclude / min_severity / instructions / 白名单 / block_on_critical / auto_review）
- [x] 按需审查 `@CoderHeimdall`（默认）
- [x] 更多 AI 提供方 + 统一 `AI_API_KEY` / `AI_BASE_URL` + 模型可配置
- [x] 同 commit 去重（三重机制）
- [x] 审查质量迭代（prompt v1→v7，批评家量化评估达 85+）
- [x] 单元测试 + CI + Worker 自动发布

规划中：

- [ ] 增量审查（只审查新增 / 变更部分）
- [ ] 基于文件变更规模的审查分级

## License

MIT
