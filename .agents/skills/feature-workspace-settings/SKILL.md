---
name: feature-workspace-settings
description: Workspace Settings inventory for layout, file tabs, Explorer excluded files, Autosave/formatting, tool visibility and Notes context, Working agents, macOS Quick composer and local-Host Exact Git rewind. Read before changing this app-preference page; distinct from managed execution-workspace policy.
---

# Workspace application settings

Purpose: organize app-wide navigation/editor preferences with honest state and
clear local-Host experimental scope. Keywords: Workspace Settings, File tabs,
Beside chat, Top bar, Explorer, excluded files, Autosave, Format on save, Tasks,
Automations, Inbox, Notes, Social, Working agents, Quick composer, Exact Git rewind.
This is not Source Control managed-workspace/directory policy.

T2 audit baseline2026-10-27: dirty shared main
d8bf868fae841b8b391ce148487cd7d373ea9762.18 inspected hashes match HEAD. Scoped
history a6f739274/29d534f9f/3419af022/395e2b491. One owner capture has unknown
installed/source inclusion; current source includes Exact Git rewind absent in
capture, not a new missing-control finding. Two native read-only reviews plus
root; claims unavailable, available Git/session context inspected, no reservation.
Preserve staged/shared source/Host/mobile work. Root writes only audit documents.

## Surface inventory

Full14-family checklist/8 findings (one V+S/seven S):
`temp/local/2026-10-27-settings-workspace-audit/AUDIT.md`; adjacent REDESIGN.md is
the proposal. Evidence under `temp/verification/2026-10-27-settings-workspace-audit/`.
Read feature-settings/workbench-design/notes/managed-workspaces and Arc/shared
design references; prior feature-specific audits remain separate.

- Desktop: `src/features/settings/ui/WorkspaceSettings.tsx`/.css,
  WorkspaceFeatureSettings.tsx, WorkspaceFeatureGate.tsx, WorkspaceEditorSettings.tsx,
  SettingsView.tsx, BycodaSettings.css and settingsControls.tsx. Shared topic grid
  uses auto-fit/subgrid; it causes the sparse equal-column composition.
- Models: settings.ts, appearance.ts, workspaceFeatures.ts, exactGitRewind.ts,
  useAppearanceSettings.tsx and shared storedSetting/useStoredPreferenceState.
  Search IDs: file-tabs, show-excluded-files, auto-save, format-on-save,
  working-agents, quick-composer, exact-git-rewind, notes and workspace tool IDs.
- Files/editor: FileTree.tsx, fileTree.ts, CodeMirrorEditor.tsx, FileEditor.tsx,
  editorTiming.ts and app useEditorFileOpen.ts; preserve dirty/conflict/save state.
- Tool consumers: Sidebar/ProjectRail, WorkspaceToolPanels, useAppUiControl,
  onboarding, SocialShortcut, Composer/AgentTabView/useSessionHousekeeping and
  useSessionStatusSets/useIdleSessionDetach. Active-hidden reachability is intended.
- Native/Host: ordinary prefs have no Host permission mutation. Quick composer
  registers native macOS shortcuts. exactGitRewind model calls local_host_connect
  and workspaces.exactGitRewind.get/set on this computer's Host; host
  exact-git-rewind/managed runtime retains owner/running-turn gates and default off.
  Do not retarget to selected remote Host or reintroduce automatic per-turn capture.
- Mobile: no shared desktop WorkspacePage parity established by scoped search;
  separate mobile/device acceptance is required, not a copied desktop grid.
- Shared UI/locales/checks: Group/Row/Toggle(shared Switch)/Segmented/Button,
  existing help Popover and feedback; en.json/tr.json/tr-overrides.json textual
  keys above. Tests: WorkspaceSettings.test, WorkspaceEditorSettings.test,
  workspaceFeatures.test, exactGitRewind.test, FileEditorSave.test,
  CodeMirrorEditor.format.test; settings.e2e.ts/settings-subviews.e2e.ts fixtures.

## Owner decision

2026-10-27, conversation0567326f-aade-4baa-89f3-b44c6256ae9e, one screenshot:

> bu ekranında yerleşimi filan çok kötü durumda bunlarında toparlanması gerekiyor.

This continues audit/design; no defaults/group names/visibility, Autosave, Notes,
Host experiment, file permissions or execution policy changed by the owner.

## Preservation and proposals

Propose bounded deliberate file/editor and navigation groups, one ordered narrow
column and separate local-Host experiment scope. Preserve every control, including
source-present Exact Git rewind and macOS-only Quick composer absent from image.
Existing tools are not service-stop controls. Hiding Tasks/Automations/Inbox/Social
retains active views/work/direct entry; Notes additionally affects Notes/composer/
save-note UI. No note deletion/draft loss established. Working agents affects
rail/idle retention, with busy work retained and detached idle sessions persisted.

Keep defaults: File tabs pane, Autosave off, Format on save on, Working agents on,
Show excluded off, tools visible. Saved screenshot choices are not new defaults.
File-tab mode governs future ordinary opens, not deletion/rewrite of current tabs.
Autosave can save already-dirty buffers; Format applies to manual and automatic
save. Preserve newer-edit/generation/disk-conflict/serialized-write protections,
dirty retry and manual formatting/undo. No extra confirmation is implied.

Repair Notes sibling sync, File tabs/Format mount snapshots, Explorer Settings/
sibling sync and affected-control preference-outcome recovery. Link the existing
shared storage dependency rather than recounting one global bug per row. Preserve
strong Autosave read-back/subscription, Working agents/four-tool subscriptions,
Host acknowledgement/error/retry/unknown-disable, native shortcut saved-intent
recovery and ordinary execution fallback when the experiment is unavailable.
No synchronous local preference needs fabricated async state or new permissions.

## Checks and handoff

35 existing tests/six suites pass; static four-file scan[]. New sibling/storage/
layout/consequence repairs not implemented/tested. Actual changed UI all controls
light/dark1280/800, narrow/zoom/keyboard/reader/reduced motion, isolated Host,
macOS shortcut/native/mobile and installed checks remain pending because no app/
device run or product patch occurred. Diagram light728/dark390 is schematic only.

Audit/design ready; no app/preference/file/task/agent/note/Host/index/branch/build/
install/release or commit changed. Baseline is context, not committed delivery.
Update user guides and commit references when actual behavior is delivered.

## H3 Settings implementation, 2026-10-28 (uncommitted)

WorkspacePage now orders files/Explorer/editor, navigation tools/Working agents,
macOS entry and this-computer experimental settings without equal stretched topic
tracks. Notes consequences and Autosave's existing-dirty-buffer effect are visible.
File-tab/format and Notes models subscribe to same/sibling changes; mounted
controls read back synchronous saves and keep a local failure beside the setting.
Quick-composer saved intent and native-registration error remain distinct.
Shared Settings controls own row geometry; no editor, workspace lifecycle or Host
operation was changed here. WS-01..08 evidence/dependencies are in
`temp/local/2026-10-28-settings-pages-a/workspace.json`.

Test edilmedi: nightly owner rule forbids tests, fixtures, servers and captures.
Morning acceptance includes both themes/1280/800/narrow/density/keyboard, sibling
preference events, storage failures, dirty-editor Autosave and macOS registration.
Build/install/release and installed inclusion remain unverified.
