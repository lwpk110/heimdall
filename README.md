# 海姆达尔 (Heimdall)

> "我能看见九界中的一切，也包括你代码里的每一个问题。" —— 海姆达尔

海姆达尔是一个 AI 代码审查机器人。它像守护彩虹桥一样守望着你的每一个 Pull Request，在有人提交代码时自动审查 diff，并以 GitHub Review 的形式发布中文审查报告。

## 特性

- **双部署模式**：GitHub Actions（单仓库自用、零服务器）或 Cloudflare Workers（无服务器、可作为 GitHub App 分发）
- 自动监听 PR 的 `opened` / `reopened` / `synchronize` 事件
- 调用 Claude（Anthropic）或 GPT（OpenAI）审查 diff
- 以 PR Review 形式发布报告：变更摘要 + 严重度分级（🔴 严重 / 🟡 建议 / 🟢 良好）
- 行内评论定位到具体文件与代码行，行号映射失败时自动降级为整体报告，不丢失审查内容
- 跳过草稿 PR 与机器人发起的 PR，避免干扰
- 支持模型与 diff 长度上限配置，防止超大 PR 超出上下文

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

- `ANTHROPIC_API_KEY`（默认）、`OPENAI_API_KEY` 或 `GEMINI_API_KEY`

可选：在 **Variables** 添加 `AI_PROVIDER`（`anthropic` / `openai` / `gemini`）、`AI_MODEL` 覆盖默认模型；本地模型（Ollama / vLLM 等 OpenAI 兼容端点）可设 `OPENAI_BASE_URL`。

### 3. 验证

在目标仓库提一个 PR，海姆达尔会自动在 **Files changed** 页发布审查报告。

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
   - **GitHub App name**：`heimdall`（需全局唯一，重名可加后缀）
   - **Webhook URL**：部署 Worker 后填 `https://heimdall.<你的子域>.workers.dev/api/github/webhooks`
   - **Webhook secret**：生成随机串并保存
   - **Permissions**：`Pull requests` → Read & write；`Contents` → Read-only；`Metadata` → Read-only
   - **Subscribe to events**：`pull_request`
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
npx wrangler secret put ANTHROPIC_API_KEY
npm run worker:deploy
```

> `GITHUB_PRIVATE_KEY` 换行可写成 `\n`（代码会自动还原），或在 Cloudflare Dashboard 直接粘贴原值。

部署后把 GitHub App 的 **Webhook URL** 改成 Worker 地址，即可生效。

---

## 可选：自托管服务（Docker / Probot）

不想用 Cloudflare、希望代码完全不出内网时，可用仓库内提供的传统 Probot 服务：

```bash
cp .env.example .env        # 填写 APP_ID / WEBHOOK_SECRET / PRIVATE_KEY / ANTHROPIC_API_KEY
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
| `ANTHROPIC_API_KEY` | Anthropic API Key | 全部 |
| `OPENAI_API_KEY` | OpenAI API Key | 全部 |
| `GEMINI_API_KEY` | Gemini API Key（Google AI Studio 获取） | 全部 |
| `OPENAI_BASE_URL` | OpenAI 兼容端点（本地模型 Ollama / vLLM 可指向自建地址） | 全部 |
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
```

> 三种部署模式均支持此配置；未配置时按默认行为审查全部文件。

## 架构

三种形态共享同一套审查内核：

```
PR 事件（Actions 调度 / GitHub webhook）
   │
   ▼
读取 PR diff (GitHub API)
   │
   ▼
调用 LLM（Claude / GPT）——海姆达尔人设 prompt
   │
   ▼
以 Review 形式回写 PR
```

## 目录结构

```
heimdall/
├── app.yml                    # GitHub App Manifest
├── .github/workflows/         # 模式 A：GitHub Actions workflow（复制到目标仓库）
├── scripts/heimdall-review.js # 模式 A：审查脚本（复制到目标仓库）
├── worker/                    # 模式 B：Cloudflare Worker
│   ├── index.ts
│   └── wrangler.toml
├── Dockerfile                 # 可选：自托管服务
├── src/                       # 共享审查内核（Probot 版本）
│   ├── index.ts
│   ├── app.ts
│   ├── config.ts
│   └── review/
│       ├── index.ts
│       ├── prompt.ts          # 海姆达尔人设 prompt（唯一来源）
│       └── providers.ts       # AI 提供方（Anthropic / OpenAI）
└── PRD.md                     # 产品需求文档
```

## 常见问题

**行内评论的行号不准确怎么办？**

审查会同时产出行内评论与整体报告：能定位到 diff 新增行的以行内评论发布，无法定位（行号 0）或映射失败（GitHub 422）的自动降级进整体报告，不会丢失审查内容。审查内核使用结构化输出（JSON）解析，LLM 输出异常时同样降级为整体报告。

**审查会受上下文长度限制吗？**

会。`MAX_DIFF_LENGTH` 默认 40000 字符，超出部分会被截断；超大 PR 建议拆小或提高该值（注意模型上下文上限）。

**每次 push 都会重新审查吗？**

会（`synchronize` 事件）。如果觉得太吵，可以在 workflow / app.ts 里删掉 `synchronize`。

## 路线图

- [x] 行内评论（定位到具体代码行）
- [x] 支持更多 AI 提供方（Gemini、本地模型）→ 进行中
- [ ] 基于文件变更规模的审查分级
- [ ] 审查结果去重 / 增量审查
- [x] `.github/heimdall.yml` 配置化（见 PRD）

## License

MIT
