---
name: feature-general-settings
description: General Settings inventory for application/Git/technical language, Windows close-to-tray, local keep-awake/screen/hold policy, support/import/setup/guide entrypoints, opt-in diagnostic trace, About/build identity and guarded updater states/recovery.
---

# General Settings

## Purpose and coordination

Make everyday app preferences and support/version actions understandable without
changing power, language, trace or update authority. Keywords: General, language,
Git/technical interface, close to tray, sleep/keep awake, display/hold duration,
setup/import/guide, diagnostics/performance trace, About/version/build identity,
what's new, update/download/install/restart.

2026-10-27 main d8bf868fae841b8b391ce148487cd7d373ea9762. T2 audit/design only:
20 records (three V+S/seventeen S),22 families. One owner screenshot shows0.6.92/
source unknown; current source package0.6.94 does not establish installed
inclusion. Root writes documents; three native read-only agents inspect language,
power/tray and support/update. Claims API unavailable; available session/worktree
context consulted. Card is not a reservation. Preserve concurrent native/catalog/
mobile work; evidence marks dirty sources snapshot-only.

Search roots: src/features/settings, src/shared, src/app/model,
src/app/workspace, src/features/onboarding, src/features/sessions/import,
src/features/sessions/ui,
src-tauri, tests/browser and current mobile settings/state. Identifiers:
GeneralPage, LanguageSettings, keepAwake, closeToTray, DiagnosticsGroup,
UpdateRow, BuildIdentityDetails, OPEN_SESSION_IMPORT_EVENT, OPEN_ONBOARDING_EVENT,
native_language_set, set_keep_awake, build_identity.

Package Host-check scripts/TLS dependencies are also concurrent snapshot-only
work; the0.6.94 version field is source context, not installed-build proof.

## Surface inventory

- Page/layout/action owners: `src/features/settings/ui/GeneralSettings.tsx`,
  `GeneralSettings.css`; shared grid `BycodaSettings.css`; route
  `src/features/settings/ui/SettingsView.tsx`; index/default/storage ownership
  `src/features/settings/model/settings.ts`.
- Three language selectors `src/features/settings/ui/LanguageSettings.tsx`;
  `src/shared/i18n/index.ts`, `languages.ts`, `git.ts`, `technical.ts`, catalogs.
  Nine fixed choices each; current implementation uses shared Select, not the
  SearchableSelect from an older worktree review. Native menu owner
  `src-tauri/src/native_language.rs`, command native_language_set registered in
  `src-tauri/src/lib.rs:886`. Native menus follow app locale. No new Host RPC/tool.
- Technical-scope consumers: `src/features/terminal/ui/TerminalTools.tsx`,
  `src/features/files/ui/FileEditor.tsx`, `CodeMirrorEditor.tsx`.
- Power controller `src/features/settings/model/keepAwake.ts`; native
  `src-tauri/src/keep_awake.rs`, command set_keep_awake `{enabled,display}`,
  registration `src-tauri/src/lib.rs:541`. Local window-owned claims, not a
  remote-Host/phone power setting.
- Tray/window lifecycle `src/app/workspace/sessions/useSessionPersistenceFlush.ts`,
  `src/app/model/appLifecycle.ts`, `traySessions.ts`, `useTraySessions.ts`,
  native `src-tauri/src/tray.rs` and lib cleanup. Close-to-tray preference is
  Windows-only; tray existence includes macOS/Linux. Preserve close protections.
- Support entry owners `src/features/sessions/ui/SessionImportHost.tsx`,
  `src/features/sessions/import/importModel.ts`; `src/features/onboarding/ui/OnboardingHost.tsx`,
  `GuideHub.tsx`, model `onboarding.ts`, `usageGuide.ts`; guide reveal
  `src/app/workspace/surfaces/useSurfaceOpeners.ts`. Entry/reveal scope only,
  not exhaustive import/onboarding/Host acceptance.
- Diagnostics `src/features/settings/ui/DiagnosticsSettings.tsx`;
  `src/shared/lib/performanceTrace.ts`, `performanceTraceSettings.ts`, storedSetting.
  Local clipboard owner `src/platform/tauri/clipboard.ts`; no upload operation.
- About/version `GeneralSettings.tsx` UpdateRow/ProductDetails;
  `src/features/settings/ui/BuildIdentityDetails.tsx`,
  `src/shared/model/build-info.ts`; native build_identity
  `src-tauri/src/build_info.rs:5`, registration `src-tauri/src/lib.rs:424`.
- Updater `src/app/model/updater.ts` and its configuration contract tests, product identity
  `src/shared/lib/productIdentity.ts`; existing Tauri app/dialog/updater/process
  owners and official-build gating. No check/download/install/restart executed.
- Shared Button/Toggle/Select/MorphSelect/Progress, Settings Row/Group/Feedback,
  existing Popover/Modal/overlay and native popup/zoom routing remain owners.
- Phone language has independent authority despite shared catalogs:
  `mobile/src/features/settings/settings-screen.tsx`, `mobile/src/state/machines.ts`.
  Desktop sleep/tray/updater controls are not phone settings. Mobile source
  boundary only; no matching computer power controls located in searched scope.
- Copy families: Language/System/Follow application, local Sleep/after work/screen,
  Close to tray, Import/Open setup/Guide, trace enabled/copy/clear, version/source
  unknown/build details, update phases and restart, developer/website/contact.
- Fresh checked17 suites are named in EVIDENCE.md: i18n/build-info, Settings
  build/diagnostics/keep-awake/flags, trace/settings, updater/config/tray hooks,
  OnboardingHost/GuideHub/onboarding and import model/control. Existing browser
  `tests/browser/settings.e2e.ts:75`, broader locale loops375 and layout fixture
  were inspected, not run. Unit mocks are not actual OS/update acceptance.

## Owner decision

2026-10-27 conversation0567326f-aade-4baa-89f3-b44c6256ae9e, exact quote:

> bu ekranda daha iyi yerleşim ve görünüme sahip olabilir burayıda toparlıyabiliriz.

This continues staged audit/design. No locale/default, power/trace behavior,
product identity or update authority is selected/changed.

## Behavior to preserve

App follows system by default; Git/technical independently default English. Keep
IDs, nine valid choices, original code/user/OS content, catalog caching/retry/
generation guards, same/sibling/system changes and draft-preserving rerender.
Native language/durable outcome need separate truth; do not replace all terminal
labels mechanically to satisfy the technical-language description.

Windows close-to-tray default on; keep-awake/screen defaults off; six hold values
immediate/15m/30m/1h/4h/forever default immediate. Master off retains dependent
choices. Saved intent is not proof active native inhibition. Preserve working/
input-wait/removed-worktree classification, serialized transitions, window OR
claims/replacement-before-release, hold/recompute/cleanup and strict close gates.
Local-computer scope and platform caveats remain; no forced Sleep/remote control.

Import opens candidate dialog; Setup/GuideHub/optional tour keep independent
dismissal and file-access recovery/reveal. Diagnostics opt-in off, window-local
2048 bounded timing records, safe allowlists/IDs, no prompt/path/script contents;
off retains records. Copy guard/focus/retry and explicit Clear; repair stale
feedback and durable/subscription state without adding upload.

Keep renderer/native stamp receipts and Unknown comparison; included-source
requires proper clean identity, not equal version/time. Updater feed is official
com.bycoda.desktop only, fails closed for unknown/fork/dev, coalesces checks/
installs, preserves unknown-size progress, current explicit install authorization,
quiet automatic missing-feed behavior and installed/manual-restart recovery.
Running versus installed version remains distinct. Preserve product attribution,
visible website/contact and local loading/error recovery.

## Proposals and acceptance

Bounded balanced preference tracks, related lifecycle/power controls, compact
support actions/subordinate diagnostics and a clear version/update/reference row.
Keep scope/dependency/active/error/retry visible; preserve useful build disclosure.
Repair effective/durable/read/fallback outcomes, native language/power state,
diagnostic operation feedback, shared updater snapshot and restart identity.

Full20-record/22-family checklist and brief:
`temp/local/2026-10-27-settings-general-audit/AUDIT.md`,
`temp/local/2026-10-27-settings-general-audit/REDESIGN.md`; main plan AB.
Evidence/logs/provenance/schematic:
`temp/verification/2026-10-27-settings-general-audit/`.

296 existing tests/17 suites pass with Diagnostics act-environment warnings.
Actual changed UI1280/800 light/dark,390/long locales/zoom/coarse pointer/keyboard/
reader/forced colors/reduced motion; native menu/power/tray/clipboard/link/version/
stamp/import/setup/guide; real updater feed/download/install/restart; phone/device
and installed-source inclusion remain UNVERIFIED: no app patch/native/device or
live operation. Feature/platform/authorized update owners own those checks with
isolated data. Update user guides when behavior changes.

Audit/design ready locally, uncommitted. Baseline is source identity, not a
delivered fix; installed inclusion UNKNOWN. No setting/language/OS/trace/import/
setup/guide/link/update/native/Host/index/branch/build/install/release change.
