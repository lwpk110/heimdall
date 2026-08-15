# AGENTS.md — Project Guide (for AI Agents)

## What is this project?

**Heimdall (海姆达尔)** is an **AI code review bot**: connected to a GitHub repo, it reviews each PR's diff automatically or on demand (`@CoderHeimdall`), posting a Chinese/English review report (change summary, severity, inline comments, diff suggestions).

Core selling point: **model freedom** — supports Claude / GPT / Gemini / local models via unified `AI_API_KEY` + `AI_BASE_URL`.

## Tech Stack

- **Language**: TypeScript (strict), Node ≥ 18
- **Runtimes**: Cloudflare Workers (`nodejs_compat`), Probot (self-hosted), GitHub Actions (zero-dep script)
- **Tests**: `node:test` (tests run against the compiled `lib/`)
- **Build**: `tsc` → `lib/` (gitignored)

## Directory Cheat Sheet

| Path | Role |
| --- | --- |
| `src/review/prompt.ts` | **Heimdall persona prompt (single source)** — quality core; Worker imports it directly; changes must sync the `scripts/heimdall-review.js` copy |
| `src/review/parse.ts` | LLM JSON parse + report render + loose-JSON tolerance + dedup + **labels (en/zh/bilingual)** |
| `src/review/providers.ts` | AI providers (anthropic / openai / gemini + local) |
| `src/review/repo-config.ts` | `.github/heimdall.yml` parsing, glob filters, thresholds, whitelist |
| `src/review/index.ts` | Main review flow (trigger → filter → review → post) |
| `src/app.ts` | Probot event subscriptions (PR events + `@CoderHeimdall`) |
| `worker/index.ts` | Cloudflare Worker (webhook, signature, dedup, review, status marks) |
| `scripts/heimdall-review.js` | Actions-mode script (zero-dep, copied to target repo) |
| `template/heimdall-review.yml` | Actions-mode workflow (copied to target repo) |
| `test/` | Unit tests (node:test) |

## Common Commands

```bash
npm install
npm test              # build + unit tests (always run after code changes)
npm run build         # tsc only
npm run worker:dev    # local Worker debug
npm run worker:deploy # deploy Worker
```

## Core Conventions (read before changing code)

1. **Three modes share one core**: changes under `src/review/` apply to the Worker automatically (imported modules); `scripts/heimdall-review.js` is a **separate copy** — sync prompt/parse/render changes.
2. **Prompt is the single source**: `src/review/prompt.ts`. Quality is driven by it; change carefully + add tests.
3. **Default on-demand**: unset `auto_review` = no auto review; `@CoderHeimdall` only.
4. **Triple dedup**: `hasExistingReview` (review query) + `heimdall/reviewed` commit status (needs App `statuses` perm) + Worker module cache.
5. **Cloudflare gotchas**: explicit `import { Buffer }`; GitHub API needs `User-Agent`; free `waitUntil` 30s (use `thinking: { type: "disabled" }`).
6. **Report language**: `REVIEW_LANGUAGE` = `en` (default) / `zh` / `bilingual`; labels in `src/review/parse.ts`.

## Report Structure (rendered by parse.ts)

```
Change Summary (🟢 +X / 🔴 -Y + file table) → Overview → 🔍 issue summary
→ <details>🤖 Review Comments (table: severity|location|issue)</details>
→ <details>ℹ️ Review Info</details>
```
Inline comments (pinned to lines): `🔴 actionable title + **Fix Suggestion** + diff`.

## Config Switches

See README "Configuration Switches". Key: `.github/heimdall.yml` (`auto_review` / `block_on_critical` / `include` / `exclude` / `min_severity` / `instructions` / `manual_reviewers`) and env (`AI_PROVIDER` / `AI_MODEL` / `AI_API_KEY` / `AI_BASE_URL` / `REVIEW_LANGUAGE` / `MAX_DIFF_LENGTH`).
