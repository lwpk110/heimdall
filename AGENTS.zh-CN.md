# AGENTS.md — 项目指南（供 AI Agent 快速上手）

## 项目是什么

**海姆达尔 (Heimdall)** 是一个 **AI 代码审查机器人**：接入 GitHub 仓库后，自动或按需（`@CoderHeimdall`）审查每个 Pull Request 的 diff，以 GitHub Review 发布中文审查报告（变更摘要、严重度分级、行内评论、diff 修复建议）。

核心卖点：**模型自由**——支持 Claude / GPT / Gemini / 本地模型，统一 `AI_API_KEY` + `AI_BASE_URL` 可走任意代理网关。

## 技术栈

- **语言**：TypeScript（strict）、Node ≥ 18
- **运行时**：Cloudflare Workers（`nodejs_compat`）、Probot（自托管）、GitHub Actions（零依赖脚本）
- **测试**：`node:test`（零依赖，测试 `lib/` 编译产物）
- **构建**：`tsc`（`lib/`，gitignore）

## 目录速览

| 路径 | 作用 |
| --- | --- |
| `src/review/prompt.ts` | **海姆达尔人设 prompt（唯一来源）**——审查质量核心，Worker 直接 import；改这里要同步 `scripts/heimdall-review.js` 的副本 |
| `src/review/parse.ts` | LLM 结构化 JSON 解析 + 报告渲染 + 宽松 JSON 容错 + 去重 |
| `src/review/providers.ts` | AI 提供方（anthropic / openai / gemini + 本地模型）|
| `src/review/repo-config.ts` | `.github/heimdall.yml` 解析、glob 过滤、严重度阈值、白名单 |
| `src/review/index.ts` | 审查主流程（触发 → 过滤 → 审查 → 回写）|
| `src/app.ts` | Probot 事件订阅（PR 事件 + `@CoderHeimdall` 评论）|
| `worker/index.ts` | Cloudflare Worker（webhook 接收、签名校验、去重、审查、状态标记）|
| `scripts/heimdall-review.js` | Actions 模式审查脚本（零依赖，复制到目标仓库）|
| `template/heimdall-review.yml` | Actions 模式 workflow（复制到目标仓库）|
| `test/` | 单元测试（node:test）|

## 常用命令

```bash
npm install
npm test              # 构建 + 单元测试（改代码后必跑）
npm run build         # 仅 tsc
npm run worker:dev    # 本地调试 Worker
npm run worker:deploy # 部署 Worker
```

## 核心约定（改代码必读）

1. **审查内核三形态共享**：改 `src/review/` 下的逻辑，Worker 自动生效（import 共享模块）；但 `scripts/heimdall-review.js` 是**独立副本**，涉及 prompt / 解析 / 渲染的改动必须同步。
2. **prompt 是唯一来源**：`src/review/prompt.ts`。审查质量由它决定，改动需谨慎并补测试。
3. **默认仅按需审查**：`auto_review` 未配置 = PR 打开不自动审，`@CoderHeimdall` 才审。
4. **去重三重机制**：`hasExistingReview`（GitHub review 查询）+ `heimdall/reviewed` commit status（需 App `statuses` 权限）+ Worker 模块级缓存。
5. **Cloudflare 坑**：Worker 需显式 `import { Buffer }`；GitHub API 请求必须带 `User-Agent`；free 计划 `waitUntil` 30s（AI 请求用 `thinking: { type: "disabled" }`）。

## 审查报告结构（parse.ts 渲染）

```
变更摘要（🟢 +X / 🔴 -Y + 文件表格）→ 变更概述 → 🔍 问题汇总
→ <details>🤖 审查评论（表格：严重度|位置|问题）</details>
→ <details>ℹ️ 审查信息</details>
```
行内评论（挂在代码行）：`🔴 行动式标题 + **修复建议** + diff 代码块`。

## 完整配置开关

见 README「配置开关速查」章节。关键：
- `.github/heimdall.yml`：`auto_review` / `block_on_critical` / `include` / `exclude` / `min_severity` / `instructions` / `manual_reviewers`
- 环境变量：`AI_PROVIDER` / `AI_MODEL` / `AI_API_KEY` / `AI_BASE_URL` / `MAX_DIFF_LENGTH`
