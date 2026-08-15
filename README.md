# Heimdall (海姆达尔)

> *"I can see everything in the Nine Realms — and every problem in your code."* — Heimdall

**Heimdall is an AI code review bot.** Connect it to your GitHub repository and it reviews every Pull Request's diff — automatically or on demand — posting a professional review with change summary, severity grading, inline comments, and executable diff suggestions.

**Key: model freedom.** You configure the model — Claude / GPT / Gemini / local models (Ollama, vLLM) — via a unified `AI_API_KEY` + `AI_BASE_URL` or per-provider keys. Your code and reviews never leave your own configuration.

> 📖 Chinese version: [README.zh-CN.md](README.zh-CN.md)

### 🥲 Why does Heimdall exist? (A story of one too many "unilateral contract changes")

> It all began with a classic tale of corporate "plan optimization" —
> 
> One fine morning, Copilot arbitrarily revised its subscription deal: models were quietly downgraded, token limits shrank, and available choices vanished overnight. Best of all? That $10/month subscription fee was collected right on schedule, yet your Code Review quota **reliably ran out by mid-month, greeting you with: *"Quota limit reached. Please upgrade or purchase additional credits."***
> 
> By month's end, the math was brutal: **You paid full price, ran out of tokens half-way through the month, had zero Code Review when PRs actually hit, and successfully contributed another line-item to a tech giant's earnings report.** 🤡
>
> **Heimdall exists to break out of this subscription trap:**
> - **Total Model Freedom**: Want Claude 3.5 Sonnet? GPT-4o? Gemini 2.0 Flash? Or a self-hosted DeepSeek via Ollama/vLLM? It's 100% your call.
> - **Pay-for-What-You-Use**: Use your own API key or team gateway. No more $10 "all-you-can-eat" plans that starve your quota after two weeks.
> - **Unshakeable Bridge**: Heimdall's Bifrost Guardian never changes terms mid-flight, nor pops up mid-month paywalls.

## Features

- **Three deployment modes**: GitHub Actions (per-repo, zero server) / Cloudflare Workers (serverless, installable as a GitHub App) / Probot self-hosted (code never leaves your intranet)
- **On-demand review (default)**: PRs are not auto-reviewed on open; comment `@CoderHeimdall` to trigger (Copilot-style). Set `auto_review: true` to enable auto review
- **Model freedom**: Claude / GPT / Gemini / local models, unified `AI_API_KEY` + `AI_BASE_URL`
- **Professional report**: change summary + file table + severity (🔴/🟡/🟢) + focus areas + verification steps + issue summary
- **Inline comments + diff**: each issue pinned to its code line, with actionable title + 💡 fix suggestion + diff + GitHub 1-Click Suggestion
- **`.github/heimdall.yml` config**: include/exclude filters, `min_severity`, custom instructions, whitelist, `block_on_critical`, `auto_review`
- **Review language**: `REVIEW_LANGUAGE` = `en` (default) / `zh` / `bilingual`
- **Quality**: same-commit dedup (triple), `heimdall/critical` status blocks merge, sensitive-field/trust-boundary deep checks, loose JSON parsing
- Skips draft & bot PRs; unit-tested (node:test)

---

## Quick Start (2 minutes, single repo)

**Simplest (Mode A: GitHub Actions)** — add an AI reviewer to any repo:

```bash
# In the target repo
mkdir -p .github/workflows scripts
cp template/heimdall-review.yml .github/workflows/
cp scripts/heimdall-review.js scripts/
```

Then in the target repo **Settings → Secrets and variables → Actions** add:
- `AI_API_KEY` (recommended) or `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY`
- Optional Variables: `AI_MODEL`, `AI_BASE_URL`

Open a PR and comment `@CoderHeimdall` (or `@heimdall`) to see the review. For auto-review, add `.github/heimdall.yml` with `auto_review: true`.

## Choosing a Mode

| | Mode A: GitHub Actions | Mode B: Cloudflare Workers |
| --- | --- | --- |
| Purpose | Single repo, quick | Team / productized distribution |
| GitHub App needed | No | Yes |
| Server | No | No (Cloudflare edge) |
| Install | Copy 2 files | Install GitHub App |
| Cost | Free | Free tier (Pro for large diffs) |

- **Just want an AI reviewer for your repo** → Mode A, 2 minutes
- **Team-wide / installable bot** → Mode B

---

## Mode A: GitHub Actions

### 1. Copy files to the target repo

```bash
mkdir -p <target>/.github/workflows <target>/scripts
cp template/heimdall-review.yml <target>/.github/workflows/
cp scripts/heimdall-review.js <target>/scripts/
cp scripts/observability.js <target>/scripts/
```

### 2. Configure AI

In the target repo **Settings → Secrets and variables → Actions**:

| Secret | Purpose |
| --- | --- |
| `AI_API_KEY` | Unified key (gateway, recommended) |
| or `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` | Per-provider keys |

| Variable | Purpose |
| --- | --- |
| `AI_MODEL` | Override default model |
| `AI_BASE_URL` | Gateway / local model URL |
| `AI_PROVIDER` | `anthropic` / `openai` / `gemini` |

### 3. Use

- **On-demand (default)**: comment `@CoderHeimdall` to trigger
- **Auto**: add `.github/heimdall.yml` with `auto_review: true`

---

## Mode B: Cloudflare Workers (full setup)

> Making Heimdall an **installable GitHub App**. Follow the order — many pitfalls come from wrong ordering.

### Overview (5 steps)

```
① Deploy Worker  →  ② Register GitHub App  →  ③ Configure repo Secrets
→  ④ Install App + Webhook  →  ⑤ Verify
```

### ① Deploy Worker

```bash
npm install
npm run worker:dev          # local debug
npx wrangler login          # first time
npm run worker:deploy       # outputs https://heimdall.<your-subdomain>.workers.dev
```

Save the **Webhook URL**:

```
https://heimdall.<your-subdomain>.workers.dev/api/github/webhooks
```

### ② Register GitHub App

**Option 1: Manifest (recommended)**

```
https://github.com/settings/apps/new?url=https://raw.githubusercontent.com/<you>/<repo>/main/app.yml
```

**Option 2: Manual** — GitHub → Settings → Developer settings → GitHub Apps → New GitHub App:

| Field | Value |
| --- | --- |
| **GitHub App name** | `CoderHeimdall` (globally unique) |
| **Webhook URL** | the ① URL |
| **Webhook secret** | random string (save for step ③) |
| **Permissions** | `Pull requests` R/W · `Contents` R · `Issues` R/W · **`Statuses` R/W** (dedup + block_on_critical) · `Metadata` R |
| **Subscribe to events** | **check `pull_request`, `issue_comment`** (missing = no events!) |

Save **App ID**, generate & download **Private key (.pem)**.

### ③ Configure repo Secrets

In the heimdall repo **Settings → Secrets and variables → Actions**:

| Secret | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare token (`Workers Scripts: Edit`) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |
| `GH_APP_ID` | App ID (must NOT start with `GITHUB_`) |
| `GH_APP_PRIVATE_KEY` | Full PEM (BEGIN/END + newlines) |
| `GH_WEBHOOK_SECRET` | Webhook secret from ② |
| `AI_API_KEY` / `AI_BASE_URL` | AI config (optional) |

Then push to `main` or run the `Deploy Worker` workflow — it auto-deploys and writes these secrets.

### ④ Install App + Webhook

1. **Install App** → install to your account/repos (All repositories ok)
2. Confirm **Webhook URL** & secret match step ① / `GH_WEBHOOK_SECRET`
3. If you rename the App or change config, **re-verify Webhook URL & event subscriptions** (renaming resets the webhook!)

### ⑤ Verify

Open a PR in an installed repo (or comment `@CoderHeimdall` on one) and check **Files changed** for the `CoderHeimdall[bot]` review.

---

## AI Model Configuration (model freedom)

Three ways:

### Unified (recommended, via gateway)

```bash
AI_API_KEY=<gateway-key>
AI_BASE_URL=https://<gateway>/
AI_MODEL=claude-sonnet-5
```

### Per-provider

| Provider | Variables | Default model |
| --- | --- | --- |
| Anthropic | `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL` | claude-sonnet-4-5-20250929 |
| OpenAI | `OPENAI_API_KEY` / `OPENAI_BASE_URL` | gpt-4o |
| Gemini | `GEMINI_API_KEY` / `GEMINI_BASE_URL` | gemini-2.0-flash |
| Local | `OPENAI_API_KEY` + `OPENAI_BASE_URL=http://localhost:11434/v1` | Ollama / vLLM |

`AI_API_KEY` / `AI_BASE_URL` take priority; fallback to per-provider.

> `AI_MODEL` must be supported by your gateway/provider, or you get `model_not_found`.

---

## Configuration Switches (cheat sheet)

| Capability | Switch / Param | Where |
| --- | --- | --- |
| **Auto review on PR open** | `auto_review: true` | `.github/heimdall.yml` |
| Manual trigger | comment `@CoderHeimdall` | default |
| Provider | `AI_PROVIDER = anthropic \| openai \| gemini` | env / Variable |
| Model | `AI_MODEL` | env / Variable / `wrangler.toml [vars]` |
| Gateway / local | `AI_BASE_URL` | env / Variable |
| Per-provider base | `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL` / `GEMINI_BASE_URL` | env / Variable |
| **Report language** | `REVIEW_LANGUAGE = en \| zh \| bilingual` (**default en**) | env / Variable |
| Diff length cap | `MAX_DIFF_LENGTH` (default 40000) | env / `wrangler.toml [vars]` |
| Observability: detailed logs | `HEIMDALL_LOG_ENABLED` (**default true**) | env / Variable / `wrangler.toml [vars]` |
| Observability: per-review summary | `HEIMDALL_INVOCATION_LOGS` (**default true**) | env / Variable / `wrangler.toml [vars]` |
| Observability: log level | `HEIMDALL_LOG_LEVEL = error \| warn \| info \| debug` (**default info**) | env / Variable / `wrangler.toml [vars]` |
| Observability: per-repo override | `observability.logs.enabled / invocation_logs` | `.github/heimdall.yml` |
| Only review some files | `include: ["*.ts", ...]` | `.github/heimdall.yml` |
| Exclude files | `exclude: [...]` | `.github/heimdall.yml` |
| Min severity shown | `min_severity: important` | `.github/heimdall.yml` |
| Team custom instructions | `instructions: \| ...` | `.github/heimdall.yml` |
| Whitelist who can trigger | `manual_reviewers: [octocat]` | `.github/heimdall.yml` |
| **Block merge on critical** | `block_on_critical: true` (+ branch protection for `heimdall/critical`) | `.github/heimdall.yml` + GitHub |
| Off / pure on-demand | leave `auto_review` unset (default) | — |

## Config File `.github/heimdall.yml`

```yaml
version: 1
include: ["*.ts", "*.js", "*.py", "*.go"]
exclude: ["**/generated/**", "**/*.min.js", "**/package-lock.json"]
min_severity: normal
instructions: |
  This project uses TypeScript strict mode. No `any`.
manual_reviewers:
  - octocat
block_on_critical: true
auto_review: true   # default is on-demand only

# Per-repo observability override (defaults come from env, see §Observability)
observability:
  logs:
    enabled: true
    invocation_logs: true
```

---

## Observability

Heimdall emits **JSON-lines** structured logs to stdout/console — GitHub Actions workflow logs, Cloudflare Workers Logs, or self-hosted stdout — one line per event, tied together by a per-review `reviewId`.

**Toggles (operator default via env, per-repo override via `.github/heimdall.yml`):**

| Env | Default | Meaning |
| --- | --- | --- |
| `HEIMDALL_LOG_ENABLED` | `true` | Master switch for detailed stage logs (`review.*`, `llm.*`) |
| `HEIMDALL_INVOCATION_LOGS` | `true` | Always-on one-line summary per review (`review.invocation`) |
| `HEIMDALL_LOG_LEVEL` | `info` | Filter: `error \| warn \| info \| debug` (affects detailed logs only) |

**Per-repo override** (in the target repo's `.github/heimdall.yml`):

```yaml
observability:
  logs:
    enabled: false      # turn off detailed logs for this repo
    invocation_logs: true
```

`warn`/`error` are **always emitted** (a failure is never hidden); `enabled: false` silences only the info/debug detail.

**Key events** — diagnose "why was this PR skipped/failed":
- `review.skip` with `reason`: `draft_pr` · `bot_pr` · `not_auto_review` · `reviewer_not_whitelisted` · `dup_review` · `dup_cache` · `dup_status` · `missing_api_key` · `empty_diff` · `non_pr_event` · `no_trigger_comment`
- `review.error` with `reason`: `llm_error` · `parse_failed` · `post_inline_failed`
- Stage events: `review.start` → `review.config` → `review.diff` (debug) → `llm.start`/`llm.done` → `review.parse` → `review.post` → `review.complete`
- `review.invocation` — one summary line per review (outcome, `durationMs`, issue counts)

Example line:

```json
{"ts":"2026-08-16T02:40:00.000Z","level":"info","event":"review.skip","mode":"worker","repo":"octocat/hello-world","pr":12,"sha":"abc1234","reviewId":"h-x1y2z3","reason":"not_auto_review","msg":"默认仅按需审查，跳过自动审查"}
```

## Report Style

```markdown
## 🛡️ Heimdall · Code Review Report

**Change Summary**: 2 files, 🟢 +214 / 🔴 -58

| File | Change |
| src/auth.ts | 🟢 +120 / 🔴 -30 |

### 📖 Overview
...risk analysis + suggested verification...

<details><summary>🔍 Review Comments & Issues</summary>
| Severity | Location | Issue |
| 🔴 | `src/auth.ts:45` | Trust boundary: reload authoritative data server-side |
| 🟡 | `src/api.ts:88` | Use Promise.all — current N+1 |
</details>

<details><summary>ℹ️ Review Info</summary>
Files reviewed / change size
</details>
```

Inline comments (pinned to code lines) carry: actionable title + impact + `Fix Suggestion` + executable `diff`.

---

## Setup Pitfalls (from real battles)

### Config
1. **Repo secrets can't start with `GITHUB_`** — use `GH_` prefix; the workflow maps them to Worker secrets.
2. **App must subscribe `pull_request` + `issue_comment`** or it never receives events.
3. **App needs `Statuses` permission** — without it, dedup mark & `block_on_critical` silently fail (403 swallowed).
4. **Renaming the App resets the webhook** — re-verify URL, secret & events after rename.
5. **Webhook URL is known only after deploy** — deploy first, then register the App.
6. **Webhook secret must match both ends** — App settings == `GH_WEBHOOK_SECRET`, else 401.

### Worker / Cloudflare
7. **No global `Buffer` in Workers** — `import { Buffer } from "node:buffer"`, or every webhook 500s.
8. **GitHub API requires `User-Agent`** — else 403 `Request forbidden by administrative rules`.
9. **Free plan `waitUntil` is 30s** — large-diff reviews can time out. Mitigate: `thinking: { type: "disabled" }` + upgrade to Pro (90s).
10. **Private key must be full PEM** (BEGIN/END + newlines), or `createPrivateKey` fails.

### Behavior
11. **Concurrent triggers can double-review** — triple dedup (review query + status mark + module cache).
12. **LLM JSON with raw newlines in diff** breaks parsing — loose JSON tolerance handles it.
13. **Model ID mismatch** → `model_not_found`; set `AI_MODEL` to a supported ID.
14. **Default is on-demand** — PRs aren't auto-reviewed unless `auto_review: true`.

---

## Architecture

All three modes share one review core: `trigger → config → fetch diff → LLM → parse → post back`.

```
trigger (PR event / @CoderHeimdall)
  → read .github/heimdall.yml + PR diff (include/exclude)
  → call LLM (anthropic/openai/gemini/local, custom base_url)
  → parse structured JSON (severity/file/line, loose tolerance)
  → post Review (inline comments + overall report; fallback on line-mapping failure)
  → (optional) heimdall/critical status → block merge
```

## Directory

```
heimdall/
├── app.yml                     # GitHub App manifest (statuses perm, events)
├── .github/workflows/
│   ├── ci.yml                  # build + unit tests
│   └── deploy.yml              # auto-deploy Worker to Cloudflare
├── template/heimdall-review.yml # Mode A workflow (copy to target repo)
├── scripts/heimdall-review.js  # Mode A script (zero-dep, copy to target)
├── worker/                     # Mode B: Cloudflare Worker
├── src/                        # shared review core
│   └── review/
│       ├── prompt.ts           # Heimdall persona prompt (single source)
│       ├── parse.ts            # parse/render + loose JSON + labels
│       ├── providers.ts        # AI providers
│       └── repo-config.ts      # heimdall.yml parsing
├── test/                       # node:test
├── .claude/agents/critic.md    # review-quality critic agent
├── AGENTS.md                   # AI agent project guide (EN)
├── CONTRIBUTING.md / PRD.md    # EN; + *.zh-CN.md for Chinese
├── README.zh-CN.md             # Chinese README
└── README.md
```

## FAQ

**How do I trigger a review?** Default on-demand: comment `@CoderHeimdall` (or `@heimdall`). Set `auto_review: true` for auto.

**Does a commit get reviewed twice?** No — triple dedup ensures one review per commit; new commits re-review.

**Context limit?** `MAX_DIFF_LENGTH` (default 40000) truncates; split large PRs or raise it.

**Report language?** `REVIEW_LANGUAGE` = `en` (default) / `zh` / `bilingual`.

## Roadmap

Delivered (M1–M4):
- [x] Auto + on-demand review, persona prompt
- [x] Change summary, severity, inline comments + diff suggestions
- [x] `.github/heimdall.yml` config (filters / min_severity / instructions / whitelist / block / auto)
- [x] On-demand `@CoderHeimdall` (default)
- [x] Multiple providers + unified `AI_API_KEY`/`AI_BASE_URL`
- [x] Same-commit dedup (triple)
- [x] Quality iterations (prompt v1→v8, critic-scored ≥85)
- [x] Unit tests + CI + auto-deploy

Planned:
- [ ] Incremental review (only changed parts)
- [ ] Review tiering by change size

## License

MIT
