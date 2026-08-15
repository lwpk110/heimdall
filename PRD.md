# Heimdall (海姆达尔) — Product Requirements Document (PRD)

| Item | Value |
| --- | --- |
| Product | Heimdall (海姆达尔) |
| Version | v1.0 (draft) |
| Date | 2026-08 |
| Status | Released (M1–M4 delivered) |
| Positioning | Open, self-hostable alternative to GitHub Copilot Code Review |

---

## 1. Mission

**One-liner:** Heimdall is an AI code review bot with the persona of the guardian of Asgard's Bifrost bridge — model-agnostic, privately deployable, and deeply customizable.

**Problems solved:**
1. **High cost of human review** — small teams have no dedicated reviewer; PRs pile up.
2. **Copilot's limitations** — Copilot Code Review locks you into GitHub's model, per-seat pricing, and Microsoft cloud; teams can't pick Claude or keep code on their own infra.
3. **Inconsistent review standards** — no executable, shared review rules per team.

**Form:** A review bot with three deployment modes — **GitHub Actions** (per-repo, zero server), **Cloudflare Workers** (serverless, installable as a GitHub App), and **Probot/Docker self-hosting** (code never leaves the intranet). All three share one review core: read PR diff → call LLM → post a GitHub Review.

**Target users:** individual devs / OSS maintainers, small/medium teams, privacy-sensitive teams.

**Non-goals (v1):** no code generation or auto-fixing; no IDE inline hints; no static-analysis engine beyond review.

## 2. Concept

### 2.1 Persona
Named after **Heimdall**, the guardian of the Bifrost bridge — sees everything, guards the gate. Every PR must pass his bridge before merge. Reports use a fixed three-section tone (Critical / Improvements / Good practices), direct and no fluff.

### 2.2 Differentiation from Copilot Code Review

| Dimension | Copilot Code Review | Heimdall |
| --- | --- | --- |
| Model | GitHub's only | Free choice: Claude / GPT / Gemini / local |
| Deployment | Microsoft cloud | Self-host / private; code stays on your infra |
| Pricing | Per-seat subscription | Pay for what you use (your API key) |
| Rules | Limited config | Programmable prompt + `.github/heimdall.yml` |
| Persona | Tool-like | Heimdall persona, consistent style |
| Open source | No | Yes (MIT) |

### 2.3 Extensible pipeline
Abstracted as `fetch diff → call model → parse result → post back`; any stage is swappable (providers, parsing, post modes).

## 3. Feature Scope (aligned with Copilot)

| Capability | Priority | Status |
| --- | --- | --- |
| Auto review on PR open/update | P0 | ✅ |
| Overall review report (structured) | P0 | ✅ |
| On-demand `@CoderHeimdall` review | P1 | ✅ |
| Inline comments (file + line) | P1 | ✅ |
| Severity grading (critical/important/normal) | P1 | ✅ |
| Change summary / overview | P1 | ✅ |
| `.github/heimdall.yml` config (include/exclude/rules) | P1 | ✅ |
| Language / file filtering | P1 | ✅ |
| Reviewer whitelist | P2 | ✅ |
| Block merge on unresolved critical | P2 | ✅ |
| Review cache / dedup | P2 | ✅ |
| Custom prompt (team instructions) | P2 | ✅ |
| Bilingual reports (`REVIEW_LANGUAGE`) | — | ✅ |
| Incremental review (changed parts only) | — | planned |

## 4. User Stories

- **US-1 Auto review**: PRs get reviewed within 60s; each new commit re-reviews (dedup by commit).
- **US-2 Inline location**: ≥80% of critical issues map to correct file + line.
- **US-3 Severity sort**: critical listed first.
- **US-4 On-demand**: `@CoderHeimdall` triggers a re-review; non-whitelist ignored.
- **US-5 Configurable rules**: `.github/heimdall.yml` versioned per repo.
- **US-6 Block risk**: unresolved critical blocks merge via `heimdall/critical` status check.
- **US-7 Private deploy**: fully on-prem; pluggable local model endpoint.
- **US-8 Lower maintainer burden**: external PRs get an AI first-pass.
- **US-9 Dual modes**: same core across Actions / Worker / self-host.

## 5. Key Flows

### 5.1 Auto review
```
trigger: pull_request opened/reopened/synchronize (or @CoderHeimdall)
  → skip draft / bot PRs
  → read diff (pulls.listFiles, include/exclude filter)
  → build prompt (persona + team instructions + diff)
  → call LLM (anthropic/openai/gemini/local)
  → parse structured JSON (severity/file/line, loose tolerance)
  → post Review (inline comments + overall report; fallback on line-mapping failure)
  → (optional) heimdall/critical status → block merge
```

### 5.2 Config (`.github/heimdall.yml`)
```yaml
version: 1
trigger: [on_open, on_update, manual]   # on-demand is default (auto_review)
include: ["*.ts", "*.js"]
exclude: ["**/generated/**"]
min_severity: normal
instructions: |-
  No `any`. Handle errors.
block_on_critical: true
manual_reviewers: [octocat]
auto_review: true   # unset = on-demand only
```

### 5.3 Report format
```markdown
## Heimdall · Code Review Report
Change Summary (+N / -M, file table)
Overview (purpose, impact, risk, verification suggestions)
🔍 N issues (critical X / important Y / normal Z)
🤖 Review Comments (table) / ℹ️ Review Info (folded)
```
Inline comments: actionable title + impact + `Fix Suggestion` + `diff` (+ 1-Click Suggestion).

## 6. Dual Deployment Modes

| Dimension | Mode A: GitHub Actions | Mode B: Cloudflare Workers |
| --- | --- | --- |
| Positioning | Per-repo, zero config | Team-wide / productized GitHub App |
| Trigger | CI workflow | webhook → Worker |
| GitHub App | No | Yes |
| Install | Copy 2 files | Install App |
| Cost | Free | Free tier (Pro for large diffs) |
| Code location | GitHub runners | Cloudflare edge |
| Updates | Per-repo | One deploy, all repos |

Both share the same core (prompt / model / report format) — only the runtime differs.

## 7. Non-functional Requirements

| Category | Requirement |
| --- | --- |
| Performance | Small PR (<500 lines) reviewed <60s end-to-end |
| Cost | Diff truncation + model tier + `MAX_DIFF_LENGTH`; thinking disabled for speed |
| Security | Webhook signature verify; keys in env; no source-code logging |
| Reliability | LLM failure degrades to a failure report (never silent); commit dedup; loose JSON tolerance |
| Maintainability | TypeScript strict; modular pipeline; node:test coverage |

## 8. Success Metrics

- Review coverage ≥80% of non-draft PRs
- P50 latency <30s, P95 <60s (small PRs)
- ≥40% of critical comments adopted
- Critical false-positive <20%
- Config adoption rate

## 9. Milestones (all delivered)

| Milestone | Version | Scope | Status |
| --- | --- | --- | --- |
| M1 | v0.1 | Auto overall review + persona prompt | ✅ |
| M2 | v0.2 | Inline comments + severity + change summary | ✅ |
| M3 | v0.3 | heimdall.yml config + filters + on-demand | ✅ |
| M4 | v1.0 | Block / whitelist / dedup / quality ≥85 | ✅ |

> Current status (2026-08): M1–M4 delivered. Review quality iterated prompt v1→v8 and critic-scored ≥85. Bilingual reports (`REVIEW_LANGUAGE`), unified `AI_API_KEY`/`AI_BASE_URL`, on-demand default, triple dedup, professional template (table/folds/inline diff), Worker auto-deploy.

## 10. Risks & Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| LLM line-number mismatch (422) | Inline comments fail | Fallback to overall report; line validation |
| False-positive noise | Devs ignore bot | Severity grading + min_severity + whitelist |
| Uncontrollable API cost | Teams abandon | Diff truncation, on-demand default, model tiers |
| Sensitive info to LLM | Compliance | Self-host + local model endpoint |
| Per-commit re-review noise | UX | Commit dedup (triple) |
| Mode inconsistency | Fragmented UX | Shared core + bilingual labels + docs |

## 11. Appendix: Copilot Code Review parity

Copilot's public capabilities (auto review, `@copilot review`, inline comments by severity, change summary, repo-level config, blocking reviewer) are each matched by Heimdall, with model freedom and self-hosting as the differentiation. Tightly GitHub-bound details (e.g., AI reviewer in the reviewer dropdown) are not cloned; the equivalent "config block + status check" is used instead.
