---
name: feature-notifications
description: "Change bycoda notification preferences, project mute or approval/request-center presentation. Preserve delivery/permission truth, privacy and exact approval intent across views."
---

# Notifications development

All code paths below are repository-relative; linked skill resources are relative to this directory.

## When to use

Use for notification settings, project exceptions/mute, pending request sheet/history/popups and daily-summary delivery. Session approval execution, task summary data and native/mobile permissions retain their owning services.

## Start here

- `src/features/settings/ui/NotificationsSettings.tsx`, `src/features/notifications/ui/ProjectNotificationSettings.tsx` and `src/features/sessions/ui/ApprovalToasts.tsx` own the main surfaces.
- `src/features/notifications/model/` and `hooks/` own preferences, delivery, history, permission and summary lifecycle.
- Read [surfaces](references/surfaces.md) for session routing, native commands and focused checks.
- Server-side notification feed, preferences and announcement notices belong to [Account](../feature-account/SKILL.md); the server drops push during quiet hours instead of deferring it.

- `src/features/notifications/model/ownerApprovals.ts` and `ui/OwnerApprovalRequests.tsx` route transient native-owned decisions into chat or the shared in-app confirmation; `src-tauri/src/control/owner_approval.rs` retains window, source and deadline authority.

## Preserve

- Sound, desktop alerts and request popups are independent preferences; master-off preserves dependent event/project/schedule choices. Saved intent is not permission or delivered notification.
- Keep unavailable native permission distinct from denied/granted; reject stale read/request results and request permission only through current user-intent gates.
- Project mute/category identity includes machine/provider/project; preserve expiry, custom-time drafts, all-known bulk scope and truthful visible/known counts.
- Application-owned approval requests use chat or the shared in-app confirmation, never native/browser fallback. Source retirement, timeout and relock dismiss the request; an automatic dismissal is not an owner choice. Full access only reuses existing execution authority, not publication or persistent access consent.
- Pending approvals/questions, transient popups and capped arrival history are different collections. Dismissal or timeout does not resolve a request; history is not an unread/resolved/all-delivery ledger.
- Pending Question and Approval badges use the shared warning tone for waiting owner input; preserve their distinct labels, response actions and permission gates.
- Preserve exact represented request/context and current session/provider/remote/worktree gates. Pending or uncertain decisions stay disabled across remounts; callback return or absence alone does not confirm provider acceptance.
- Keep locked/hidden content redacted before previews/options/counts and revalidate cached summaries on relock; never reconstruct private context from stale display data.
- Daily summary retains valid minute precision, local-day/lead/no-overlap/retry semantics and partial-machine truth. Cached/sent identity and durable outcome must agree.
- History merge/clear and popup focus/timeout/occurrence handling retain their shared lifecycle. Phone notification permission does not enable computer alerts.

## Workflow and checks

Background notification leadership follows native `is_workspace_window` eligibility.
Auxiliary composer, voice-overlay and desktop-control windows must never take leadership.

1. Trace the affected preference/event/request from model to delivery or session action; keep action feedback at its originating project/request/control.
2. For approval changes follow the current decision-control owner, not presentation metadata; for summary data follow [tasks/goals](../feature-tasks-goals/SKILL.md).
3. Choose focused suites from the map; exercise unavailable reads, sibling writes, pending/uncertain remount, relock/privacy, history clear and schedule retry. Actual platform delivery and phone permissions need isolated native/device checks.

## Read when needed

- [Approval presentation decisions](references/decisions.md) for the owner-approved in-app-only flow.

- Read [surfaces](references/surfaces.md) for ownership, RPC/native boundaries and verification.
- For shared row/focus/overlay changes consult [Settings](../feature-settings/SKILL.md) or [shared UI](../feature-shared-ui/SKILL.md) only as relevant.
