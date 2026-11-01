# Usage surfaces

Paths are repository-relative. Read the affected subsection only; reports and rule gates are not interchangeable.

## Analytics and visualization

- UI: `src/features/usage/ui/UsageOverview.tsx`, `UsageCharts.tsx`, `UsageVisualizations.tsx`, `UsageAnalytics.css`, `UsagePage.tsx`; preserve Overview/Projects/Time analysis grouping and drilldown identity.
- Models: `src/features/usage/model/usageAnalytics.ts`, `usageColors.ts`, `railGroups.ts`; `src/features/providers/model/providerUsage.ts`.
- Native report owners: `src-tauri/src/provider_usage.rs`, `src-tauri/src/session_store/usage.rs`, registration in `src-tauri/src/lib.rs`; commands `provider_usage_report`, `session_usage_report`, relevant `session_get` reads.
- Reports retain source/truncation/estimate provenance. Keep exact intervals, zero-hour rows, local sort/search/page semantics, dynamic chart accessible names and session coverage.
- CSV exports the actual selected export scope, not every displayed drilldown by implication; preserve formula-safe cells and privacy before options/aggregation/export.

## Quotas and local rules

- Account source/cache/history: `src/features/providers/model/rateLimits.ts`, `rateLimitsFetch.ts`, `rateLimitsCache.ts`, `rateLimitHistory.ts`, `providerAccounts.ts`.
- UI: `src/features/usage/ui/UsageDisplaySettings.tsx`, `UsageQuotaHistory.tsx`, `UsageBudgets.tsx`; direct section/reveal in `src/features/settings/model/settings.ts` and `src/features/settings/ui/SettingsView.tsx`.
- Rules/readings/store: `src/features/usage/model/usageBudgets.ts`, `usageBudgetReadings.ts`, `usageBudgetStore.ts`; pre-dispatch owner `src/app/workspace/sessions/submit/submitUsageBudget.ts` and its submit caller.
- For matching desktop blocking rules, the current submit gate blocks a known
  exceeded reading. Unverified/failed measurements or a scan exceeding
  `USAGE_CHECK_WAIT_MS` (currently 3,000 ms) warn and allow the send; do not restore
  the old audit's fail-closed description. Preserve configuration/validation error
  handling separately and do not infer Host task-budget policy from this gate.
- Quota observations use `bycoda.quotaHistory.v1`; preserve retention/dedup/reset/current timestamp semantics from the model. Observed history is not provider historical truth; no gap interpolation or invented points.
- Keep v1 rule compatibility and token-threshold versus account-percent semantics. Common machine scope excludes remote cwd and cannot silently extend to other machines/Host tasks.
- Native quota reads include `fetch_claude_usage`, `fetch_claude_usage_once`, `fetch_opencode_go_usage`; Codex quota uses provider account rate-limit reads. Confirm actual current transport before adding refresh behavior.

## Host/mobile boundaries

- Host task budget/limit/report owners: `host/task-budgets.ts`, `tasks.ts`, `limits.ts`, `usage-report.ts`; local desktop rule gates do not enforce all of these.
- `usage.sessions.read` is a bounded Host reader in `host/conversation-project-tools.ts`; mobile `mobile/src/features/tools/usage-screen.tsx` uses its own report/paging contract.
- Mobile provider views include `mobile/src/features/tools/provider-desktop.tsx`, `provider-desktop-model.ts`, `provider-account-editor.tsx`; capability families `providers.desktop.v1` and `providers.desktop.quotaRefresh.v1` retain explicit refresh/cooldown/consent.
- Verify current route and capability support before claiming local-budget management parity.

## Focused checks

Analytics: colocated usageAnalytics/usageOverview/usageColors and UsageOverview.refresh tests. Rules/gating: UsageQuotaHistory/UsageBudgets, usageBudgets/usageBudgetReadings/usageBudgetStore and submitUsageBudget tests; provider cache/history tests when affected.

Browser: `tests/browser/usage-analytics.spec.ts`, `usage-budgets.spec.ts` and current usage-budgets fixture/config. Include one bucket/day, multi-period series distinction, DST/half-hour windows, missing cost, unknown shares, truncated turns, All time quota extent, retained last-good meters, rule draft lifetime, scope identity, overlap, privacy and block/monitor/unknown dispatch. Native/installed/Host/mobile evidence remains boundary-specific.
