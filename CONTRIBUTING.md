# Contributing

Welcome to Heimdall. This file defines the collaboration workflow — please read before opening a PR.

## Development Environment

```bash
git clone https://github.com/lwpk110/heimdall.git
cd heimdall
npm install
npm run build     # TypeScript strict-mode compile, must pass
```

## Branch Strategy

- `main` is protected; no direct pushes. All changes go through a Pull Request.
- Suggested branch naming:

| Type | Prefix | Example |
| --- | --- | --- |
| Feature | `feat/` | `feat/inline-comments` |
| Bug fix | `fix/` | `fix/build-typescript` |
| Refactor | `refactor/` | `refactor/review-pipeline` |
| Docs / flow | `chore/` | `chore/dev-workflow` |
| Build / deps | `build/` | `build/ci-setup` |

## Commit Message Convention

Use Conventional Commits (English by default):

```
<type>(<scope>): <subject>

<type>: feat | fix | refactor | chore | docs | build | test
```

Example: `feat(review): add inline comments with diff suggestions`

## Development Loop

1. Claim an Issue (or create one) and assign yourself.
2. Branch from `main`: `git checkout -b feat/xxx main`.
3. Develop on the branch; commits follow the convention above.
4. Push the branch, open a PR, link the Issue with `Closes #<issue>`.
5. Wait for CI (build + unit tests) to pass and at least one review.
6. Merge after review; delete the branch.

## Code Conventions

- TypeScript `strict` mode; no `any` (comment if genuinely necessary).
- Core review logic lives in `src/review/`; all three deployment modes share it.
- The persona prompt's single source is `src/review/prompt.ts` (imported by the Worker); the Actions script (`scripts/heimdall-review.js`) keeps a copy that must stay in sync.
- Changes to `template/heimdall-review.yml`, the Worker, or the prompt must be reflected in the README.

## Testing & Verification

- Run `npm test` (build + unit tests, `node:test`, zero-dep) before committing.
- Add/update unit tests in `test/` for review-core changes.
- For Actions-mode changes, open a test PR in a scratch repo to observe the review.
