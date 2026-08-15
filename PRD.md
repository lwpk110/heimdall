# Heimdall (海姆达尔) — Product Requirements Document (PRD)

| Field | Value |
| --- | --- |
| Product | 海姆达尔 (Heimdall) |
| Version | v0.1 (draft) |
| Date | 2026-08 |
| Status | Delivered (M1–M4) |
| Positioning | An open-source, self-hostable alternative to GitHub Copilot Code Review |

---

## 1. Mission

**One-liner**: Heimdall is an AI code review bot with the persona of the Bifrost guardian — an open-source, self-hostable alternative to GitHub Copilot Code Review, with **free model choice, private deployment, and deep review customization**.

**Problems it solves**:
1. **Manual review is expensive**: high-quality review depends on senior engineers; small teams let PRs pile up.
2. **Copilot's limits**: Copilot Code Review uses only GitHub's models, per-seat billing, and sends code through Microsoft's cloud; teams can't pick a model (e.g. Claude) or keep code on their own servers.
3. **Inconsistent standards**: no shared, executable review rules across a team.

**Form**: a code review bot with dual deployment — **GitHub Actions** (per-repo, zero server) and **Cloudflare Workers** (GitHub App backend, serverless, distributable) — plus self-hosted Probot/Docker. All modes share one review core: read PR diff → call LLM → post as a GitHub Review.

**Target users**: individual devs & OSS maintainers; small-to-mid teams; privacy/compliance-sensitive teams.

**Non-goals (v1)**: no code generation/auto-fix; no IDE inline hints; no CI-external static analysis engine.

---

## 2. Concept

### 2.1 Persona
Heimdall — the Bifrost guardian from Norse myth/Marvel — "sees everything in the Nine Realms, including every problem in your code." Reports use a fixed three-part structure: 🔴 Critical / 🟡 Improvement / 🟢 Good practice, in a terse, direct tone.

### 2.2 Differentiation vs Copilot Code Review

| Dimension | Copilot Code Review | Heimdall |
| --- | --- | --- |
| Models | GitHub's only | Claude / GPT / Gemini / local (free choice) |
| Deployment | Microsoft cloud | Self-hosted / private, code stays on your infra |
| Billing | Per-seat subscription | Per-API-usage, no seats |
| Rules | Limited config | Programmable prompt + config file, versioned |
| Persona | Tool-like | Heimdall persona, consistent style |
| Open source | No | Yes |

### 2.3 Extensible pipeline
Abstract "fetch → model call → parse → post back"; any stage replaceable (local models, inline comments, merge blocking).

---

## 3. Feature Scope (Copilot parity)

| Capability | Priority |
| --- | --- |
| Auto review on PR open/new commit | P0 ✅ |
| Overall structured review report | P0 ✅ |
| On-demand `@CoderHeimdall` | P1 ✅ (default on-demand) |
| Inline comments (file + line) | P1 ✅ |
| Severity grading | P1 ✅ |
| Change summary | P1 ✅ |
| `.github/heimdall.yml` config (scope/exclude/custom rules) | P1 ✅ |
| Language/file filtering | P1 ✅ |
| Reviewer whitelist | P2 ✅ |
| Block merge on critical | P2 ✅ |
| Review dedup | P2 ✅ |
| Custom prompt | P2 ✅ |

---

## 4. User Stories

### 4.1 Developer
- **US-1 Auto review**: opening a PR auto-reviews the diff, updated per commit. (M1; now default on-demand)
- **US-2 Inline location**: findings point to the exact file+line. ✅
- **US-3 Severity sorting**: critical first. ✅
- **US-4 On-demand**: `@CoderHeimdall` triggers re-review; whitelist enforced. ✅

### 4.2 Team lead
- **US-5 Unified standards**: `.github/heimdall.yml` configures filters/instructions, versioned. ✅
- **US-6 Block risk**: `block_on_critical` sets `heimdall/critical` status to block merge. ✅

### 4.3 Privacy/compliance
- **US-7 Private deployment**: fully self-hosted; code never sent to third-party clouds. ✅

### 4.4 OSS maintainer
- **US-8 Low maintenance**: external PRs get an AI first pass; report doesn't block humans. ✅

### 4.5 Deployment
- **US-9 Dual mode**: same core in Actions & Workers, consistent output. ✅

---

## 5. Functional Requirements (key flows)

### 5.1 Auto-review main flow
```
trigger: pull_request.opened/reopened/synchronize (or @CoderHeimdall)
→ skip draft/bot PRs
→ read diff (GitHub API, include/exclude filtered)
→ assemble prompt (persona + team instructions + diff)
→ call LLM (anthropic/openai/gemini/local, custom base_url)
→ parse structured JSON (severity/file/line, loose tolerance)
→ post Review (inline comments + overall report; fallback on line failure)
```

### 5.2 Config `.github/heimdall.yml`

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
```

### 5.3 Report format

```markdown
## 🛡️ Heimdall · Code Review Report

Change Summary: 2 files, 🟢 +214 / 🔴 -58
| File | Change |
| src/auth.ts | 🟢 +120 / 🔴 -30 |

### 📖 Overview
...purpose, impact, risk, suggested verification...

<details><summary>🔍 Review Comments & Issues</summary>
| Severity | Location | Issue |
| 🔴 | `src/auth.ts:45` | Trust boundary: reload authoritative data |
| 🟡 | `src/api.ts:88` | Use Promise.all — N+1 |
</details>
```

---

## 6. Dual Deployment

| Dimension | Mode A: GitHub Actions | Mode B: Cloudflare Workers |
| --- | --- | --- |
| Positioning | Per-repo, zero config | Team-wide / productized |
| Trigger | CI workflow | GitHub webhook → Worker |
| Server | No | No (Cloudflare edge) |
| GitHub App | No | Yes |
| Install | Copy 2 files | Install GitHub App |
| Cost | Free | Free tier (Pro for large diffs) |
| Update | Per-repo copy | One deploy, all repos |

Both share one review core; only the runtime differs.

---

## 7. Non-functional Requirements

| Category | Requirement |
| --- | --- |
| Performance | Small PR (<500 lines) review < 60s end-to-end |
| Cost | Diff truncation + model tier + max_tokens cap |
| Security | Webhook signature verify; key only in env/secrets; no source logging |
| Reliability | LLM failure → failure report, not silent drop; idempotent (no duplicate per commit) |
| Maintainability | TS strict; modular pipeline; unit-tested core |

---

## 8. Success Metrics

- Coverage ≥80% of non-draft PRs
- Review latency P50 < 30s, P95 < 60s
- ≥40% of critical comments adopted (resolved threads)
- Critical false-positive rate < 20%
- Custom `heimdall.yml` adoption rate

---

## 9. Milestones

| M | Version | Scope | Status |
| --- | --- | --- | --- |
| M1 | v0.1 | Auto overall review + persona prompt | ✅ Delivered |
| M2 | v0.2 | Inline comments + severity + change summary | ✅ Delivered |
| M3 | v0.3 | `heimdall.yml` config + filters + on-demand | ✅ Delivered |
| M4 | v1.0 | Block merge + whitelist + dedup | ✅ Delivered |

**Current (2026-08)**: M1–M4 delivered; quality critic-scored ≥85. Report: bilingual (`REVIEW_LANGUAGE`), tables/folds/diff; default on-demand review; multi-provider + unified `AI_API_KEY`/`AI_BASE_URL`; triple dedup; Worker auto-deploy.

---

## 10. Risks & Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Line mapping 422 | Inline unusable | Overall report v1; line-validation module |
| Noise / bot fatigue | Product failure | Severity + whitelist + thresholds |
| Uncontrolled API cost | Team abandons | Diff truncation, model tiers, on-demand |
| Sensitive data to LLM | Compliance | Private deploy + local model endpoints |
| Per-commit review noise | Bad UX | Triple dedup |
| Mode inconsistency | Split UX | Shared core; documented differences |

---

## 11. Appendix: Copilot parity notes

Copilot Code Review capabilities (as of writing): auto review on open, `@copilot review` trigger, inline comments by severity, change summary, repo config file, AI reviewer as a required review gate.

Heimdall matches each capability, differentiated by free models, private deployment, and open-source extensibility. Deep GitHub-native integrations (e.g. the AI reviewer appearing in the reviewer dropdown) are out of scope; equivalent via `block_on_critical` status + branch protection.
