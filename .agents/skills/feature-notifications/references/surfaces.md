# Notifications surfaces

Paths are repository-relative.

The bottom-right workspace sound shortcut is `src/features/notifications/ui/SoundsButton.tsx`,
composed by `src/app/shell/WorkspaceControls.tsx`. It uses the shared application
sound preference in `src/features/settings/model/sounds.ts`, including Settings
synchronization, persistence and failed-save retry; desktop alerts remain independent.

| Area                                | Owner                                                                                                                                                                                                                                                                                   |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Channels/events/permission/schedule | `src/features/settings/ui/NotificationsSettings.tsx`, `NotificationsSettings.css`; Settings model/reveal metadata                                                                                                                                                                       |
| Project collection/mute             | `src/features/notifications/ui/ProjectNotificationSettings.tsx`, `NotificationMuteControl.tsx`, `NotificationMuteDatePicker.tsx`, `notificationMuteActions.ts`                                                                                                                          |
| Entry reuse                         | `src/features/inbox/ui/InboxNotificationMenu.tsx`; `src/app/shell/ProjectRail.tsx`                                                                                                                                                                                                      |
| Preferences/history/delivery        | `src/features/notifications/model/notifications.ts`, `notificationEvents.ts`, `notificationPreferences.ts`, `notificationProjects.ts`, `notificationHistory.ts`, `dailySummarySettings.ts`, `attention.ts`, `approvalToast.ts`, `dockBadge.ts`; `src/features/settings/model/sounds.ts` |
| Hooks                               | `src/features/notifications/hooks/` for project state, input/attention/background delivery, daily summary, reminders and Dock badge                                                                                                                                                     |
| Request UI/routing                  | `src/features/sessions/ui/ApprovalToasts.tsx`, `notification-sheet.css`; `src/app/workspace/derived/useWorkspaceNotifications.ts`; `src/app/workspace/sessions/useApprovalActions.ts`                                                                                                   |
| Task summaries                      | `src/features/tasks/model/dailySummary.ts`, `dailySummaryClient.ts`; `src/features/tasks/ui/TasksView.tsx`; follow current cached-summary access identity                                                                                                                               |

## Approval and platform boundaries

- The request center includes pending requests from the focused conversation.
  Popups use `hiddenApprovalNotices` and exclude a conversation only when the
  existing conversation/composer focus predicate matches. Do not reuse the popup
  subset as the complete request-center population.
- Session responses use existing harness `respondHarnessApproval`, `respondHarnessQuestion`, `keepHarnessQuestionOpen` and remote/worker session routing. Follow current `useApprovalDecisionControl` and provider event/snapshot settlement before changing decision lifecycle.
- Do not join decisions merely because two views look alike; the represented original source request and render-issued context are authoritative. Unmount, replacement, missing item or resolved callback alone is not confirmed delivery.
- Native commands in `src-tauri/src/notifications.rs`: `notification_permission`, `request_notification_permission`, `show_notification`, `open_notification_settings`, `set_taskbar_attention`; registration in `src-tauri/src/lib.rs`.
- Desktop banners are background-only across platforms. Delivery rechecks focus
  after batching; native `show_notification` also checks all app windows and returns
  `false` for suppression, `true` for scheduled delivery. Keep in-app indicators,
  sound preferences and reminder arrival state independent; macOS foreground
  presentation must not request a banner or system sound.
- Windows WinRT/Settings/taskbar, macOS prompt/delegate/Dock and Linux freedesktop semantics differ. Keep permission-bridge failure unknown/unavailable instead of normalizing it to success.
- Mobile permission owners: `mobile/src/features/permissions/device-permissions.ts`, `device-permission-settings.tsx`; session route `mobile/src/features/workspace/session-screen.tsx`. Local test delivery is not remote-push or desktop-history parity.
- Phone push: Host `host/push/` (event detection, registration store, Expo sender, presence hold), wired by `host/server/push.ts` and `rpc-push.ts`; desktop presence from `src/shared/lib/userPresence.ts` on the `sessions.desktopLive` beat; phone side `mobile/src/features/push/`. Contract: `docs/reference/remote-session-protocol.md` (Phone push notifications). Push text stays free of project and conversation names; a delivered Expo ticket is not proof the phone showed it.
- History retains the source's bounded arrival/merge/clear contract. Schedule stores valid HH:mm, not only predefined hour choices.

## Focused checks

Select colocated notification model/hook/UI tests, `NotificationsSettings.test.ts`, `ApprovalToasts.test.ts` and `InboxNotificationMenu.test.ts`. Summary changes also need the relevant task data/cache tests; approval semantics require decision-control/provider-boundary tests.

Browser entry points: `tests/browser/notifications.e2e.ts`, `notifications.tsx`, `playwright.notifications.config.ts` and relevant Settings scenarios. Cover long project identities, search/selection and bulk scope, custom mute expiry, permission freshness, sibling saves, pending/uncertain approvals across views/remount, locked/hidden redaction, summary relock/restart, history clear and source-unavailable navigation. Use isolated stores/Hosts; OS banner/click/badge/sound and device permission need actual platform evidence.
