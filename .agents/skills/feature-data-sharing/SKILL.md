---
name: feature-data-sharing
description: Use when changing data sharing permissions, outbound previews or receipts. Not for collecting diagnostic logs; see feature-diagnostics.
---

# Data sharing

Desktop owns outbound sharing review for diagnostic reports, active time, anonymous installation statistics and anonymous token totals. Mobile applies its equivalent review to diagnostic reports. The sending features own payload construction and the account client owns transport.

## Source starts

- Desktop queue, settings and notices: `src/features/data-sharing/`, public entry `index.ts`.
- Desktop senders: `src/features/account/model/`, `src/features/activity/sync/` and `src/features/diagnostics/model/`.
- Mobile diagnostic sharing: `mobile/src/features/diagnostics/`.

## Workflow

1. Identify the exact destination and validated body at the last call before transport.
2. Prepare the file contents that represent that body. Redact diagnostics before opening the preview.
3. Put the body behind its category permission and produce the receipt only after transport succeeds.
4. Verify rejection, consent changes, receipt visibility and identity changes with a fake transport.

## Preserve

- Permission is specific to the data category. Receipt visibility is a separate preference.
- Never expose authentication headers or store payloads in notification history. Linked details are cleared when the account changes.
- Closing an automatic preview resumes its review window. Dismissing a pending notice cancels that transfer.
- Cancellation leaves active-time synchronization watermarks and anonymous delivery records unchanged.
- Pending content and receipts are in-memory only.

## Focused checks

- `pnpm exec vp test run src/features/data-sharing src/features/diagnostics/model`
- In `mobile/`, `pnpm test src/features/diagnostics`.

## References

- [Account guide](../../../docs/guides/account.md) for settings and data categories.
- [Product decisions](references/decisions.md) for permission and preview behavior.
