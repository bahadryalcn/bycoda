---
name: feature-settings
description: "bycoda settings feature map: preferences, appearance, providers, notifications, privacy, connections, workspace, source control, skills, MCP, voice, usage and archives. Read before changing settings or diagnosing missing persisted controls."
---

# Settings

Purpose: make application, workspace and agent preferences discoverable, editable and recoverable without losing existing values or permission gates. Keywords: settings, preferences, General, Appearance, Notifications, Keybindings, Privacy, Workspace, Terminal, Connections, Source control, Inbox, Archive, Crews, Chat, Providers, Usage, Limits, MCP, Skills.

## Inventory and concurrency

Inventoried from the committed s0 contract baseline on 2026-10-26. Paths below exist in this worktree; implementation trees include their colocated tests and styles. Re-run the listed searches when the feature changes. This card records scope, not live ownership: consult host-authoritative feature claims for the canonical project and feature key before writing. If that capability is unavailable, report the coordination gap and agree a separate sub-scope; a tracked Active line is not a lock.

## Owner decisions

## Proposals

None recorded. Agent design suggestions belong here, separately from dated owner quotations.

## Surfaces

### Desktop settings components

All current settings TSX components, including reusable controls and background previews:

- `src/features/settings/ui/AntigravityAccountSettings.tsx`
- `src/features/settings/ui/AppearanceBehaviorSettings.tsx`
- `src/features/settings/ui/AppearancePreviews.tsx`
- `src/features/settings/ui/AppearanceSettings.tsx`
- `src/features/settings/ui/ArchiveSettings.tsx`
- `src/features/settings/ui/ChatSettings.tsx`
- `src/features/settings/ui/ConnectionRecoverySettings.tsx`
- `src/features/settings/ui/ConversationDisplaySettings.tsx`
- `src/features/settings/ui/DiagnosticsSettings.tsx`
- `src/features/settings/ui/ExternalMcpAccess.tsx`
- `src/features/settings/ui/FileAccessSettings.tsx`
- `src/features/settings/ui/GeneralSettings.tsx`
- `src/features/settings/ui/GradientBlurBackground.tsx`
- `src/features/settings/ui/InboxConnectionStatus.tsx`
- `src/features/settings/ui/InboxSettings.tsx`
- `src/features/settings/ui/JiraSettings.tsx`
- `src/features/settings/ui/LanguageSettings.tsx`
- `src/features/settings/ui/LiveBackgroundCanvas.tsx`
- `src/features/settings/ui/LiveBackgroundPicker.tsx`
- `src/features/settings/ui/McpSettings.tsx`
- `src/features/settings/ui/NotificationsSettings.tsx`
- `src/features/settings/ui/PoliciesSettings.tsx`
- `src/features/settings/ui/PrivacyStartupSettings.tsx`
- `src/features/settings/ui/ProviderAccountsSettings.tsx`
- `src/features/settings/ui/ProviderBinarySettings.tsx`
- `src/features/settings/ui/ProviderSettings.tsx`
- `src/features/settings/ui/SessionListSettings.tsx`
- `src/features/settings/ui/SettingsSearch.tsx`
- `src/features/settings/ui/SettingsView.tsx`
- `src/features/settings/ui/ShortcutSettings.tsx`
- `src/features/settings/ui/SourceControlSettings.tsx`
- `src/features/settings/ui/TemplatesSettings.tsx`
- `src/features/settings/ui/TerminalProfileDiscovery.tsx`
- `src/features/settings/ui/TerminalSettings.tsx`
- `src/features/settings/ui/TranslationSettings.tsx`
- `src/features/settings/ui/WorkspaceEditorSettings.tsx`
- `src/features/settings/ui/WorkspaceFeatureGate.tsx`
- `src/features/settings/ui/WorkspaceFeatureSettings.tsx`
- `src/features/settings/ui/WorkspaceSettings.tsx`
- `src/features/settings/ui/settingsControls.tsx`
- `src/features/settings/ui/useAppearanceSettings.tsx`

### Navigation and embedded feature surfaces

- `src/app/shell/SettingsRail.tsx`
- `src/app/workspace/layout/WorkspaceSettingsSurface.tsx`
- `src/app/workspace/state/useSettingsBackedFlags.ts`
- `src/app/workspace/surfaces/useSettingsSurface.ts`
- `src/features/connections/ui/ConnectionsSettings.tsx`
- `src/features/connections/ui/PhoneConnectionPanel.tsx`
- `src/features/connections/ui/PhonePairingDialog.tsx`
- `src/features/crews/ui/CrewsSettings.tsx`
- `src/features/group-lock/ui/GroupLockSettings.tsx`
- `src/features/group-lock/ui/HiddenGroupsSettings.tsx`
- `src/features/notifications/ui/NotificationMuteControl.tsx`
- `src/features/notifications/ui/NotificationMuteDatePicker.tsx`
- `src/features/notifications/ui/ProjectNotificationSettings.tsx`
- `src/features/skills/ui/SkillDocumentPreview.tsx`
- `src/features/skills/ui/SkillPicker.tsx`
- `src/features/skills/ui/SkillPromptField.tsx`
- `src/features/skills/ui/SkillsPage.tsx`
- `src/features/source-control/ui/WorktreesPage.tsx`
- `src/features/usage/ui/UsageBudgets.tsx`
- `src/features/usage/ui/UsageDisplaySettings.tsx`
- `src/features/usage/ui/UsagePage.tsx`
- `src/features/voice/ui/VoiceSettings.tsx`

Shared preference/provider controls also pass through `src/features/sessions/model/desktopPreferencesControl.ts`, `src/features/providers/model/providerManagementControl.ts`, `src/features/providers/model/providerAccountControl.ts`, `src/app/workspace/control/useAppControlRequests.ts` and native `src-tauri/src/control.rs`. Related persisted feature preferences live in `src/features/notifications/model/notificationPreferences.ts`, `src/features/source-control/model/gitGenerationPreferences.ts`, `src/features/skills/model/skillPreferences.ts` and `src/features/sessions/model/translationPreferences.ts`.

The complete settings implementation and storage/behavior tests live in `src/features/settings/`. `src/features/settings/model/settings.ts` owns section IDs, grouping, search metadata and stored settings; `src/shared/lib/storedSetting.ts` owns the preference primitive. Section IDs include notifications, workspace, general, policies, connections, appearance, keybindings, terminal, chat, providers, crews, usage, limits, mcp, skills, inbox, worktrees, groupLock and archive; compatibility IDs need not correspond to a distinct visible page.

### Host, RPC and tools

- `host/app-skills.ts`
- `host/harness-skills.ts`
- `host/mcp-entry.ts`
- `host/mcp-http.ts`
- `host/mcp-proxy.ts`
- `host/mcp-tokens.ts`
- `host/mobile-access-config.ts`
- `host/mobile-access-process.ts`
- `host/mobile-access.ts`
- `host/mobile-lan-crypto.ts`
- `host/mobile-lan.ts`
- `host/mobile-pairing.ts`
- `host/provider-accounts.ts`
- `host/provider-auth.ts`
- `host/providers.ts`
- `host/desktopLive.ts`
- `host/reviewed-desktop-scope.ts`
- `host/server.ts`
- `host/skill-policy.ts`
- `host/skills.ts`
- `host/store.ts`
- `host/voice-local.ts`
- `host/voice-python-install.ts`
- `host/voice-python.ts`
- `host/voice-runtime.ts`
- `host/voice-setup.ts`
- `host/voice-speech-python.ts`
- `host/voice-speech.ts`
- `host/voice.ts`
- `host/workspace-contracts.ts`
- `host/workspace-rpc-contracts.ts`
- `host/workspace-service-contracts.ts`

RPC/capability identifiers found in the dispatcher: `host.settings.get`, `host.settings.save`, `mobile.access`, `mobile.access.disable`, `mobile.access.enable`, `mobile.access.status`, `mobile.pairing`, `mobile.pairing.cancel`, `mobile.pairing.create`, `mobile.pairing.status`, `preferences.desktop.patch`, `preferences.desktop.read`, `preferences.desktop.status`, `preferences.desktop.template.read`, `preferences.desktop.v1`, `providers.acp.patchMetadata`, `providers.center.read`, `providers.desktop.metadata.v1`, `providers.desktop.patch`, `providers.desktop.quota.refresh`, `providers.desktop.quotaRefresh.v1`, `providers.desktop.read`, `providers.desktop.status`, `providers.desktop.v1`, `voice.clientSecret`, `voice.local.inspect`, `voice.local.keepAlive`, `voice.local.release`, `voice.local.setup`, `voice.local.setup.v1`, `voice.local.setupStatus`, `voice.local.speak`, `voice.local.speechCancel`, `voice.local.speechNext`, `voice.local.start`, `voice.local.transcribe`, `voice.local.v1`, `voice.realtime.v1`. Skills and MCP tool discovery is also rooted in `host/conversation-tools.ts` and `host/skills.ts`; do not confuse installation inventory with permission or connection status. Workspace-policy RPCs in the contract modules are frozen interfaces and must not be presented as implemented merely because a type exists.

### Native

- `src-tauri/src/conversation_tools_bridge.rs`
- `src-tauri/src/file_access.rs`
- `src-tauri/src/keep_awake.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/src/mcp.rs`
- `src-tauri/src/notifications.rs`
- `src-tauri/src/provider_terminal_profiles.rs`
- `src-tauri/src/provider_usage.rs`
- `src-tauri/src/quick_composer.rs`
- `src-tauri/src/remote.rs`
- `src-tauri/src/skills.rs`
- `src-tauri/src/terminal_profiles.rs`
- `src-tauri/src/window.rs`

Settings invoke native glass/blur, keep-awake, file access, notifications, MCP, provider and quick-composer operations; preserve platform guards and restart/application boundaries.

### Mobile and localization

No mobile source directory is present in this baseline; a mobile settings screen inventory cannot be verified here. Desktop phone settings are listed above. Locale catalogs are `src/shared/i18n/locales/`, with `src/shared/i18n/index.ts`, `src/shared/i18n/en-overrides.json` and `src/shared/i18n/tr-overrides.json`. Keys are English source messages rather than feature namespaces: search section titles and prefixes such as Settings, General, Appearance, Notifications, Workspace, Provider, Terminal, Privacy, Language, MCP, Skills, Voice, Archive and Source control, plus the exact strings used by the changed component.

### Browser fixtures and scenarios

- `tests/browser/arc-controls.html`
- `tests/browser/arc-controls.spec.ts`
- `tests/browser/arc-controls.tsx`
- `tests/browser/external-mcp.html`
- `tests/browser/external-mcp.spec.ts`
- `tests/browser/external-mcp.tsx`
- `tests/browser/live-backgrounds.e2e.ts`
- `tests/browser/live-backgrounds.html`
- `tests/browser/live-backgrounds.tsx`
- `tests/browser/notifications.e2e.ts`
- `tests/browser/notifications.html`
- `tests/browser/notifications.tsx`
- `tests/browser/playwright.arc-controls.config.ts`
- `tests/browser/playwright.external-mcp.config.ts`
- `tests/browser/playwright.notifications.config.ts`
- `tests/browser/playwright.settings.config.ts`
- `tests/browser/playwright.worktrees.config.ts`
- `tests/browser/policies.e2e.ts`
- `tests/browser/serve-arc-controls.mjs`
- `tests/browser/serve-external-mcp.mjs`
- `tests/browser/serve-settings.mjs`
- `tests/browser/settings-layout.e2e.ts`
- `tests/browser/settings-notifications.e2e.ts`
- `tests/browser/settings-open.e2e.ts`
- `tests/browser/settings-organization.e2e.ts`
- `tests/browser/settings-skills.e2e.ts`
- `tests/browser/settings-subviews.e2e.ts`
- `tests/browser/settings-ui-details.e2e.ts`
- `tests/browser/settings.e2e.ts`
- `tests/browser/settings.html`
- `tests/browser/settings.tsx`
- `tests/browser/shared-controls.html`
- `tests/browser/shared-controls.spec.ts`
- `tests/browser/shared-controls.tsx`
- `tests/browser/terminal-settings.e2e.ts`
- `tests/browser/vite.arc-controls.config.ts`
- `tests/browser/vite.external-mcp.config.ts`
- `tests/browser/vite.notifications.config.ts`
- `tests/browser/vite.settings.config.ts`
- `tests/browser/vite.worktrees.config.ts`
- `tests/browser/voice-settings.e2e.ts`
- `tests/browser/workspace-settings.e2e.ts`
- `tests/browser/worktrees.e2e.ts`
- `tests/browser/worktrees.html`
- `tests/browser/worktrees.tsx`

The settings Playwright config explicitly selects settings, workspace, terminal, policies, live-background and voice specs; dedicated Arc, external MCP, notifications and worktrees configs select their corresponding specs. Shared-control specs are listed as cross-feature acceptance surfaces. Inspect each config before launch: fixed ports differ and an occupied port is a blocker, not permission to kill another process.

## Existing behavior to preserve

- Section navigation, cross-section search/reveal anchors, saved section, automatic saves, custom values and external preference-change subscriptions.
- Light/dark/custom themes, scale, native glass guards, reduced motion and bounded background rendering; use semantic tokens and shared controls.
- Provider/account identity and defaults, MCP authentication, disabled skill policy, file-access/privacy gates, notifications and project mute state. Reads or restyling do not authorize install, credential change, microphone use, sending or publication.
- Archives retain restore/delete distinctions; workspace and connection failure states retain drafts and local recovery actions.

## Checks and visual acceptance

- Re-enumerate with `rg --files src/features/settings src/app tests/browser`; search section labels, stored keys and native/RPC calls before editing.
- Run focused settings model/control/view tests using `pnpm vitest run src/features/settings/model/settings.test.ts src/features/settings/model/settings.storage.test.ts src/features/settings/ui/settingsControls.test.ts src/features/settings/ui/SettingsView.test.ts`, plus tests beside changed controls and `pnpm check:web:fast` for changed TS contracts.
- Exercise every changed settings section and embedded control at 1280 and 800 widths in light/dark; open screenshots from `temp/verification/<id>/`. Cover long translations, searchable lists, keyboard/focus/Escape, reduced motion, save pending/error/retry, and navigating away/back. Fixture rendering is separate from native persistence, Host and installed-build acceptance.
- Check build identity before treating an owner screenshot as a new source defect.

## Known concrete blockers

Mobile sources are absent from the s0/s7 baseline, so corresponding mobile settings routes, locale keys and physical-device behavior remain unenumerated. No product behavior was executed by this inventory.

## Evidence and handoff

Committed inventory baseline: `f26ac112404e326478adb687c23ca9cc032acfef`. See `docs/reference/managed-workspaces.md` for frozen contracts, not proof of runtime availability. Record subsequent delivered behavior with a commit reference and exercised evidence. This documentation change did not exercise product UI, a native app, a physical phone, a live Host, installation or release.
