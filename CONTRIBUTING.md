# Contributing

Welcome! Thanks for helping improve Heimdall. Please read this before opening a PR.

## Dev Setup

```bash
git clone https://github.com/lwpk110/heimdall.git
cd heimdall
npm install
npm test                 # build + unit tests
```

## Branch Strategy

- `main` is protected — no direct pushes; all changes go through PRs.
- Suggested prefixes:

| Type | Prefix | Example |
| --- | --- | --- |
| Feature | `feat/` | `feat/inline-comments` |
| Bug fix | `fix/` | `fix/build-typescript` |
| Refactor | `refactor/` | `refactor/review-pipeline` |
| Docs / process | `chore/` | `chore/dev-workflow` |
| Build / deps | `build/` | `build/ci-setup` |

## Commit Convention

Conventional Commits (EN or CN):

```
<type>(<scope>): <subject>
<type>: feat | fix | refactor | chore | docs | build | test
```

Example: `feat(review): add inline comments with diff suggestions`

## Dev Iteration Flow

1. Claim an Issue from the roadmap (or create one) and self-assign.
2. Branch from `main`: `git checkout -b feat/xxx main`.
3. Commit following the convention above.
4. Push, open a PR, reference the issue with `Closes #<issue>`.
5. Wait for CI (build + tests) and at least 1 review.
6. Merge, then delete the branch.

## Code Standards

- TypeScript `strict`; no `any` (annotate if truly necessary).
- Core review logic lives in `src/review/` — shared by all three deployment modes.
- The Heimdall persona prompt's **single source** is `src/review/prompt.ts` (shared by Worker); the Actions copy in `scripts/heimdall-review.js` must be kept in sync.
- Changes to `template/heimdall-review.yml`, the Worker, or the prompt must update the corresponding README section.

## Testing & Verification

- Run `npm test` (build + unit tests, zero-dep `node:test`) before committing.
- Add `test/` unit tests for review-core changes.
- For GitHub Actions mode changes, verify with a real PR in a test repo.
