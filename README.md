# 海姆达尔 (Heimdall)

> "我能看见九界中的一切，也包括你代码里的每一个问题。" —— 海姆达尔

海姆达尔是一个 AI 代码审查机器人。它像守护彩虹桥一样守望着你的每一个 Pull Request，在有人提交代码时自动审查 diff，并以 GitHub Review 的形式发布中文审查报告。

## 特性

- **三形态部署**：GitHub Actions（单仓库自用、零服务器）、Cloudflare Workers（无服务器、可作为 GitHub App 分发）、Probot / Docker 自托管（代码不出内网）
- 自动监听 PR 的 `opened` / `reopened` / `synchronize` 事件；在 PR 评论发 `@heimdall`（或 `@heimdall review`）可手动触发重新审查
- 调用 Claude / GPT / Gemini / 本地模型审查 diff（支持统一 `AI_API_KEY` + `AI_BASE_URL` 走代理网关）
- 以 PR Review 形式发布报告：变更摘要 + 严重度分级（🔴 严重 / 🟡 建议 / 🟢 良好）
- 行内评论定位到具体文件与代码行，行号映射失败时自动降级为整体报告，不丢失审查内容
- `.github/heimdall.yml` 配置化：include/exclude 文件过滤、min_severity 阈值、团队自定义审查指令、白名单、block_on_critical
- 同 commit 去重，避免重复审查刷屏
- `block_on_critical`：存在未解决严重问题时，以 `heimdall/critical` 状态检查阻断合并
- 跳过草稿 PR 与机器人发起的 PR；核心逻辑带单元测试（node:test）

## 两种模式怎么选

| | 模式 A：GitHub Actions | 模式 B：Cloudflare Workers |
| --- | --- | --- |
| 定位 | 单仓库自用 | 团队多仓库 / 产品化分发 |
| 需要注册 GitHub App | 否 | 是 |
| 需要服务器 | 否 | 否（Cloudflare 边缘） |
| 安装方式 | 复制 2 个文件到目标仓库 | 安装 GitHub App |
| 部署成本 | 免费 | 免费额度内 |

- **只想给自己的仓库加个 AI reviewer** → 模式 A，2 分钟搞定
- **团队统一使用 / 做成可安装的机器人** → 模式 B

---

## 模式 A：GitHub Actions（推荐自用）

### 1. 复制文件到目标仓库

把本仓库的 `.github/workflows/heimdall-review.yml` 和 `scripts/heimdall-review.js` 复制到「被审查的仓库」：

```bash
mkdir -p <目标仓库>/.github/workflows <目标仓库>/scripts
cp .github/workflows/heimdall-review.yml <目标仓库>/.github/workflows/
cp scripts/heimdall-review.js <目标仓库>/scripts/
```

### 2. 配置 API Key

在目标仓库 **Settings → Secrets and variables → Actions → New repository secret** 添加：

- 统一 `AI_API_KEY`（走代理网关时一个 key 即可），或 `ANTHROPIC_API_KEY`（默认）、`OPENAI_API_KEY`、`GEMINI_API_KEY`

可选：在 **Variables** 添加 `AI_PROVIDER`（`anthropic` / `openai` / `gemini`）、`AI_MODEL` 覆盖默认模型；代理网关 / 本地模型（Ollama / vLLM）可设统一 `AI_BASE_URL` 或各提供方 `*_BASE_URL`。

### 3. 验证

在目标仓库提一个 PR，海姆达尔会自动在 **Files changed** 页发布审查报告。

### 4. 手动触发

在 PR 评论里发 `@heimdall review` 即可手动触发一次重新审查（如只想偶尔审查，可在 workflow 里删掉 `synchronize` 减少自动触发）。

---

## 模式 B：Cloudflare Workers（作为 GitHub App）

### 1. 注册 GitHub App

**方式一：Manifest 一键注册（推荐）**

把本仓库推到 GitHub 后，访问：

```
https://github.com/settings/apps/new?url=https://raw.githubusercontent.com/<你的用户名>/<仓库名>/main/app.yml
```

**方式二：手动注册**

1. GitHub → Settings → Developer settings → GitHub Apps → **New GitHub App**
2. 关键项：
   - **GitHub App name**：`Heimdall-coding-review`（全局唯一，重名可加后缀）
   - **Webhook URL**：部署 Worker 后填 `https://heimdall.<你的子域>.workers.dev/api/github/webhooks`
   - **Webhook secret**：生成随机串并保存
   - **Permissions**：`Pull requests` → Read & write；`Contents` → Read-only；`Issues` → Read & write（用于响应 `@heimdall review` 评论）；`Metadata` → Read-only
   - **Subscribe to events**：`pull_request`、`issue_comment`
3. 记录 **App ID**，生成并下载 **Private key**（.pem）
4. 左侧 **Install App**，安装到你的仓库

### 2. 配置并部署

```bash
npm install
npm run worker:dev          # 本地调试
```

用 wrangler 配置密钥并部署：

```bash
npx wrangler secret put GITHUB_APP_ID
npx wrangler secret put GITHUB_PRIVATE_KEY
npx wrangler secret put WEBHOOK_SECRET
npx wrangler secret put AI_API_KEY        # 统一 key；或分别 ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY
npm run worker:deploy
```

> `GITHUB_PRIVATE_KEY` 换行可写成 `\n`（代码会自动还原），或在 Cloudflare Dashboard 直接粘贴原值。
> `AI_BASE_URL` 属于非敏感配置，可放进 `worker/wrangler.toml` 的 `[vars]` 或作为普通 secret 写入。

部署后把 GitHub App 的 **Webhook URL** 改成 Worker 地址，即可生效。

### 2.1 自动发布（GitHub Actions）

本仓库内置 `.github/workflows/deploy.yml`：推送 `main`（仅 worker/src 相关文件变化）或手动 dispatch 时，自动 `wrangler deploy` 并写入 Worker Secrets。

在仓库 **Settings → Secrets and variables → Actions** 配置：

| Secret | 说明 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token（权限：`Workers Scripts: Edit`） |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账号 ID |
| `GH_APP_ID` / `GH_APP_PRIVATE_KEY` / `GH_WEBHOOK_SECRET` | 注册 GitHub App 时获取（repo secret 不能以 `GITHUB_` 开头，故用 `GH_` 前缀；workflow 会自动写入 Worker 的 `GITHUB_APP_ID` / `GITHUB_PRIVATE_KEY` / `WEBHOOK_SECRET`） |
| `AI_API_KEY` / `AI_BASE_URL` | 统一 API Key 与基地址（代理网关，可选） |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | AI 密钥（可选） |

> `GH_APP_PRIVATE_KEY` 为多行私钥，直接粘贴完整内容即可；workflow 会原样写入。

---

## 可选：自托管服务（Docker / Probot）

不想用 Cloudflare、希望代码完全不出内网时，可用仓库内提供的传统 Probot 服务：

```bash
cp .env.example .env        # 填写 APP_ID / WEBHOOK_SECRET / PRIVATE_KEY / AI_API_KEY（或 ANTHROPIC_API_KEY）
npm install
npm run build
npm start                   # 本地运行，配合 smee.io 调试 webhook
# 或部署到任意 VPS：
docker build -t heimdall . && docker run --env-file .env -p 3000:3000 heimdall
```

## 环境变量

| 变量 | 说明 | 适用于 |
| --- | --- | --- |
| `APP_ID` | GitHub App ID | Workers / 自托管 |
| `WEBHOOK_SECRET` | Webhook secret | Workers / 自托管 |
| `PRIVATE_KEY` | App 私钥（换行用 `\n`） | Workers / 自托管 |
| `AI_PROVIDER` | `anthropic` 或 `openai` 或 `gemini` | 全部 |
| `AI_API_KEY` | 统一 API Key（走代理网关时最省事；未设置则回退到提供方专属 key） | 全部 |
| `AI_BASE_URL` | 统一 API 基地址（代理网关；未设置则回退到提供方专属 base url / 官方地址） | 全部 |
| `ANTHROPIC_API_KEY` | Anthropic API Key | 全部 |
| `OPENAI_API_KEY` | OpenAI API Key | 全部 |
| `GEMINI_API_KEY` | Gemini API Key（Google AI Studio 获取） | 全部 |
| `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL` / `GEMINI_BASE_URL` | 提供方专属 base url（可选，优先级低于 `AI_BASE_URL`；`OPENAI_BASE_URL` 可指向 Ollama / vLLM 等本地模型） | 全部 |
| `AI_MODEL` | 覆盖默认模型（anthropic: claude-sonnet-4-5 / openai: gpt-4o / gemini: gemini-2.0-flash） | 全部 |
| `MAX_DIFF_LENGTH` | 发送给 AI 的 diff 上限字符数（默认 40000） | 全部 |

## 配置文件 `.github/heimdall.yml`（可选）

在「被审查的仓库」放一个 `.github/heimdall.yml`，即可覆盖审查范围与规则，配置随仓库版本化：

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

# 可按需触发 @heimdall review 的账号白名单；不配置表示人人可触发
manual_reviewers:
  - octocat

# 存在未解决 critical 问题时，把 heimdall/critical 状态置为 failure
# （在分支保护里把该检查加入 required status checks 即可真正阻断合并）
block_on_critical: true

# 设为 false 时关闭自动审查（PR 打开/更新不再触发），仅响应 @heimdall review
# 手动触发——类似 Copilot Code Review 的按需模式（默认 true）
auto_review: false
```

> 三种部署模式均支持此配置；未配置时按默认行为审查全部文件。

## 架构

三种形态共享同一套审查内核，抽象为「触发 → 配置 → 数据获取 → 模型调用 → 结果解析 → 回写」管线，任一环节可独立替换：

```
触发（PR 事件 / @heimdall review 评论）
   │
   ▼
读取配置（.github/heimdall.yml）＋ 读取 PR diff（GitHub API，含 include/exclude 过滤）
   │
   ▼
调用 LLM（anthropic / openai / gemini / 本地模型，可自定义 base_url）
   │
   ▼
解析结构化结果（JSON → 严重度 / 文件 / 行号）
   │
   ▼
以 Review 回写 PR（行内评论 + 整体报告；行号映射失败自动降级）
   │
   ▼
（可选）heimdall/critical 状态检查 → 阻断合并
```

审查报告结构（由 `src/review/parse.ts` 渲染）：

```markdown
## 海姆达尔 · 代码审查报告

**变更摘要**：本次 PR 共改动 N 个文件，+X / -Y 行。

**变更概述**：一句话说明本次 PR 改了什么、影响面……

### 🔴 严重问题
- `src/auth.ts:45`：JWT 未校验 exp，存在越权风险

### 🟡 建议改进
- `src/api.ts:88`：循环内重复查询数据库，建议批量查询

### 🟢 良好实践
- `src/utils.ts:12`：使用不可变数据结构，赞
```

## 目录结构

```
heimdall/
├── app.yml                     # GitHub App Manifest（pull_request / issue_comment 事件）
├── .github/
│   ├── workflows/
│   │   ├── heimdall-review.yml # 模式 A：审查 workflow（复制到目标仓库）
│   │   ├── ci.yml              # 本仓库 CI：构建 + 单元测试
│   │   └── deploy.yml          # 模式 B：自动发布 Worker 到 Cloudflare
│   ├── ISSUE_TEMPLATE/         # Issue 模板（bug / feature）
│   └── pull_request_template.md
├── scripts/heimdall-review.js  # 模式 A：审查脚本（复制到目标仓库，零依赖）
├── worker/                     # 模式 B：Cloudflare Worker
│   ├── index.ts
│   └── wrangler.toml
├── src/                        # 共享审查内核
│   ├── index.ts                # 自托管入口（createNodeMiddleware 启动 webhook 服务）
│   ├── app.ts                  # Probot 事件订阅（自动审查 + @heimdall review）
│   ├── config.ts               # 环境配置解析（AI 提供方 / base_url / 模型）
│   └── review/
│       ├── index.ts            # 审查主流程（触发 → 过滤 → 审查 → 回写）
│       ├── prompt.ts           # 海姆达尔人设 prompt（唯一来源）
│       ├── providers.ts        # AI 提供方（anthropic / openai / gemini + 本地模型）
│       ├── parse.ts            # 结构化结果解析与报告渲染（行内评论 / 降级）
│       └── repo-config.ts      # heimdall.yml 解析 / glob 过滤 / 严重度阈值 / 白名单
├── test/                       # 单元测试（node:test，针对 lib/ 产物）
├── Dockerfile                  # 可选：自托管服务
├── CONTRIBUTING.md             # 贡献指南
├── PRD.md                      # 产品需求文档
└── README.md
```

## 常见问题

**行内评论的行号不准确怎么办？**

审查会同时产出行内评论与整体报告：能定位到 diff 新增行的以行内评论发布，无法定位（行号 0）或映射失败（GitHub 422）的自动降级进整体报告，不会丢失审查内容。审查内核使用结构化输出（JSON）解析，LLM 输出异常时同样降级为整体报告。

**审查会受上下文长度限制吗？**

会。`MAX_DIFF_LENGTH` 默认 40000 字符，超出部分会被截断；超大 PR 建议拆小或提高该值（注意模型上下文上限）。

**每次 push 都会重新审查吗？**

会（`synchronize` 事件），但**同一 commit 不会重复审查**：自动触发时会检查该 commit 是否已有海姆达尔审查，有则跳过。手动 `@heimdall review` 始终会重新审查一次。

## 路线图

已交付（M1–M4）：

- [x] 自动整体审查 + 海姆达尔人设（M1）
- [x] 变更摘要 + 严重度分级（🔴/🟡/🟢）（M2）
- [x] 行内评论，定位到具体文件与代码行（M2）
- [x] `.github/heimdall.yml` 配置化：include/exclude / min_severity / instructions（M3）
- [x] 按需审查 `@heimdall review` + `manual_reviewers` 白名单（M3/M4）
- [x] 更多 AI 提供方：Gemini、本地模型、统一 `AI_API_KEY` / `AI_BASE_URL`（M3）
- [x] 同 commit 去重（M4）
- [x] `block_on_critical` 阻断合并（M4）
- [x] 单元测试 + CI 集成
- [x] Cloudflare Worker 自动发布（GitHub Actions）

规划中：

- [ ] 增量审查（只审查新增 / 变更部分）
- [ ] 基于文件变更规模的审查分级

## License

MIT
