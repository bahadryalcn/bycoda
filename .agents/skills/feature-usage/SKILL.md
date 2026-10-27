---
name: feature-usage
description: "Usage analytics, Overview, Projects, Time analysis, charts/tables/CSV, estimates/coverage, provider quotas and Limits & Budgets inventory. Includes filters, local scope/overlap/privacy/storage/pre-dispatch gates, common summary/local-budget design and native/mobile read boundaries. Read before Usage UI or workflow changes."
---

# Usage, limits and local budgets

Explain provider quota, locally measured consumption and local dispatch policy
with precise account/window/scope identity. Keywords: Usage, Limits & budgets,
Provider account limit, remaining/used, reset, Limit history, All time, token
capacity, allocation, monitor/block, project/session/workspace, common budget.

## Scope and identity

2026-10-27 T2 Limits & Budgets audit, dirty shared
`main @ 0a42b1ab4fd891ccec5ca0fa238d7356b396b13c`. History inspected: `9f9271f5a`,
`29d534f9f`, `cf3944cfb`, `3419af022`. Six light owner captures, source inclusion
UNKNOWN; two native read-only reviewers plus parent checks. Ten records (four V+S,
six S),18 families. This inventories shared Usage dependencies; it does not claim
the whole analytics product redesigned or installed/native acceptance.

Register/brief: `temp/local/2026-10-27-settings-limits-budgets-audit/AUDIT.md` and
REDESIGN.md; evidence: `temp/verification/2026-10-27-settings-limits-budgets-audit/EVIDENCE.md`.
Live feature-claim API unavailable; available Git/worktree/native session state
inspected. Card is not a lock. Preserve concurrent Settings/shared UI, native,
Voice, release/local-update/CI and other work; one writer per file.

## Owner decisions

2026-10-27, conversation `0567326f-aade-4baa-89f3-b44c6256ae9e`, exact quote:

> Limits & Budgets da daha iyi olabilirdi çok gereksiz kısımlar var tablo uzayıp gidiyor ne olduğunuda anlamaıyoruz ortak bir limit filanda gösterilebilirdi daha geilişmiş güzel bir ui olabilir yani burası.

Selected clarification:

> Ortak özet ve ortak yerel bütçe (önerim)

Both summary and a true common local budget are targets. No amount/period/action,
automatic rule/default, provider quota pool or remote/Host enforcement selected.
Current workspace scope means project group; a whole-local-machine scope is new
capability requiring implementation, not a visual rename.

## Surface inventory

Search roots: src/features/usage, src/features/providers/model, submit controllers,
native usage/rate limits, host budget/usage, mobile tools, Settings and browser tests.
Keep account quota, local measurements and Host task budgets distinct.

| Surface                                          | Source                                                                                                                                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Direct Settings and Usage Limits entry           | `src/features/settings/ui/SettingsView.tsx`; `src/features/settings/model/settings.ts`; `src/features/usage/ui/UsagePage.tsx`                                                         |
| Shared overview/date/filter/analytics boundaries | `src/features/usage/ui/UsageOverview.tsx`; `UsageAnalytics.css`; `UsagePage.css`; `model/usageAnalytics.ts`                                                                           |
| Account windows/remaining/colors/preferences     | UsagePage; `UsageDisplaySettings.tsx`; `src/features/providers/model/rateLimits.ts`; `providerAccounts.ts`                                                                            |
| Provider fetch/cache/history                     | `src/features/providers/model/rateLimitsFetch.ts`; `rateLimitsCache.ts`; `rateLimitHistory.ts`; `providerManagementControl.ts`                                                        |
| Observed quota chart/table                       | `src/features/usage/ui/UsageQuotaHistory.tsx`; shared Arc SortableDataTable                                                                                                           |
| Local budget editor/status                       | `src/features/usage/ui/UsageBudgets.tsx`; shared fields/meter/ConfirmMorph                                                                                                            |
| Budget schema/measurement/persistence            | `src/features/usage/model/usageBudgets.ts`; `usageBudgetReadings.ts`; `usageBudgetStore.ts`                                                                                           |
| Pre-dispatch guard/recovery                      | `src/app/workspace/sessions/submit/submitUsageBudget.ts`; `useSubmitSession.ts`                                                                                                       |
| Native account/local usage reads                 | `src-tauri/src/rate_limits.rs`; `provider_usage.rs`; `session_store/usage.rs`; registration in lib.rs                                                                                 |
| Separate Host work budgets/limits/reports        | `host/task-budgets.ts`; `host/tasks.ts`; `host/limits.ts`; `host/usage-report.ts`                                                                                                     |
| Mobile provider and usage readers                | `mobile/src/features/tools/provider-desktop.tsx`; `provider-desktop-model.ts`; `provider-account-editor.tsx`; `usage-screen.tsx`; `mobile/src/features/workspace/session-toolbar.tsx` |

Native calls: fetch_claude_usage, fetch_claude_usage_once, fetch_opencode_go_usage,
provider_usage_report, session_usage_report, session_get; Codex account rate limit
read uses app-server account/rateLimits/read. Mobile RPCs/capabilities:
providers.desktop.read / providers.desktop.v1; providers.desktop.quota.refresh /
providers.desktop.quotaRefresh.v1 (explicit consent/cooldown); usage.sessions.read
(bounded Host report). No local-budget management/gate parity on mobile found.

Translation families include Limits & budgets, Provider account limit, Usage budgets,
Limit history, Account, Limit window, Session/Weekly/Monthly, Token capacity,
Allocation (%), Account usage threshold (%), Monitor only, Block new turns, unknown/
stale/error/reset and measurement help. Search actual t(...) keys in locale and
override catalogs; no assumed usage.* namespace.

## Behavior to preserve

- RateLimitWindow supplies usedPercent/windowMinutes/reset, not absolute capacity.
  Never sum/average account or period percentages into a pooled quota. Keep account
  freshness/error/unknown; cache error retains old windows and old updatedAt.
- Local quota history is successful observations since collection, not provider
  historical truth: bycoda.quotaHistory.v1,90days/16000 samples,5-minute unchanged
  dedup and reset preservation. No zero-filling/interpolation. Table shows latest100.
- Current BudgetScope project/session/workspace; workspace targets a project group.
  New common local rule needs a real scope/read/gate/storage path. Rule usage
  overlaps, so do not add budget rows to obtain unique consumption.
- Capacity*percent/100 is token threshold; account% is one account's window
  threshold, not allocated/reserved provider capacity. Keep existing custom values.
- Matching blocking rules are evaluated before transcript/worktree/provider calls;
  unknown/stale blocking fails closed, monitor stays informational. Same-session
  duplicate checks and paused/undelivered content/attachment recovery retained.
  Running/concurrent turns can exceed threshold; no reservation guarantee exists.
- Reports use conservative15-minute boundary buckets, exact scope, complete
  session metrics and correct provider cache-token normalization. Missing is unknown.
- v1 budget storage re-reads before mutation and preserves inaccessible/malformed
  data. Locked target identity/readings/options remain private. Remove uses inline
  ConfirmMorph; save failure retains form. No live mutation needed for audit tests.
- Host task/goal budgets, remote work and mobile reports are separate. Common
  local scope does not silently extend enforcement to them or bypass unknown data.

## Audit proposals and gaps

Summary-first Overview/Budgets/History composition, compact account/window rows,
secondary appearance preferences, effective-threshold form preview and bounded
raw history details are proposals. Owner selected common summary plus common local
budget, but no amount/action/default. Keep all existing rules and overlap semantics.

Source repairs: fresh Limits-only filter inventory, quota-based All time extent,
real target identity, stale/fresh read context, last-known meter during revalidation
and unfinished editor lifetime. History needs time/window/used-remaining clarity;
cap100 never enters shared table's >200 virtual bound. Avoid global table changes.

## Checks and acceptance

Fresh baseline: six files /24 tests pass (UsageQuotaHistory, UsageBudgets,
usageBudgets/readings/store and submitUsageBudget). Static Impeccable UI/CSS scan [].
Mock/source tests do not prove new common scope, real quota/provider/native dispatch,
installed/UI/device behavior or complete UsageOverview integration.
Related tests: adjacent usage/provider rate-limit/cache/history tests;
`tests/browser/usage-analytics.spec.ts`, `usage-budgets.spec.ts`; Host/native usage
and task-budget suites. Nonselected suites read, not run this audit.

Actual implementation: light/dark1280/800/narrow390, long names/paths, scale/zoom,
keyboard/screen reader/reduced motion, fresh Limits-only options/All time, gaps/
reset/freshness, max100 detail/sort, draft navigation/known-refresh, effective value,
locks/storage recovery, new common scope+migration+deduplicated overlap, unknown/
stale/monitor/block/concurrent dispatch and preserved rejected-input recovery.
Use isolated fake reports/sessions; native/Host/installed/physical device proof
separate. Update `docs/guides/usage-budgets.md` after implemented entry/behavior;
retain still-valid Usage entry when adding direct Limits & Budgets instructions.

## Analytics refinement audit extension, 2026-10-27

Owner quote, conversation `0567326f-aade-4baa-89f3-b44c6256ae9e`, exact:

> Usage kısmı özellik olarak gsöterim olarak fena değil ama daha iyi olabilir sen üzerinde çalışırsın.

T2 audit/design, same dirty main baseline above; eight light owner captures
opened, installed source inclusion UNKNOWN. Two native read-only reviewers plus
parent review/checks. Ten records (five V+S, five S),18 audited families; no
product implementation. U07/U08 reuse Limits/budget/history surfaces and earlier
common-summary/common-local-budget decision without duplicating finding totals
or creating/configuring an actual budget.

Register and repair brief:
`temp/local/2026-10-27-settings-usage-analytics-audit/AUDIT.md` and REDESIGN.md.
Evidence:
`temp/verification/2026-10-27-settings-usage-analytics-audit/EVIDENCE.md`.
The main workbench plan and Settings card reference this extension. Claim API
remains unavailable; this inventory is not a concurrency lock.

### Analytics inventory

- Desktop: `src/features/usage/ui/UsageOverview.tsx`, `UsageCharts.tsx`,
  `UsageVisualizations.tsx`, `UsageAnalytics.css`, `UsagePage.tsx`; entry in
  `src/features/settings/ui/SettingsView.tsx` and settings model. Overview,
  Projects, Time analysis, Limits and direct Limits entry are valid surfaces.
- Models/state: `src/features/usage/model/usageAnalytics.ts`, `usageColors.ts`,
  `railGroups.ts`, `src/features/providers/model/providerUsage.ts`; date presets,
  custom start/end, timezone, metric/group/resolution, active filters/reset,
  selection, sorting/search/local pages, optional facts and reveal/lock state.
- Charts: trend/resolution/Other/toggles/exact table, provider share, project and
  model contributions, day/hour matrix, hour-of-day and chronological distribution.
  Existing shared Arc chart/table adapters provide keyboard and table alternatives.
- Detail/export: filtered breakdown → session → turn; selected session coverage;
  CSV currently exports filtered/searched breakdown, not session/turn tables.
- Native: provider_usage_report and session_usage_report registered in
  `src-tauri/src/lib.rs`, implemented in `src-tauri/src/provider_usage.rs` and
  `src-tauri/src/session_store/usage.rs`; report schema includes truncated turns.
- Host/mobile: `usage.sessions.read` project reader in
  `host/conversation-project-tools.ts`; `mobile/src/features/tools/usage-screen.tsx`
  uses capability-gated cursor50 reads. This is separate from desktop local logs.
- Localization families: Usage, Overview, Projects, Time analysis, Estimated cost,
  Agent time, Usage details/breakdown, Recorded sessions/turns, Data sources and
  coverage, Hour of day, filter/refresh/partial/empty/CSV messages; preserve t()
  and locale-aware number/currency/date handling.
- Checks: `src/features/usage/model/usageAnalytics.test.ts`,
  `usageOverview.test.ts`, `usageColors.test.ts`,
  `src/features/usage/ui/UsageOverview.refresh.test.ts`;
  `tests/browser/usage-analytics.spec.ts`, `usage-budgets.html`,
  `usage-budgets.tsx`, `playwright.usage-budgets.config.ts` and
  `vite.usage-budgets.config.ts`. Browser fixtures are not installed acceptance.

### Analytics findings and preservation

Repair single-bucket line stretching and full-width single-day 24-row density;
keep every exact interval, zero hour and keyboard/table path. Compact tables
without losing token fields, local20-row paging, sort/search/selection or CSV.
Hide redundant single-page controls. Keep cost meaning visible during comparison,
derive unknown shares from metric provenance, resolve account label precedence,
show truncated session coverage and match dynamic chart names to their grouping.
Make current metric/group/window readable; Projects currently overwrites grouping
and returning Overview retains it. Repeated series colors intentionally follow
the leading account; preserve configured colors and add non-color distinction.
Do not merge raw model IDs without a validated mapping.

Preserve separate provider-log and recorded-turn token sources, duration-only
runtime contribution, whole-turn token inclusion, clipped elapsed time, Codex
cache normalization, missing prices and lower bounds. API-equivalent cost is not
subscription billing. Agent time may include waiting and exceed wall-clock time.
Keep loading/zero/filter-empty/unavailable/partial/stale and last-good refresh,
generation cancellation, exact end-exclusive intervals,15-minute token precision,
formula-safe CSV and locks before options/aggregation/export. Chart density is
bounded without dropping the chosen window or totals. No new network pagination
or global provider/Host data pooling is implied by UI refinement.

### Analytics acceptance and handoff

32 tests/four files pass once (analytics, overview, colors, refresh); static
file detector []. No product source changes or actual app capture were made.
Direction HTML was visually reviewed in light728/dark390 as a proposal only.
Product light/dark1280/800 plus narrow, zoom/long labels, keyboard/screen reader,
reduced motion, unknown/partial/truncated data, grouping/back state, CSV/locks,
single/multi bucket and DST/half-hour matrix checks remain repair acceptance.
Model DST tests do not prove24-wall-hour heatmap correctness. Isolated native,
installed WebView, Host/mobile/device and release acceptance remain separate.
No live provider read, budget/send operation, build/install/release or commit.
Update affected guides when implemented behavior changes, not before.

## Handoff

Audit/card ready for review, product implementation not started. No live quota/
budget/provider/Host/send operation, build/install/release or source commit. New
common scope and actual renderer/native/device acceptance remain pending. Baseline
above is inventory provenance, not delivery/install inclusion. Preserve shared work.
