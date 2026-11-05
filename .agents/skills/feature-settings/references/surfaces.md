# Settings routing and surfaces

All code paths below are repository-relative. This is a starting map; follow current imports and dispatcher registrations rather than treating a listed path or type as a delivered capability.

## Route page work

| Change                                            | Read only the relevant specialist                                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| General, languages, power, diagnostics, updater   | [General](../../feature-general-settings/SKILL.md)                                                                                                |
| Theme, typography, density, backgrounds           | [Appearance](../../feature-appearance/SKILL.md); shared role changes also [theme foundation](../../feature-theme-foundation/SKILL.md)             |
| Notifications, mute, request center               | [Notifications](../../feature-notifications/SKILL.md)                                                                                             |
| Shortcut capture, overrides, global registration  | [Keybindings](../../feature-keybindings/SKILL.md)                                                                                                 |
| Privacy launch, locks, hidden groups, file access | [Privacy/security](../../feature-privacy-security/SKILL.md)                                                                                       |
| Editor/tool preferences, local Host experiment    | [Workspace settings](../../feature-workspace-settings/SKILL.md)                                                                                   |
| Terminal profiles                                 | [Terminal](../../feature-terminal/SKILL.md)                                                                                                       |
| Worktree policy and Git preferences               | [Source control](../../feature-source-control/SKILL.md); execution lifecycle also [managed workspaces](../../feature-managed-workspaces/SKILL.md) |
| Inbox credentials/scope                           | [Inbox settings](../../feature-inbox-settings/SKILL.md)                                                                                           |
| Archive management                                | [Archive](../../feature-archive/SKILL.md)                                                                                                         |
| Chat preferences and prompt templates             | [Chat settings](../../feature-chat-settings/SKILL.md)                                                                                             |
| Models/accounts/provider setup                    | [Providers](../../feature-providers/SKILL.md)                                                                                                     |
| Usage analytics, provider quotas, local budgets   | [Usage](../../feature-usage/SKILL.md)                                                                                                             |
| Outgoing MCP config or incoming grants            | [MCP](../../feature-mcp/SKILL.md)                                                                                                                 |
| Skill management                                  | [Skills](../../feature-skills/SKILL.md)                                                                                                           |
| Crew configuration                                | [Crews](../../feature-crews/SKILL.md)                                                                                                             |
| Voice runtime/setup                               | [Voice](../../feature-voice/SKILL.md)                                                                                                             |

## Shell and shared state

- Navigation/search: `src/features/settings/ui/SettingsView.tsx`, `SettingsSearch.tsx`; `src/features/settings/model/settings.ts`; `src/app/shell/SettingsRail.tsx`. Follow `src/app/workspace/layout/WorkspaceSettingsSurface.tsx` for app wiring.
- Common controls/layout: `src/features/settings/ui/settingsControls.tsx`, `BycodaSettings.css`; inspect current collection adapters before changing external consumers.
- Preference routing: `src/features/sessions/model/desktopPreferencesControl.ts`, `src/app/workspace/control/useAppControlRequests.ts`, `src-tauri/src/control.rs`; ordinary local preferences and capability-gated remote control are distinct.
- Native registration/bridge: `src-tauri/src/lib.rs`, `remote.rs`. Host contracts: `host/workspaces/workspace-rpc-contracts.ts`; verify the actual dispatcher/service before claiming an RPC exists.
- Localization: `src/shared/i18n/locales/`, `en-overrides.json`, `tr-overrides.json`. Search actual source messages; do not assume feature-key namespaces.

## Policies

- UI/model: `src/features/settings/ui/PoliciesSettings.tsx`, `policies.css`; `src/features/settings/model/policies.ts`, `policyTranslations.ts`.
- Preserve full bundled documents, source dates/license/destinations, local document language, MIT English language metadata, offline fallback and reader scroll ownership.
- Follow Markdown URL opening and native mail/opener permissions; keep copy-address recovery and reject stale results after changing document.
- Mobile: `mobile/app/legal/[document].tsx`, `mobile/src/features/legal/`; do not infer desktop four-tab parity from shared legal content.

## Connections

- `src/features/connections/ui/ConnectionsSettings.tsx`, `PhoneConnectionPanel.tsx`, `PhonePairingDialog.tsx`; follow their model/remote-command imports.
- Host entry points: `host/mobile/mobile-access.ts`, `mobile-pairing.ts`, `mobile-access-config.ts`; native bridge `src-tauri/src/remote.rs`.
- Search registered `mobile.access.*` and `mobile.pairing.*` operations. Retain owner-device identity, explicit pairing/enable/disable intent, expiry, cancellation and uncertain-result recovery; never infer a paired-phone roster without a data source.
- Mobile authority and phone permission/settings use the separate mobile repository/routes; read [mobile](../../feature-mobile/SKILL.md) when those contracts change.

## Focused verification

- Shell/model/control: colocated `SettingsView.test.ts`, `settingsControls.test.ts`, `settings.test.ts`, `settings.storage.test.ts`; Policies `PoliciesSettings.test.ts`.
- Browser: `tests/browser/settings.e2e.ts`, `settings-layout.e2e.ts`, `settings-subviews.e2e.ts`, `settings-organization.e2e.ts`, `policies.e2e.ts`; inspect `playwright.settings.config.ts` for selected specs and port ownership.
- Select tests for changed behavior, not the entire inventory by default. Shared changes need representative consumers, both themes and keyboard/reduced-motion checks. Native/pairing/installed acceptance remains distinct from fixture evidence.
