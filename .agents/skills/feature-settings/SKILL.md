---
name: feature-settings
description: "bycoda settings feature map: preferences, appearance, providers, notifications, privacy, connections, workspace, source control, skills, MCP, voice, usage and archives. Read before changing settings or diagnosing missing persisted controls."
---

# Settings

## H3 Settings pages B reference migration, 2026-10-28

Inbox, Chat, Providers, Usage/Limits, MCP, Skills and Policies consume the shared
reference; Crews receives only a Settings-owned integration wrapper while H2 owns
its files. `settingsControls.tsx` remains the public owner and root's sole writing
scope. Topic collection spacing lives in `BycodaSettings.css`; page composition
does not authorize another Group/Row skin. All nine requested pages and individual
audit IDs, plus remaining Settings inconsistencies, are recorded in
`temp/local/2026-10-28-settings-pages-b/handoff.json`.

No real provider/MCP/credential/budget mutation was executed. Permission gates,
storage/defaults/validation, drafts and reveal remain owned by existing services.
Test edilmedi under the overnight rule; only the final direct fast compiler is
permitted. Source implementation remains uncommitted and at most REVIEW; native,
installed and release acceptance remain separate.

Purpose: make application, workspace and agent preferences discoverable, editable and recoverable without losing existing values or permission gates. Keywords: settings, preferences, General, Appearance, Notifications, Keybindings, Privacy, Workspace, Terminal, Connections, Source control, Inbox, Archive, Crews, Chat, Providers, Usage, Limits, MCP, Skills.

## Inventory and concurrency

Inventoried from the committed s0 contract baseline on 2026-10-26. Paths below exist in this worktree; implementation trees include their colocated tests and styles. Re-run the listed searches when the feature changes. This card records scope, not live ownership: consult host-authoritative feature claims for the canonical project and feature key before writing. If that capability is unavailable, report the coordination gap and agree a separate sub-scope; a tracked Active line is not a lock.

## Owner decisions

2026-10-27, owner conversation `0567326f-aade-4baa-89f3-b44c6256ae9e`, Policies
audit scope (verbatim excerpts separated at the inline image):

> Ayarlar ekranlarını tek tek vercem Policies de genel bir toparlanmaya ihtiyaç var. tasarım anlayışında.

> böyle bir about accordion var niye var anlamadık bile. Bu tarz şeylere bakarsın.

This requests staged Settings audit/design, starting with Policies. No new legal
text, language persistence/default, consent or permission behavior was selected.

## Proposals

Policies proposal, 2026-10-27: move short document-language scope beside its
selector and offline/actual-language context beside the reader; replace the
generic bottom About grouping, retain useful information, refine reading-track
alignment and consider current-document heading orientation. Match responsive
navigation with its keyboard model. Preserve legal text and all state/recovery
contracts. Product implementation remains pending; other Settings screens will
be audited individually. Do not mechanically flatten legitimate diagnostics/help.

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

Inventory delivery: `4454ce32` on `bycoda/wt-model/s7` commits this code-backed
card and the worktree-first documentation. This reference establishes inventory
delivery only; product/runtime acceptance remains as described above.

Voice setup routing correction (2026-10-27, uncommitted source change on
`main`, base `0a42b1ab4fd891ccec5ca0fa238d7356b396b13c`):
`src-tauri/src/remote.rs` now permits the existing `voice.local.setup` and
`voice.local.setupStatus` RPCs. Both were already used by Voice Settings and
implemented by the Host, but the native allowlist rejected them before dispatch.
The existing voice RPC regression test now covers both methods and retains the
arbitrary install/exec rejection checks. Host locality and active-voice gates are
unchanged. Troubleshooting is documented in `docs/guides/voice.md`.
Evidence and verification boundaries:
`temp/verification/2026-10-27-voice-install-routing/README.md`.

## Policies audit extension, 2026-10-27

T2 sub-scope, dirty shared `main @ 0a42b1ab4fd891ccec5ca0fa238d7356b396b13c`:
two light owner captures, six records (three V+S, three S), ten surface/state
families. One native read-only contract reviewer plus parent visual/source checks.
Register/design: `temp/local/2026-10-27-settings-policies-audit/AUDIT.md` and
REDESIGN.md. Evidence: `temp/verification/2026-10-27-settings-policies-audit/EVIDENCE.md`.
Live feature-claim API unavailable; available Git/worktree/native session state
inspected. No cross-machine reservation asserted. Concurrent Voice correction
and shared controls preserved. Capture/source inclusion UNKNOWN.

Current feature source: `src/features/settings/ui/PoliciesSettings.tsx`,
`policies.css`, `BycodaSettings.css`, `settingsControls.tsx`, SettingsView;
`src/features/settings/model/policies.ts`, `policyTranslations.ts`, `settings.ts`.
Four documents bundle raw English from three `docs/guides/` policy documents and
LICENSE with Turkish translations; no read-time Host/network fetch needed.
Preserve full text/dates/destinations/license, exact reveal IDs, reader-owned scroll,
roving tabs/ARIA and local document language. TR app locale defaults TR, others EN;
MIT deliberately remains English with correct article lang. No new saved preference.

About explains document language scope, offline reading and English fallback;
auto margin pushes it to the sidebar bottom. This is contextual reading help,
distinct from General's application About and Build/Connection details. The audit
proposes contextual placement, not deleting every disclosure in Settings.
Narrow two-column tab layout still declares vertical with linear Up/Down keys;
mail opener errors have shared state lacking document/late-result ownership.
These source gaps were not reproduced in installed UI. Language-switch scroll
policy is a separate acceptance risk, not a proven loss-of-position defect.

HTTP links use AgentMarkdown/openWorkspaceUrl and already have FileActionError;
mail uses native opener with copy-address recovery. Preserve existing capability/
external-opening gates. Native `src-tauri/capabilities/default.json` owns opener
permission. Mobile is separate: `mobile/app/legal/[document].tsx` routes
`mobile/src/features/legal/legal-screen.tsx`, `legal-document.tsx`, `legal-content.ts`;
`mobile/src/features/settings/settings-screen.tsx` exposes privacy/terms/help,
with MIT in Terms. No desktop/mobile four-tab parity or device acceptance claimed.

Fresh PoliciesSettings unit checks: one file/three tests pass, Markdown mocked.
Static Impeccable scan of component/CSS: [] / exit 0. Neither measures actual
contrast/layout/native opener. Existing `tests/browser/policies.e2e.ts` and mobile
legal tests read, not run. Actual product 1280/800 light/dark, narrow/zoom/keyboard/
screen reader/scroll/error/isolated native/mobile checks belong to implementation.
Audit/design only; no product, legal text, live opener/Host, build/install/release.

## Skills audit extension, 2026-10-27

Owner added three Skills captures, reported copy-induced whole-page refresh and
suggested Edit/Preview/Split plus simpler off-state display. New detailed inventory:
`.agents/skills/feature-skills/SKILL.md`; audit/design:
`temp/local/2026-10-27-settings-skills-audit/`. Eight records (five V+S, three S),
14 surface/state families; two native read-only reviews plus parent checks.

Inspected copy path has broad shared collection/policy reload after transfer/focus,
not an explicit document reload or proven copy-induced draft loss. Keep loaded
data/context and scope revalidation/errors to affected machine. Edit is raw Markdown,
Source read-only; real Split must preserve remote/managed raw access and current
local-only edit guard. Off state and saving-disabled control are distinct; invocation
metadata is independent. Retain disk conflict checks, owner inspection, native
confirmation, transfer limits/rollback, machine policy and all existing actions.

Fresh 54 tests/three files pass with mocked commands; static scan [] is not real
renderer/Host/native/device acceptance. Source inclusion UNKNOWN; product migration
pending. No live copy/toggle/delete, product edits, build/install/release. Current
mobile composer skill access exists; no dedicated management route found. Other
Settings pages remain separately scoped; Voice/Policies changes preserved.

## MCP audit extension, 2026-10-27

Owner added two MCP captures and selected infinite scroll instead of numbered
pagination. Detailed card: `.agents/skills/feature-mcp/SKILL.md`; register/design:
`temp/local/2026-10-27-settings-mcp-audit/`. Two native read-only reviewers plus
parent: 11 records (four V+S, seven S), 16 surface/state families.

Current pages only slice a complete cached connection array. Continuous reveal
should not invent a server cursor, repeat health/discovery or open authentication.
Compact row/topic/help and grant-history presentation are proposals. Preserve
exact provider/scope/config identity, local-only outgoing management and separate
incoming local-Host grants. Configured is not verified Connected. Keep stale rows,
meaningful pending identity, honest CLI status/provenance, expiry and group scopes.

Existing native Add/remove/sign-in/config and inline external revoke confirmation,
one-time secret/hash/loopback/header/auth bounds remain. 25 tests/four files pass;
static scan [] is not real renderer/native/Host/installed proof. External browser
confirmation expectation is stale; historical paging matrix is not new infinite
acceptance. Audit only, no product/config/token/live operation or build/install/
release. Other Settings pages remain individually scoped; prior work preserved.

## Limits & Budgets audit extension, 2026-10-27

Owner added six captures and selected "Ortak özet ve ortak yerel bütçe (önerim)".
New detailed card `.agents/skills/feature-usage/SKILL.md`; audit/repair:
`temp/local/2026-10-27-settings-limits-budgets-audit/`. Ten records (four V+S,
six S),18 families, two native read-only reviewers plus parent checks.

Summary-first compact account/form/history and bounded latest100 raw details are
proposals. Provider percentages/windows have no common denominator; never pool
them. Existing workspace budget means project group, not whole machine. Selected
common local budget needs real new scope/read/storage/gate work with existing
rule overlap/unknown/privacy preserved; no amount, period or block default chosen.

Source gaps: Limits-only filter inventory/All time range, target identity, read
freshness, known-meter refresh continuity and editor draft lifetime. Preserve
provider cache/history timestamps/gaps, v1 storage, token normalization and local
pre-dispatch enforcement; Host task/mobile/remote work remain separate.24 tests/
six files pass, static scan []; actual renderer/new scope/native/device acceptance
pending. Audit only, no provider/budget/send mutation or build/install/release.

## Usage analytics audit extension, 2026-10-27

Exact owner quote, conversation `0567326f-aade-4baa-89f3-b44c6256ae9e`:

> Usage kısmı özellik olarak gsöterim olarak fena değil ama daha iyi olabilir sen üzerinde çalışırsın.

Eight light captures opened; same baseline and concurrency boundary. Ten records
(five V+S, five S),18 audited families; card extends
`.agents/skills/feature-usage/SKILL.md`. Register/brief:
`temp/local/2026-10-27-settings-usage-analytics-audit/`. U07/U08 reuse previous
Limits/budget/history findings and selected common summary/local budget decision.

Target refinement: honest single-bucket trend, compact short-range time analysis,
readable selected metric/group/window and table field detail without lost data.
Repair unknown share, estimate qualifier, account label precedence, hidden turn
truncation and dynamic chart name. Preserve configured colors, exact source
identity, missing/zero/partial/stale states, privacy, CSV and drilldown context.
32 tests/four files pass, static detector []; current UI is not replaced and
actual changed product1280/800 themes/native/device acceptance remains pending.
No provider read, budget/send write, product source/build/install/release change.

## Providers audit extension, 2026-10-27

Owner's three captures request model management, defaults/options layout, missing
icons and CLI updates. Exact full quote is in
`.agents/skills/feature-providers/SKILL.md` (same owner conversation/date).
13 records (three V+S,nine S,one R+S),20 families; three read-only native reviews
plus parent. Register/brief: `temp/local/2026-10-27-settings-providers-audit/`.

Preserve provider/model/account/capability identity and operations. Clarify scope,
last-model guard/all-off fallback, catalog provenance and project inheritance.
Repair default/model storage failure truth, broad account refresh and hidden
pending ownership, update status/catalog truth and path-modal late callbacks.
Compact layout and consistent meaningful icons remain proposed; reported missing
installed glyphs unconfirmed.166 tests pass;10 source SVG structures/static[]
do not establish changed UI/native/pixel acceptance. No product/source preference,
credential/provider/CLI operation, index change or build/install/update/release.

## Chat Settings audit extension, 2026-10-27

Owner's two captures request readable Chat Settings and suggest prompt templates
behind a better menu. Exact quote in
`.agents/skills/feature-chat-settings/SKILL.md`;12 records (four V+S,eight S),
18 families, three read-only native reviewers plus parent. Register/brief:
`temp/local/2026-10-27-settings-chat-audit/`.

Compact topics and optional help/advanced sections are proposals; template menu
must open a real manager preserving fields, explicit Save, draft/conflict lifetime,
search/deep-link focus and shared SSH reviewed-body identity. Template usage help
already defaults closed; most Row descriptions are already contextual info.
Repair read/validation/save/sibling-sync truth, matching voice error recovery,
Locate late callbacks and inherited unsupported translation choice. Preserve
continuation/send/locality gates and prior Voice routing correction.315 existing
tests pass, static[]; actual changed UI/native/audio/mobile acceptance pending.
No app source, saved settings/templates, voice install or build/install/release.

## Crews Settings collection extension, 2026-10-27

Owner adds three wide/light Crew Settings/library/profile captures; exact quote
in `.agents/skills/feature-crews/SKILL.md`.10 new Settings records (three V+S,
seven S),13 families, two native read-only reviews plus parent. Register/brief:
`temp/local/2026-10-27-settings-crews-audit/`.

Propose compact Crew/library views, bounded reading/action tracks and focused
profile editor; keep scope/count, all fields/search/groups/model choices and work
access. Repair retained-data refresh/error, no-target loading, rail save feedback,
profile dirty-close, empty-model Save, conflict recovery and delete concurrency
truth. Preserve copies/snapshots, confirmations, permission/revision/uncertain
receipt guards. Prior Crew findings linked without recounting.19 model tests
pass, static[]; actual changed UI/Host/native/installed/mobile acceptance pending.
Audit only, no app/source/profile/preference/Host/run/build/install/release change.

## Archive audit extension, 2026-10-27

One owner Archive capture/accordion/long-list complaint; exact quote in
`.agents/skills/feature-archive/SKILL.md`.11 records (two V+S,nine S),15 families,
two read-only reviews plus parent. Register/brief:
`temp/local/2026-10-27-settings-archive-audit/`.
Propose compact scoped collections/search/bounded scroll and sidebar mode outside
the single-control disclosure. Its default is closed; true is archived-only, not
alongside-active. Repair empty/read/storage/sibling/filter state, false delete
success, unarchive pending and relocked confirmation ownership. Preserve count/
dirty/busy/folder/privacy/owner gates.93 tests pass, static[]; no actual new UI/
native/Host/installed/mobile acceptance or source/preference/archive/delete change.

## Privacy and security audit extension, 2026-10-27

Two owner captures/exact quote/full16-family inventory:
`.agents/skills/feature-privacy-security/SKILL.md`.12 records (two V+S/ten S),
three native read-only reviews plus root; register/brief under
`temp/local/2026-10-27-settings-privacy-audit/`. Propose bounded privacy/file and
password/lock topics, nearby actions, clear visible-group count versus protection
configuration/current locked state and authorized hidden-list search/recovery.
Ordinary group list already bounded360px. Preserve concealed names/count when a
password exists and before authorization, no-password recovery, temporary versus
permanent visibility, password/reset/cooldown/race gates and active work/tabs.
Repair unavailable read truth, protection/password/durable-setting outcomes,
pending-dismiss truth, cooldown i18n and file-status read-only recovery/read-back.
Native file consent has no third no-change outcome; retain local/remote and
read/write/agent approval boundaries.68 tests/11 suites pass, static[]. Audit
only; no product/password/group/file/consent/Host/build/install/release change.
Actual changed UI/native/mobile/installed acceptance pending; no crypto claim.

## Workspace Settings layout extension, 2026-10-27

One owner capture; exact quote/full14-family inventory in
`.agents/skills/feature-workspace-settings/SKILL.md`.8 findings (one V+S/seven S),
two native read-only reviews plus root. Register/brief:
`temp/local/2026-10-27-settings-workspace-audit/`. Propose deliberate bounded
file/editor and navigation groups, ordered narrow layout and separate local-Host
experiment scope. Preserve every control, including current Exact Git rewind
absent from capture and macOS Quick composer. Repair Notes/File tabs/Format/
Explorer subscription and preference-outcome paths; explain Notes/Autosave and
Working agents consequences without new stop/permission/confirmation behavior.
35 tests/six suites pass, static[]. Audit only; no app/preference/file/task/
agent/note/Host/index/branch/build/install/release change. Actual new UI/native/
mobile/installed checks pending. Source-control execution policy is separate.

## Terminal settings refinement, 2026-10-27

Two owner captures and exact quote in feature-terminal card.12 records
(two V+S/ten S),14 families, two native read-only reviews plus root; register/
brief under `temp/local/2026-10-27-settings-terminal-audit/`. Keep the local/
remote structure; propose one authoritative local/local-sync choice, compact
rows/refresh and consolidated help. Repair mirror/scan/read/cache state, machine
inventory/identity freshness, uncertain-save read-back, visible missing-shell
fallback and advanced search wiring. Browser local/sync fixture storage differs
from production's shared file and must be fixed before synchronization acceptance.
Preserve native/Host fallback/validation/generation, existing PTYs/commands,
machine ownership and mobile compare-before-write.7 tests/two suites pass,
static[]; no app/profile/discovery/PTY/command/Host/build/install/release changes.
Actual changed UI/native/mobile/installed checks pending. Prior terminal output
readability findings remain separate.

## Source Control settings audit extension, 2026-10-27

Five owner captures and explicit audit request; exact quote and full17-family
checklist in `.agents/skills/feature-source-control/SKILL.md`. Two native read-only
reviews plus root:13 findings (three V+S/ten S), register/brief:
`temp/local/2026-10-27-settings-source-control-audit/`. Propose scoped compact
Workspaces/Policy/Git preferences with bounded searchable collections and nearby
actions. Repair policy draft refresh/review-close loss, freshness, validation,
inheritance, post-cleanup storage, unknown publication, discovery/error states,
remote ordinary lifecycle routing and preference-save recovery. Preserve current
checkout default, optional worktrees/Exact rewind separation, fields, drafts and
all native/Host owner/process/session/confirmation/uncertain-outcome protections.
81 existing tests/nine suites pass, static[]. No product/Git/index/worktree/policy/
live/build/install/release change; actual new UI/native/Host/installed/mobile
acceptance pending. Related managed-workspaces card remains authority dependency.

## Inbox connection settings extension, 2026-10-27

Five owner captures, GitHub/GitLab/ADO/Jira/Linear. Exact quote and full14-family
inventory: `.agents/skills/feature-inbox-settings/SKILL.md`. Eleven records
(three V+S/eight S), two native read-only reviews plus root; register/brief under
`temp/local/2026-10-27-settings-inbox-audit/`. Propose bounded provider detail,
nearby actions, separate saved/verified/draft/discovery states, direct credential
editing and truthful local recovery. Preserve mounted-tab drafts/search/keyboard,
native validate-before-save, scopes and desktop-owned Host/mobile credential
authority. Repair Jira roster epochs/refresh/pending, shared error labels,
saved-versus-draft identity, persistence/sibling recovery. Discovery already
pages natively; background-sync opt-in is separate from visible demand.60 tests/
seven suites pass, static[]. Audit only; no product/credential/preference/scope/
live/build/install/release/index/branch changes. Actual changed UI and isolated
native/Host/mobile acceptance pending; installed inclusion unknown.

## Keybindings and shared focus/filter extension, 2026-10-27

Owner's four captures and explicit product-wide filter complaint are recorded in
`.agents/skills/feature-keybindings/SKILL.md`. Fourteen records (three V+S/eleven S),
18 families; register/brief under
`temp/local/2026-10-27-settings-keybindings-audit/`. Propose bounded shortcut
editing, one focus owner with visible recording/pending/error states, labelled
filters/terse help and scoped reset/query recovery. Preserve category/context,
conflict reservations, IME/cancel, native/global gates, pending and reset behavior.
Repair macOS Quick composer durable/external state, partial native outcomes and
localized errors. Shared filter plan covers10 representative desktop families
and native staged Apply; preserve per-feature count, selection, View and query
contracts. This does not claim all filters tested.99 existing tests/six suites
pass; schematic/source evidence only, actual changed UI/native/installed pending.
No app, live shortcuts, preference, index, branch, build/install/release change.

## Notifications and request-sheet extension, 2026-10-27

Owner's four captures and exact decision are in
`.agents/skills/feature-notifications/SKILL.md`. Eighteen records (three V+S/
fifteen S),22 families; register/brief under
`temp/local/2026-10-27-settings-notifications-audit/`. Propose bounded General/
Projects preferences with accurate channel/permission/schedule state, nearby
project identity/mute/detail and truthful selection/count/error scope. Request
sheet needs clearer pending versus retained question/approval history, stable
details, guarded source-open and local pending/error/clear recovery. Existing
project/sheet lists already bounded; no all-delivery/unread/resolved history is
invented. Preserve privacy, native/remote authority, mute/category/expiry/drafts,
popup lifecycle and separate phone/computer settings. Repair persistence/read,
permission cache, taskbar retry and summary durable/relock outcomes.161 existing
tests/20 suites pass with act warnings retained. Audit only; no product/live
setting/OS/approval/Host/index/branch/build/install/release change. Actual changed
UI/native/device/installed acceptance remains pending.

## Appearance management extension, 2026-10-27

Three owner lower-page captures; upper theme/reading/fonts also source-reviewed.
Card `.agents/skills/feature-appearance/SKILL.md`; register/brief under
`temp/local/2026-10-27-settings-appearance-audit/`.20 records (three V+S/seventeen S),
24 families. Propose bounded open topics and compact in-page navigation, nearby
control/value/reset, honest preview and visible light/platform dependencies.
Translucency already direct; keep dark values/light opaque policy and native
fallback. Clarify reset subsets; repair durable/read/native partial/worker/image/
project-blur/tab sibling outcomes without removing current guards/performance.
Ambient crew is separate from saved Crews.153 existing tests/16 suites pass with
Probe act warnings. Audit/design only; no app/live preference/image/crew/OS/Host/
index/branch/build/install/release change. Actual changed UI/native/font/GPU/
device/installed acceptance pending; inclusion unknown.

## General layout and management extension, 2026-10-27

One owner General capture; exact quote/full scope in
`.agents/skills/feature-general-settings/SKILL.md`.20 records (three V+S/seventeen S),
22 families; register/brief under
`temp/local/2026-10-27-settings-general-audit/`. Propose bounded preferences,
nearby lifecycle/power actions, compact support/diagnostics and clearer About/
version/update. Preserve language catalogs/epochs/drafts/domains, local power/
tray ownership and close protection, opt-in trace, import/setup/guide and build
receipts. Repair effective/durable/native/unknown/read/subscription feedback,
shared updater state and running/installed/restart outcomes. No redundant new
approval; existing updater authorization/feed gates stay.296 existing tests/17
suites pass with Diagnostics act warnings. Screenshot0.6.92/source unknown versus
current source0.6.94 leaves installed inclusion unknown. Audit only; no app/live
preference/OS/trace/clipboard/import/setup/guide/link/update/Host/index/branch/
build/install/release action. Actual new UI/native/device acceptance pending.

## H3 Settings reference implementation, 2026-10-28

Owner, conversation `55e5cc00-32d1-420a-ac03-bdb7f2a2af2d`, exact quote:

> bycoda Ayarlar ortak düzenini ve General referans sayfasını yeni tasarım anlayışımıza göre uygula.

Implemented locally on shared `main` (observed HEAD
`c03fa98d4819494a53ebfa61ff74320105bd05fc`), uncommitted:

- `SettingsView.tsx`: compact, density-aware titlebar, named category groups and
  shared Button alignment. Search/reveal, picker, keyboard controller, section
  lifecycle and update footer retain their existing owners.
- `settingsControls.tsx` / `BycodaSettings.css`: semantic Group/Row/PageHeader
  classes, one feature-owned presentation, visible scope/dependency, local Alert
  recovery. CSS imports with the facade for external consumers; each group owns
  its responsive container. Controls retain their shared visual APIs.
- `GeneralSettings.tsx` / `GeneralSettings.css`: independent preference/support
  tracks, explicit install/restart action and target-local link retry/copy.
  Other settings pages were not mass-migrated.

FND-SETTINGS / styling F1 remains REVIEW, not closed: the forbidden global
shadows at `src/styles/bycoda.css:80-87` and `src/styles/index.css:65-81` still
need coordinator/theme removal. Existing category pane surface/edge is retained.
The stronger feature selectors preserve intended precedence until that removal.
No Host/Rust/persistence/default or permission change was needed.

Test edilmedi: overnight RULES explicitly defer tests, servers and captures.
One final `pnpm check:web:fast` result, file fingerprints, complete surface
checklist, dependencies and morning checks are recorded in
`temp/local/2026-10-28-h3-settings-reference/handoff.json` and its README.
Native/mobile/installed inclusion remains unknown; no build/install/release.

## H3 Settings pages A implementation, 2026-10-28

Owner conversation `55e5cc00-32d1-420a-ac03-bdb7f2a2af2d`, exact quote:

> Az önce kurduğun Ayarlar referans düzenini (SettingsView, settingsControls, General) şu sayfalara uygula.

Appearance, Notifications, Keybindings, Privacy/security, Workspace, Terminal,
Source control and Archive now consume the reference Group/Row presentation.
`BycodaSettings.css` owns the `settings-topics` collection spacing contract;
page files own composition, not another Group/Row skin. The legacy equal-topic
subgrid no longer controls these pages. Individual cards and
`temp/local/2026-10-28-settings-pages-a/handoff.json` record delivered behavior,
per-ID dependencies, source identity and the morning acceptance checklist.

Root integrates scoped `settings.ts` subscriptions/write outcomes/search anchors;
the Appearance worker owns applied/durable outcomes and previews. Other workers
own personal settings and workspace-related settings pages. H1/H4/H5 source
boundaries remain; their repository policy, privacy/lock and history-state work
is not claimed as delivered by a settings-only edit.

Test edilmedi per overnight RULES. Only one direct fast compiler run is recorded
in the packet; `check:web:fast` includes tests and is deliberately not invoked.
All items are at most REVIEW. No native/device/installed or release acceptance.
