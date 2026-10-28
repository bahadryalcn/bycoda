---
name: feature-privacy-security
description: Privacy and security Settings inventory for launch privacy, email masking, native file access, lock password and reset, automatic locking, visible protection versus current lock state, concealed hidden groups/recovery and persistence/race outcomes. Read before redesigning these UI privacy controls; no disk-encryption claim.
---

# Privacy and security Settings

Purpose: understand and manage app privacy, group protection and local file grants
without lost state, misleading success or concealed-data leaks. Keywords: Privacy
and security, privacy launch, email masking, file access, password, forgot/reset,
lock on startup/idle, unlock together, protected/hidden groups, temporary restore.
UI/behavior inventory, not crypto/penetration-test or disk-encryption acceptance.

T2 audit2026-10-27: dirty shared main d8bf868fae841b8b391ce148487cd7d373ea9762.
20 root source hashes match HEAD; scoped history3419af022/0a6973a21/1459c3ab0/
3f4a417c6/d34c7b582. Two capture/installed inclusion unknown. Three native
read-only reviews plus root; live claims unavailable, available session/Git state
inspected, no reservation. Preserve staged/shared source/Host/mobile work. Root
owns audit documents only. Read feature-settings/projects/workbench-design and
Arc/shared control references plus docs/guides/project-privacy.md.

## Surface inventory

Full16-family checklist and12 records (two V+S/ten S):
`temp/local/2026-10-27-settings-privacy-audit/AUDIT.md`; adjacent REDESIGN.md.
Evidence: `temp/verification/2026-10-27-settings-privacy-audit/`.

- Desktop Settings: PrivacyStartupSettings.tsx, FileAccessSettings.tsx,
  SettingsView.tsx/settingsControls.tsx/model settings.ts; group-lock UI
  GroupLockSettings.tsx, GroupPrivacy.css, HiddenGroupsSettings.tsx,
  SetLockPasswordDialog.tsx, PasswordPromptDialog.tsx, ForgotLockPasswordDialog.tsx,
  UnlockGroupDialog.tsx and PrivacyLaunchGate.tsx.
- State: group-lock/model groupLock.ts, lockSettings.ts, lockState.ts,
  passwordRecord.ts, attemptThrottle.ts/autoLock.ts; useGroupLock hook,
  projects/model/projectGroups.ts; settings/model/displayPrefs.ts and
  shared/ui/PrivateEmail.tsx. Retain storage/BroadcastChannel/race guards.
- Entry/consumer: main.tsx, quick-composer/main.tsx and before-paint
  app/workspace/lifecycle/useProjectLockRedirect.ts; project rail/search/recents/
  work/draft consumers. Group hiding/protection retains membership/jobs/tabs.
- Native: platform/tauri/fileAccess.ts, `src-tauri/src/file_access.rs` and
  `src-tauri/src/lib.rs`;
  get_file_access_mode, configure_file_access, authorize_project_path,
  revoke_file_access. Local native consent only, not remote Host approval.
  File-status errors already fail closed; canonical/private/read-write guards stay.
- Host/mobile: local UI privacy is no Host grant. Remote Hosts own file access.
  Mobile provider-consent/session privacy/cache modules exist separately; desktop
  password/hidden-group Settings parity not established. No device/live proof.
- Shared UI/locales/search: Group/Row/Switch/Select/Button/PasswordField,
  Modal/Popover and feedback. IDs include start-in-privacy-mode, mask-emails,
  file-access/permissions, group-lock-password/options/startup/idle/unlock-together;
  textual en/tr families include Locked/Unlocked/Not protected, Set/Change/Remove
  password, Forgot password, Show temporarily/Make visible/Conceal names.
- Tests: PasswordDialogs, HiddenGroupsSettings, PrivacyLaunchGate; groupLock.race,
  lockSettings, autoLock, hiddenGroups, attemptThrottle; projectGroups,
  FileAccessSettings, displayPrefs. Related PrivateEmail/fileAccess adapter/native
  and browser settings.html/settings.e2e.ts tests remain separately exercisable.

## Owner decision

2026-10-27, conversation0567326f-aade-4baa-89f3-b44c6256ae9e, two captures:

> privacy and security ekranlarıda aynı şekilde yerleşimleri filan çok kötü durumda bunlarında toparlanması gerekiyor.

Audit/design requested. No permission/default, password/crypto policy, hidden
visibility or real file/lock operation selected. Preserve existing named Settings
hidden-group recovery and startup privacy scope; historical references are clues,
current source is authority.

## Preservation and proposed repairs

Propose bounded deliberate privacy/file and password/locking topics, nearby actions,
clear visible-group count and separate protection configuration/current lock state.
Normal group list already bounded360px; authorized hidden collection needs its own
bounded search/recovery. Keep concealed names/count absent before authorization
when a password exists; preserve no-password recovery. Listing hidden names does
not unlock a project. Temporary restore is one group even with unlock-together;
restart/Lock all ends it. Conceal names revokes management-list auth only.

Repair unavailable reads versus empty/no-password truth, protection save results,
partial password remove/reset, next-launch/auto-lock durable outcomes, pending
dialog dismissal, cooldown i18n and file-status read-only retry/read-back. Native
consent is currently two-result all-files/selected-folders, not a distinct no-change
Cancel; validate any new outcome through typed/native contracts. Broad-access help
must reflect read/edit, while selected grants may be read-only. No exploit claimed.

Keep password setup/change required durable save, current validation/masked fields,
shared cooldown, privacy/password/group fingerprint revalidation and simultaneous
completion safeguards. Current auto-lock defaults startup true/idle off/unlock
together false. Remove protection/reset differs from deleting projects; preserve
projects/hidden preferences and explicit password/reset phrase. UI privacy does
not encrypt files. Do not silently alter auth/write gates for compactness.

Mask-email state already has memory fallback plus same-/sibling-window updates;
reveal resets when masking changes. Privacy launch snapshots window state and
does not mount private children before Continue/password success; Cancel keeps
workspace hidden across main/quick entrypoints. Native file access serializes
consent, persists before memory and blocks private/canonical/traversal violations.
No generic missing-subscription/fail-open finding applies to these stronger paths.

## Checks and handoff

68 existing tests/11 suites pass; static five-file scan[]. New repairs and actual
changed app light/dark1280/800/narrow/zoom/locales/keyboard/reader/reduced motion
remain pending. Fake-store mutation, isolated native consent/dismissal/path checks,
startup entry/native/mobile/Host and installed-source inclusion require separate
acceptance; no live state or credential/permission experiment ran. Schematic
light728/dark390 captures are design only, generic names/no secrets.

Audit/design ready, implementation pending. No source/app/password/group/file/
consent/Host/index/branch/build/install/release/commit change delivered. Baseline
is context, not committed product work. Update guide/commit evidence when actual
behavior ships; do not treat old fixture/native inventories as current acceptance.

## Notifications cached-summary dependency, 2026-10-27

`temp/local/2026-10-27-settings-notifications-audit/`, record NTF-14, identifies
a separate source acceptance risk: daily-summary gather filters current locks,
but cached/fresh Tasks summary rendering does not re-filter on relock and lacks
retained project access identity. Ordinary task lists and the request center's
locked/hidden redaction already apply current policy; preserve those guards.
Repair summary restore/read/render/relock through Tasks/notification owners,
with private-safe migration/recovery. No owner-data exposure was demonstrated;
no real project/lock/summary was operated. See feature-notifications for scope,
source anchors and unverified native/cache/privacy acceptance.

## H3 Settings pages A implementation, 2026-10-28

PrivacyStartupSettings keeps the existing launch/masking state and callbacks and
adds explicit local-computer scope/full Group layout. FileAccessSettings now
separates read-only Refresh/Retry from native consent, refreshes on window focus,
serializes duplicate requests and reads back permissions after configure failure
because native writes may have completed before a later error. Unknown status
keeps consent changes disabled until refresh while labeling last-known access.
Optional file scope/help is disclosed and remains searchable/revealable. Broad
access help now states read/edit; selected-folder grants may be read-only and
agent command/tool approval stays separate. No third Cancel/no-change native
consent outcome is implied.

Files: settings/ui/PrivacyStartupSettings.tsx, FileAccessSettings.tsx and its
regression test source. **test edilmedi** under the owner night rule; no compiler,
native dialog, password, owner setting or file-access operation was run by this
writer. Root owns final compiler integration. PS-10/12 are proposed REVIEW;
PS-11 retains its native acceptance boundary. H1 still owns GroupPrivacy.css's
old page tracks/Group/Row skins and PS-02..09 group-lock/password/concealed-data/
durability/cooldown repairs. H3 does not claim those are fixed or tested.
Full per-ID dependencies and morning checks:
`temp/local/2026-10-28-settings-pages-a/personal.json`.
