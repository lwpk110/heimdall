# 参与开发（Contributing）

欢迎为海姆达尔贡献代码。本文件定义了协作规范，请在提交 PR 前阅读。

## 开发环境

```bash
git clone https://github.com/lwpk110/heimdall.git
cd heimdall
npm install
npm run build     # TypeScript 严格模式编译，应无报错
```

## 分支策略

- `main` 为受保护分支，禁止直接推送，所有变更必须走 Pull Request。
- 分支命名建议：

| 类型 | 前缀 | 示例 |
| --- | --- | --- |
| 新功能 | `feat/` | `feat/inline-comments` |
| Bug 修复 | `fix/` | `fix/build-typescript` |
| 重构 | `refactor/` | `refactor/review-pipeline` |
| 文档 / 流程 | `chore/` | `chore/dev-workflow` |
| 依赖 / 构建 | `build/` | `build/ci-setup` |

## 提交信息规范

采用 Conventional Commits 风格，中文或英文描述均可：

```
<type>(<scope>): <subject>

<type>: feat | fix | refactor | chore | docs | build | test
```

示例：`feat(review): 支持行内评论并定位到具体代码行`

## 开发迭代流程

1. 从路线图认领 Issue（或新建 Issue）并给自己分配。
2. 从 `main` 拉分支：`git checkout -b feat/xxx main`。
3. 在分支上开发，提交信息遵循上述规范。
4. 推送分支，创建 PR，在描述里 `Closes #<issue>` 关联 Issue。
5. 等待 CI（TypeScript 构建）通过 + 至少 1 人审查。
6. 审查通过后合并，合并后删除分支。

## 代码规范

- TypeScript `strict` 模式，禁止 `any`（如有特殊必要需注释说明）。
- 核心审查逻辑放在 `src/review/`，三种部署形态共享同一套内核。
- 海姆达尔人设 prompt 的唯一来源是 `src/review/prompt.ts`，改动需三处同步生效。
- 涉及 `heimdall-review.yml` 或 Worker 的改动，请同步更新 README 对应章节。

## 测试与验证

- 提交前本地运行 `npm run build`。
- 审查内核改动建议补充对应单测（若现有测试覆盖不足，欢迎一并补上）。
- 涉及 GitHub Actions 模式的改动，可在测试仓库实际提 PR 观察审查报告。
