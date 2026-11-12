---
name: feature-usage
description: "Use when changing Usage charts, provider quotas and local budgets. Not for task budgets; see feature-tasks-goals."
---

# Usage and budgets development

Use for Usage Overview/Projects/Time analysis, charts/tables/CSV, Limits/account quota/history and local budget management/gating. Host task/goal budgets, remote work and mobile reports have separate authority.

## Source starts

- `src/features/usage/ui/UsageOverview.tsx`, `UsagePage.tsx`, `UsageQuotaHistory.tsx` and `UsageBudgets.tsx` own the main surfaces.
- `src/features/usage/model/usageAnalytics.ts`, `usageBudgets.ts`, `usageBudgetReadings.ts`, `usageBudgetStore.ts` own measurements/rules.
- Read [surfaces](references/surfaces.md) for native/provider/report routing and pre-dispatch checks.

## Preserve

- Provider quota percentages have different accounts/windows and no common capacity denominator; never sum/average them into pooled quota.
- Keep local provider-log measurements, recorded turn metrics, quota observations and Host task budgets distinct. Missing/unsupported/partial/stale is not zero or a verified fresh reading.
- Preserve exact date/window/timezone, token/cache normalization, conservative boundary precision, elapsed-time clipping and estimate meaning. API-equivalent cost is not subscription billing.
- Budget project/session/workspace/machine scope must keep its actual identity; workspace means project group, while machine is a distinct local token scope. Overlapping rule rows are not unique consumption to sum.
- Common-local measurement requires canonical source identity and private-safe completeness; multiple profiles, unsupported sessions, failed reads or hidden contributors must remain unknown where required.
- Keep fresh pre-dispatch checks before transcript/workspace/provider effects, block-versus-monitor semantics and rejected input/attachment recovery. No reservation or strict in-flight ceiling follows from a threshold.
- Preserve rule/storage normalization, custom values, unavailable-data protection, retained per-rule drafts, local retry, current-lock filtering and confirmed removal.
- Charts/tables retain exact values, accessible non-color alternatives, grouping/selection/drilldown, bounded detail and formula-safe CSV; compactness must not drop fields or hide truncation.

## Workflow

1. Identify the actual data source and scope first; trace filter/measurement/cache and rule matching separately before altering presentation or a gate.
2. Read [budget user guide](../../../docs/guides/usage-budgets.md) for user concepts and update it only when changed behavior is implemented; verify navigation/current scopes from code.
3. Choose focused analytics/quota/budget/submit suites from the map. Exercise unknown/stale/partial/private, overlap, failed storage, single/multi-period charts, timezone boundaries and rejected-turn recovery with fake reports.

## References

- Read [surfaces](references/surfaces.md) for source and test maps.
- Read [decision provenance](references/decisions.md) only when changing common summary/local-budget scope; it specifies intent, not a real rule or new remote authority.

## Focused checks

Use the focused test owners in [the surface map](references/surfaces.md).
