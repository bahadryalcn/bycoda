---
name: feature-activity
description: Develop the local active-time measure (foreground plus recent input), its Host store, the seven-day bars and the daily-summary line; central upload and account screens belong to the account feature.
---

# Activity

Owns the "active minute" metric. UI (`src/features/activity/`) tracks input and focus in each window and provides the totals and seven-day bars that the Today view on the Account screen shows; the Host (`host/activity/`) stores one 1440-bit map per local day and device and answers summaries. Uploading maps to the account service, the account screen and the portal belong to the account feature and the cloud API. The daily-summary notification only receives a value (`src/features/notifications/model/`).

## Source starts

- `src/features/activity/index.ts`: public entry (`activityBars`, `useActivitySummary`, `useActivityTracker`, `getActivityTotals`).
- `src/features/activity/model/`: pure tracker, RPC client, totals and formatting.
- `host/activity/`: store service and the RPC schemas and handler.
- `packages/account-contracts/src/activity.ts`: bitmap helpers and wire format; do not reimplement.

## Workflow

1. Change tracking rules in `model/activityTracker.ts` and keep it clock-injected and pure.
2. Change persistence or merging in `host/activity/activity-store.ts`; schemas live in `activity-rpc.ts`.
3. Keep the wire format identical to `ActivityDay`; a format change is a contract change.
4. Run the focused checks below.

## Preserve

- A minute is active only with the window in the foreground and input in the last five minutes.
- Lock, sleep and clock jumps never backfill: after a late tick the tracker waits for new input.
- Everything merges by bitwise OR, so windows, devices and retries count a minute once.
- Only dates, time zones and minute maps are stored or sent: no project, session or content.
- The Host file is written atomically; a corrupt file is kept as evidence and counting restarts.
- History is bounded; weeks start on Monday as in the contract helpers.
- Guest figures cover this machine plus every connected Host (`model/machineActivity.ts`): per-day union (OR) across machines, the account service's rule, so a minute active on two machines counts once. An unreachable Host is listed as unavailable and never blocks the rest. Signed in, the cloud summary is the default and the machine view stays selectable (`hooks/useActivityOverview.ts`).
- Sync uploads the whole local store of this machine only (up to 400 days, 62 per request, oldest first, watermark per batch). Connected Hosts are never uploaded: ownership of a remote Host cannot be proven. `device_revoked`, `account_deactivated` and an unknown device stop sync.

## Focused checks

- `pnpm exec vitest run src/features/activity src/features/notifications/model`
- `BYCODA_HOST_TEST_SCOPE=all pnpm exec vitest run --config host/vitest.config.ts host/activity`

## References

- `docs/reference/code-invariants.md`: atomic state files and time helpers.
- `docs/reference/ui-components.md`: shared chart and list components.
