---
name: feature-notifications
description: Notifications Settings and request-center sheet inventory for sound/desktop/permission/event/badge preferences, project categories and mute, pending approvals/questions, recent request history, popup suppression, daily summaries, durable state, privacy and native/mobile authority.
---

# Notifications and request center

## Purpose and keywords

Make delivery choices, project exceptions and actionable requests understandable
without losing policy, approval authority or private context. Keywords:
Notifications, sounds, desktop alerts, permission, taskbar/Dock, daily summary,
project categories, mute/pause/resume, custom time, pending, request history,
question, approval, popup, sheet/drawer, clear, source conversation.

## Inventory and coordination

2026-10-27 main d8bf868fae841b8b391ce148487cd7d373ea9762; nested mobile identity is
in the evidence snapshot. T2 audit only:18 records (three V+S/fifteen S),22
surface/state families. Root writes documents; three native read-only reviewers
cover project preferences, sheet/history and delivery/summary. No live claims API
was exposed; available session/worktree context was consulted. This card is not
a concurrency lock. Preserve concurrent shell, ButtonGroup and Host transport
work. Refresh claims/source/build identity before implementation.
ProjectRail, native lib registrations, Button styles and mobile session privacy/
scroll changes are snapshot-only concurrent files; no baseline-clean claim applies
to those files.

Search roots: src/features/notifications, src/features/settings,
src/features/sessions, src/features/tasks, src/app/workspace, src-tauri,
src/shared/ui, tests/browser and mobile. Search copy/identifiers: Notifications,
Project notifications, Notification history, Pending, Show request popups,
DAILY_SUMMARY, notification_permission, show_notification, set_taskbar_attention,
respondHarnessApproval/Question and notification preference storage keys.

## Surface inventory

- Settings channels/events/permission/schedule:
  `src/features/settings/ui/NotificationsSettings.tsx`, `NotificationsSettings.css`;
  `src/features/settings/ui/SettingsView.tsx:478` and searchable ownership in
  `src/features/settings/model/settings.ts`.
- Project collection/detail/selection/reveal:
  `src/features/notifications/ui/ProjectNotificationSettings.tsx`,
  `ProjectNotificationSettings.css`; `NotificationMuteControl.tsx`,
  `NotificationMuteDatePicker.tsx`, `notificationMuteActions.ts`. Keep context
  menu/rail reuse through `src/features/inbox/ui/InboxNotificationMenu.tsx` and
  `src/app/shell/ProjectRail.tsx`.
- Models: `src/features/notifications/model/notifications.ts`,
  `notificationEvents.ts`, `notificationPreferences.ts`, `notificationProjects.ts`,
  `notificationHistory.ts`, `dailySummarySettings.ts`, `attention.ts`,
  `approvalToast.ts`, `dockBadge.ts`; sound preference `src/features/settings/model/sounds.ts`.
- Hooks under `src/features/notifications/hooks/`: useProjectNotificationPreferences,
  useNotificationProjects, useInputNotifications, useAttentionNotifications,
  useBackgroundNotifications, useDailySummary, useSessionReminders and useDockBadge.
- Request-center/popup surface `src/features/sessions/ui/ApprovalToasts.tsx`,
  `notification-sheet.css`; app derivation
  `src/app/workspace/derived/useWorkspaceNotifications.ts`; routing
  `src/app/workspace/sessions/useApprovalActions.ts` and native events
  `src/app/workspace/input/useNativeMenuEvents.ts`.
- Approval routes retain respondHarnessApproval/respondHarnessQuestion/
  keepHarnessQuestionOpen from `src/integrations/harness`; remoteSessionActions
  and worker/parent navigation remain owned by existing session orchestration.
  No new Host approval, permission or notification RPC/tool is delivered here.
- Daily summary uses `src/features/tasks/model/dailySummary.ts`,
  `dailySummaryClient.ts` (listBoardTaskResults/listBoardGoalResults/listMachineLimits
  through existing Tasks/Goals/settings clients), `src/features/tasks/ui/TasksView.tsx`
  and `src/app/workspace/layout/WorkspaceToolPanels.tsx`. Existing Tasks/Host
  capability/error/partial-machine authority remains; see feature-tasks-goals.
- Native commands in `src-tauri/src/notifications.rs`: notification_permission,
  request_notification_permission, show_notification, open_notification_settings,
  set_taskbar_attention; registration `src-tauri/src/lib.rs:542`. macOS prompt/
  click delegate, Windows WinRT/Settings/taskbar and Linux freedesktop differ.
  Windows has no runtime authorization prompt; macOS Dock count is separate.
- Current mobile permission owners:
  `mobile/src/features/permissions/device-permissions.ts`,
  `device-permission-settings.tsx` (Expo read/request/local test, Android channel).
  Current session route owner `mobile/src/features/workspace/session-screen.tsx`;
  legacy screens path is not automatically the active route. No matching desktop
  local-history sheet found in the inspected current routes. No remote push or
  device acceptance is established by this inventory.
- Shared Button, Badge, Switch, Select/SearchableSelect, SearchInput, Popover,
  ConfirmMorph, DateTimePicker and Modal end placement are reusable; preserve
  current domain lifecycle and shared overlay/appearance/motion ownership.
- Copy families: Sounds/Desktop notifications, four desktop events, permission
  granted/denied/unsupported/unavailable/request/system settings, Daily summary/
  Schedule details, project search/count/categories/selection, mute presets/
  custom/resume, Pending/history, Open session, popup settings/hide/clear.
  Mute/date and several OS scaffolding strings still need localization.
- Tests: all colocated `src/features/notifications/` tests plus
  `src/features/settings/ui/NotificationsSettings.test.ts`,
  `src/features/sessions/ui/ApprovalToasts.test.ts`,
  `src/features/inbox/ui/InboxNotificationMenu.test.ts`. Existing fixture:
  `tests/browser/notifications.e2e.ts`, `notifications.tsx`, `notifications.html`,
  `playwright.notifications.config.ts`; relevant Settings/layout fixture too.

## Owner decision

2026-10-27 conversation0567326f-aade-4baa-89f3-b44c6256ae9e, exact quote:

> notification ayarları ve sheet ide yeni anlayışımıza göre düzenlenmesi gerekiyor.

This requests the next staged audit/design step. No new channel/default,
retention/unread policy, OS permission or approval authority is selected.

## Behavior to preserve

Sound/desktop/request-popup independence; disabled desktop retains event/project/
summary choices. Windows taskbar dependency stays separate from macOS Dock count.
Source defaults remain desktop off, sounds on, events on, summary on09:00 with
delivery globally gated. Summary supports valid HH:mm beyond its17 hour choices.
Retain late-open/local-day, single lead/no overlap, dispatch retry, same-mount
suppression, Tasks click routing and partial-machine data. Repair cache/sent-time
durability and live lock-aware cached summary before accepting redesign.

Project normalized/machine/provider identities, metadata search, visible/known
count, bounded list, query/selected-hidden retention, all-known bulk semantics,
target reveal and per-kind category options. Mute/category independence, unread
Inbox preservation, delayed-replay guards, expiry subscriptions and custom-time
draft/validation/cancel/retry/focus. Project write failures already throw.

Pending includes focused requests; popups exclude the focused conversation.
Locked/hidden content stays redacted with generic aggregate; local Host-down may
contribute to count. Popup at most3,12-second timeout/pause/occurrence rules,
dismissal without resolution, live approval/session/remote/worker/worktree gates.
History is capped100 question/approval arrivals, not unread/resolved/all-delivery
history. Preserve Web Locks/merge-at-write/StrictMode/local append fallback,
confirmed clear, tab keyboard navigation and nonmodal/nested focus/dismissal.
New history source-open must honor current access and unavailable/deleted state.

Phone permission/test delivery does not enable computer alerts. Preserve current
Expo native integration and verify older inventories against current nested source.
No new mobile history store or remote push is implied.

## Proposals and repair dependencies

Bounded General/Projects settings composition, nearby project context/actions,
short schedule/help and accurate permission/dependency state. Clear request
history scope, stable title/preview/meta/detail identity, source-open and truthful
empty/clear/local options. Reuse shared focus/filter rules from feature-keybindings.
Fix silent global saves, unavailable project/history reads, scoped local errors,
permission freshness/truth, taskbar preference/retry, summary durability/relock
and approval local pending/error through existing owners. No private data in new
summaries/filter choices; no fabricated read/resolution state.

Full register/22-family checklist and brief:
`temp/local/2026-10-27-settings-notifications-audit/AUDIT.md`,
`temp/local/2026-10-27-settings-notifications-audit/REDESIGN.md`.
Main plan Z; Tasks/privacy cards record the cached-summary dependency.

## Checks, blockers and handoff

Fresh161 existing tests/20 suites pass; existing React act warnings retained.
Raw command/log, source/capture hashes, static/document/hygiene checks and
schematic light728/dark390 evidence:
`temp/verification/2026-10-27-settings-notifications-audit/`.
These are source/mock/fixture inventory and design proof, not repairs or actual
native delivery/accessibility. No compile required for documentation-only work.

Implementation acceptance: changed Settings/project/sheet/popup/options/summary
light/dark1280/800; narrow390/long locale/zoom/coarse pointer/keyboard/reader/
forced colors/reduced motion. Failure/race/restart/sibling/relock/remote/source-
unavailable checks need isolated stores/Hosts and platform runs. Windows/macOS/
Linux OS permission/banner/click/badge/sound and phone permission/test need real
native/device acceptance. No owner data/permission/approval experiment here.

Audit/design ready locally, uncommitted. Product implementation pending; installed
inclusion UNKNOWN. No app, preference, OS, approval, Host, index/branch, build,
install or release change. Baseline is a source reference, not a delivered fix.
Update user guides and immutable delivery references when behavior changes.

## Approval intent conservation continuation, 2026-10-30

ApprovalToasts and the actual transcript ApprovalControls now use the shared
`useApprovalDecisionControl` and render-issued opaque request tokens. SessionPane
supplies its actual Session through ApprovalDecisionProvider. Global notifications
and pane projections may have different presentation metadata; the bounded intent
registry conserves both exact contexts and joins only their actual original source
request. Pending/uncertain decisions stay disabled across unmount/remount. A true
pre-effect refusal is local error feedback; callback settlement remains unconfirmed
without provider proof. Accepted Native events and guarded Host snapshots can
retire the represented original; absence, replacement and callback return cannot.
The private registry is a physical-profile Parent producer, not permission or
Native Buffers qualification. Source/evidence packet:
`temp/verification/2026-10-30-decision-inputs/`. Installed inclusion is unknown.

## H3 Settings pages A implementation, 2026-10-28

Uncommitted source delivery in the existing checkout; no release or installed
inclusion claim. NotificationsSettings consumes the shared Group/Row owner with
independent topic layout, a compact local-clock schedule, optional detail and
preserved non-hour HH:mm. Failed sound/desktop/event/schedule writes return
receipts and expose target-local retry instead of accepting optimistic success.
Notification permission bridge failure/malformed output is unavailable; cache
updates reject stale probe/request completions. Settings serializes reads and
requests, supports read-only Refresh and requests permission only on user intent.
Project rows expose distinguishing detail in visible text and accessible names,
state visible/known scope and all-known bulk scope, offer Clear search and put
category recovery beside its project. Existing reveal, selection, bounded scroll,
provider identity, mute/date and delivery authority are preserved.

Files: settings/ui/NotificationsSettings.tsx/.css; settings/model/sounds.ts;
notifications/model/notifications.ts, notificationEvents.ts,
dailySummarySettings.ts; notifications/ui/ProjectNotificationSettings.tsx.
Regression source was added/updated but **test edilmedi** under the owner night
rule. No compiler, browser/dev server, screenshots, OS notification or user-store
operation was executed by this writer. Root owns the one final compiler run.
NTF-01/02/09/11 and parts of NTF-10/17 are proposed REVIEW; history/request-center,
project unreadable-store, taskbar, cached-summary privacy and sent identity remain
explicit open owner dependencies. Windows unknown native permission can still
appear granted; app-lifecycle freshness outside Settings remains a shell task.
Per-ID changes, files, open work and morning checks are recorded in
`temp/local/2026-10-28-settings-pages-a/personal.json`. New locale additions are
prepared for root merge in personal-locales.json; no locale source was written.
