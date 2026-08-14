# 海姆达尔 (Heimdall) — 产品需求文档（PRD）

| 项目 | 内容 |
| --- | --- |
| 产品名称 | 海姆达尔（Heimdall） |
| 文档版本 | v0.1（草案） |
| 日期 | 2026-08-14 |
| 状态 | 设计阶段 |
| 定位 | 复刻 GitHub Copilot Code Review 的开源可自部署替代品 |

---

## 1. 主旨

**一句话定位：** 海姆达尔是一个以"阿斯加德彩虹桥守护者"为产品人格、复刻 GitHub Copilot Code Review 核心能力、但可**自由选择 AI 模型、私有化部署、深度定制审查规则**的代码审查机器人。

**要解决的问题：**

1. **人工审查成本高**：高质量 code review 极度依赖资深工程师时间，小团队没有专职 reviewer，PR 长期堆积。
2. **Copilot 的局限**：GitHub Copilot Code Review 只能使用 GitHub 官方模型，按席位订阅计费，代码需经过微软云处理；团队无法选择更符合自身偏好的模型（如 Claude），也无法把代码留在自己的服务器。
3. **审查标准不统一**：团队缺少可沉淀、可执行的统一审查规则，不同人审查尺度不一。

**产品形态：** 代码审查机器人，支持双部署模式——**GitHub Actions**（单仓库自用、零服务器）与 **Cloudflare Workers**（作为 GitHub App 后端、无服务器、可分发安装），另提供自托管 Probot / Docker 方案。三种形态共享同一套审查内核：读取 PR diff → 调用 LLM → 以 GitHub Review 形式回写。

**目标用户：**
- 个人开发者与开源维护者：零成本给每个 PR 配一个 AI reviewer
- 中小技术团队：把 AI 审查纳入评审流程，统一代码质量基线
- 隐私 / 合规敏感团队：需要代码不出内网的自托管方案

**非目标（v1 明确不做）：**
- 不生成代码、不自动修复 PR（只守卫、不代写）
- 不做 IDE 内联提示（那是 Copilot 本体，不是 code review 范畴）
- 不做 CI 之外的静态分析引擎

---

## 2. 创意

### 2.1 产品人格化：海姆达尔人设

- 名字取自北欧神话 / 漫威宇宙的 **Heimdall（海姆达尔）**：阿斯加德彩虹桥（Bifrost）的守护者，拥有洞悉九界一切的眼睛，手持巨剑，守望神域的入口。
- 映射到产品：机器人"看穿每一行代码，守护合并之门"——所有 PR 都要经过它守卫的彩虹桥，才能通往合并。
- 审查报告以海姆达尔口吻输出，采用固定三段式结构【严重问题】【建议改进】【良好实践】，冷静、直击要害、不客套。

### 2.2 与 Copilot Code Review 的差异化

| 维度 | GitHub Copilot Code Review | 海姆达尔（Heimdall） |
| --- | --- | --- |
| 模型 | 仅 GitHub 官方模型 | 自由选择 Claude / GPT / 未来本地模型 |
| 部署 | 微软云 | 自托管 / 私有化，代码不出服务器 |
| 计费 | 按席位订阅 | 按 API 用量，无席位费用 |
| 审查规则 | 有限配置（language 等） | 可编程 prompt + 配置文件，规则可沉淀 |
| 产品人格 | 工具感 | 海姆达尔人设，报告风格统一 |
| 开源 | 否 | 是 |

### 2.3 可扩展的审查管线

抽象出「数据获取 → 模型调用 → 结果解析 → 回写」四层管线，未来可替换任意环节：
- 模型层：Anthropic / OpenAI / 兼容 OpenAI 协议的本地模型（Ollama、vLLM）
- 解析层：把模型输出解析成结构化评论（文件 / 行号 / 严重度）
- 回写层：整体 Review / 行内评论 / 合并请求状态

---

## 3. 复刻 Copilot Code Review 的功能范围

对标 GitHub Copilot Code Review 的能力清单，分优先级落地：

| 能力 | 描述 | 优先级 |
| --- | --- | --- |
| 自动审查 | PR `opened` / 新 commit 推送时自动触发 | P0 |
| 整体审查报告 | 以 Review 形式发布结构化中文报告 | P0 |
| 按需审查 | 在 PR 评论 `@heimdall review` 手动触发 | P1 |
| 行内评论 | 定位到具体文件 + 代码行，可逐条回复 | P1 |
| 严重度分级 | 评论标注 critical / important / normal | P1 |
| 变更摘要 | 总结 PR 改了什么、影响面、需要关注的点 | P1 |
| 配置文件 | `.github/heimdall.yml` 控制审查范围、排除文件、自定义规则 | P1 |
| 语言 / 文件过滤 | 只审查指定语言 / 排除生成代码、lock 文件 | P1 |
| 审查者白名单 | 配置哪些人可触发按需审查 | P2 |
| 阻止合并 | 存在未解决 critical 评论时置为需检查状态 | P2 |
| 审查缓存 / 去重 | 相同 commit 不重复审查，避免刷屏 | P2 |
| 自定义 prompt | 团队写入自己的编码规范作为审查准则 | P2 |

---

## 4. User Stories

### 4.1 开发者视角

**US-1 自动审查**
> 作为开发者，我提交一个 PR 时，希望能自动获得 AI 代码审查，以便在合并前尽早发现问题。

- 验收：PR 打开后 ≤ 60 秒内，审查报告出现在 PR 上；每个新 commit 自动更新审查。

**US-2 行内定位**
> 作为开发者，我希望审查意见能定位到具体文件和代码行，以便直接跳转修复，而不是看一段摘要猜位置。

- 验收：严重问题至少 80% 能关联到正确的文件与行号（以新文件行号计算）。

**US-3 严重度排序**
> 作为开发者，我希望审查结果按严重程度分级，以便优先处理 critical 问题。

- 验收：评论带 critical / important / normal 标签，报告顶部先列出 critical。

**US-4 按需触发**
> 作为开发者，我不想每次 push 都被审查打扰，希望能手动让机器人再审一次。

- 验收：在 PR 评论 `@heimdall review` 可触发重新审查；非白名单用户触发被忽略。

### 4.2 团队负责人视角

**US-5 统一审查规范**
> 作为团队负责人，我希望团队的审查规则可配置、可沉淀，以便新人也能按统一标准提交代码。

- 验收：通过 `.github/heimdall.yml` 可配置语言过滤、排除路径、自定义审查指令；规则随仓库版本化。

**US-6 阻断风险**
> 作为团队负责人，我希望存在严重问题的 PR 不被轻易合并，以便守住质量红线。

- 验收：存在未解决 critical 评论时，PR 状态显示为需检查 / 不能直接合并。

### 4.3 隐私 / 合规视角

**US-7 私有化部署**
> 作为合规敏感团队，我希望代码不需要经过第三方云，以便满足数据安全要求。

- 验收：全部代码部署在公司内网；可对接公司内网模型网关；不向公共网络发送源码。

### 4.4 开源维护者视角

**US-8 降低维护负担**
> 作为开源维护者，我希望外部贡献者的 PR 能先被 AI 初步审查，以便我聚焦在真正值得看的地方。

- 验收：任何人都能对公开仓库 PR 触发按需审查；审查报告不阻塞人工流程。

### 4.5 部署视角

**US-9 双模式部署**
> 作为开发者，我希望既能在单个仓库零配置跑起来（GitHub Actions），也能部署成可安装的机器人（Cloudflare Workers），以便按场景选择。

- 验收：同一套审查内核（prompt / 模型调用 / 报告格式）在两种模式下产出一致；分别提供可直接运行的 workflow 与 Worker 入口。

---

## 5. 功能需求（关键用例）

### 5.1 自动审查主流程

```
触发：pull_request.opened / reopened / synchronize
   ↓
[1] 校验：跳过草稿 PR、机器人 PR
   ↓
[2] 读取 diff（GitHub API pulls.listFiles）
   ↓
[3] 组装 prompt（海姆达尔人设 + 团队自定义规则 + diff）
   ↓
[4] 调用 LLM（anthropic / openai / 自定义端点）
   ↓
[5] 解析结果 → 结构化评论（可选：文件 / 行号 / 严重度）
   ↓
[6] 回写：createReview 发布审查
```

> 主流程在两种模式下一致，仅「触发与运行环境」不同：Actions 模式由 CI 调度触发、运行在 GitHub 托管环境；Workers 模式由 webhook 触发、运行在 Cloudflare 边缘。差异详见第 6 节。

### 5.2 配置项（`.github/heimdall.yml` 草案）

```yaml
# 海姆达尔配置文件示例
version: 1

# 审查触发时机：on_open / on_update / manual
trigger:
  - on_open
  - on_update

# 语言 / 文件过滤
include: ["*.ts", "*.js", "*.py", "*.go"]
exclude: ["**/generated/**", "**/*.min.js", "**/package-lock.json"]

# 严重度阈值：低于该级别的不展示
min_severity: normal

# 团队自定义审查指令（追加到系统 prompt）
instructions: |
  本项目使用 TypeScript，遵循 strict 模式。
  禁止使用 any。
  错误处理必须返回 Result，不得抛裸异常。

# 阻止合并
block_on_critical: true

# 按需审查白名单
manual_reviewers:
  - octocat
```

### 5.3 审查报告格式（草案）

```markdown
## 海姆达尔 · 代码审查报告

**变更摘要**：本次 PR 共改动 12 个文件，+214 / -58 行，涉及认证模块重构……

### 🔴 严重问题
- `src/auth.ts:45`：JWT 未校验 `exp`，存在越权风险

### 🟡 建议改进
- `src/api.ts:88`：循环内重复查询数据库，建议批量查询

### 🟢 良好实践
- `src/utils.ts:12`：使用不可变数据结构，赞
```

---

## 6. 双部署模式

### 6.1 模式总览

| 维度 | 模式 A：GitHub Actions | 模式 B：Cloudflare Workers |
| --- | --- | --- |
| 定位 | 仓库内自用的零配置方案 | 可作为 GitHub App 分发安装的无服务器方案 |
| 触发方式 | GitHub 调度的 CI workflow | GitHub webhook → Cloudflare 边缘函数 |
| 需要服务器 | 否（运行在 GitHub 托管环境） | 否（运行在 Cloudflare 边缘） |
| 需要注册 GitHub App | 否 | 是 |
| 适用场景 | 个人项目、少数自有仓库 | 团队多仓库、开源分发、产品化 |
| 安装方式 | 复制 workflow + 脚本到目标仓库 | 安装 GitHub App |
| 部署成本 | 免费（GitHub 托管） | 免费额度内（Workers 10 万请求/天） |
| 代码处理位置 | GitHub Actions 运行环境 | Cloudflare 边缘 |
| 更新方式 | 每个仓库各自更新 | 改一处，全量生效 |

两种模式共享同一套审查内核（prompt、模型调用、报告格式），仅「运行环境」不同，因此审查质量与配置语义保持一致。

### 6.2 模式 A：GitHub Actions（推荐自用）

**原理：** 在目标仓库内放置一个 workflow（`.github/workflows/heimdall-review.yml`）与一个 Node 脚本（`scripts/heimdall-review.js`）。PR 事件触发 CI，脚本读取 diff → 调用 LLM → 以 PR Review 形式回写。

**优点**
- 零服务器、零 App 注册、零额外配置
- 直接复用仓库已有的 Secrets（`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`）
- 审查逻辑随仓库版本化，人人可见、可改

**使用方式**
```bash
# 把两个文件复制到「被审查的仓库」
cp .github/workflows/heimdall-review.yml <目标仓库>/.github/workflows/
cp scripts/heimdall-review.js            <目标仓库>/scripts/
```
在目标仓库 Settings → Secrets 配置 AI Key 后即生效。

### 6.3 模式 B：Cloudflare Workers（推荐产品化）

**原理：** 将海姆达尔部署为 Cloudflare Worker，作为 GitHub App 的 Webhook 接收端。PR 事件到达时，Worker 校验签名 → 读取 diff → 调用 LLM → 以 Review 回写。App 安装到任意仓库即生效，可团队共享、可分发。

```
GitHub PR 事件
   │ webhook
   ▼
Cloudflare Worker（校验签名）
   │ 换取安装令牌（JWT + App 私钥）
   ▼
读取 PR diff (GitHub API)
   │
   ▼
调用 LLM（Claude / GPT）
   │
   ▼
以 Review 回写 PR
```

**优点**
- 无服务器、全球边缘、高可用，免费额度充裕
- 一次部署，安装到任意数量的仓库
- 更新一次全量生效，不依赖各仓库代码

**使用方式**
```bash
npm run worker:dev        # 本地调试
npm run worker:deploy     # 部署到 Cloudflare
```
用 `wrangler secret put` 配置 `GITHUB_APP_ID`、`GITHUB_PRIVATE_KEY`、`WEBHOOK_SECRET`、`ANTHROPIC_API_KEY`，然后在 GitHub App 设置页把 Webhook URL 指向 Worker 地址。

### 6.4 模式选择建议

| 你的情况 | 推荐模式 |
| --- | --- |
| 只想给自己的仓库加个 AI reviewer | A：GitHub Actions |
| 团队多仓库统一使用、一份配置多处生效 | B：Cloudflare Workers |
| 想做成可安装的开源机器人产品 | B：Cloudflare Workers（后续可上 Marketplace） |
| 合规要求代码不出内网 | 自托管 Probot 服务（Docker，仓库内已提供） |
| 两种都想要 | A 提供单仓库快速体验，B 作为长期统一方案，可并行 |

---

## 7. 非功能需求

| 类别 | 要求 |
| --- | --- |
| 性能 | 小 PR（< 500 行）端到端审查延迟 < 60s |
| 成本 | 单次审查成本可控：diff 超限截断 + 模型档位可选；支持按 max_tokens 封顶 |
| 安全 | Webhook 签名校验；私钥仅存环境变量 / 密钥管理服务；不记录源码日志 |
| 可靠性 | LLM 调用失败自动降级为失败报告而非静默丢失；幂等（同 commit 不重复评论） |
| 可维护性 | TypeScript 严格模式；模块化四层管线；核心逻辑单元测试覆盖 |

---

## 8. 成功指标

- **审查覆盖率**：≥ 80% 的非草稿 PR 获得审查
- **平均审查延迟**：小 PR P50 < 30s，P95 < 60s
- **评论采纳率**：≥ 40% 的 critical 评论被开发者采纳修复（可通过"已解决线程"统计）
- **误报率**：目标 critical 误报率 < 20%（抽样人工标注）
- **配置采用率**：使用自定义 `heimdall.yml` 的仓库占比

---

## 9. 里程碑

| 里程碑 | 版本 | 范围 | 目标 |
| --- | --- | --- | --- |
| M1 | v0.1 | 自动整体审查 + 海姆达尔人设 prompt | 让机器人"跑起来"并给出像样报告 |
| M2 | v0.2 | 行内评论 + 严重度分级 + 变更摘要 | 对齐 Copilot 主要体验 |
| M3 | v0.3 | `heimdall.yml` 配置化 + 语言/文件过滤 + 按需触发 | 可定制、可接入真实团队流程 |
| M4 | v1.0 | 阻止合并 + 白名单 + 审查缓存去重 | 达到可正式使用的产品完成度 |

> 当前代码仓库脚手架已完成 v0.1（M1）的基础工程：双部署模式（GitHub Actions workflow + Cloudflare Worker）、共享审查内核（Claude / GPT 双后端）、事件订阅、整体 Review 回写，以及自托管 Probot 方案。

---

## 10. 风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| LLM 行号映射错误导致 422 | 行内评论不可用 | v1 先做整体报告，行内评论走独立的行号解析模块并加校验重试 |
| 误报刷屏导致开发者忽略机器人 | 产品失效 | 严重度分级 + 可关闭 / 白名单 + 配置阈值 |
| API 成本不可控 | 团队弃用 | diff 截断、模型档位、按需触发降噪 |
| 敏感信息经 LLM 泄露 | 合规风险 | 私有化部署 + 可替换为本地模型端点 |
| 每个 commit 重复审查噪音大 | 体验差 | 审查缓存去重（M4），默认只在关键节点触发 |
| 双模式行为不一致 | 体验分裂 | 共享审查内核（prompt / 模型调用 / 报告格式），仅运行环境不同，并在文档中明确差异 |

---

## 11. 附录：Copilot Code Review 对标说明

GitHub Copilot Code Review 的公开能力（截至本 PRD 编写时）：
- PR 打开时自动生成 AI 审查，也可通过 `@copilot review` 评论触发
- 在 Files changed 中提供行内评论，按严重度（critical / important / normal）分类
- 提供变更摘要与审查总结
- 支持仓库级配置文件（如 `.github/copilot-review.yml`）控制审查范围、语言、指令
- 支持把 AI 审阅者加入 reviewer 列表，并可作为 required review 阻断合并

海姆达尔（Heimdall）在功能层面逐一对齐上述能力，并通过模型自由、私有化部署、开源可扩展形成差异。个别深度绑定 GitHub 官方产品的细节（如 AI 审阅者直接出现在 reviewer 下拉框）不在复刻范围内，采用"配置阻断合并 + 状态标识"的等效方案。
