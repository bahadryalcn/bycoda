# General Settings surfaces

All source paths are repository-relative.

| Area                  | Starting points                                                                                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| General layout/search | `src/features/settings/ui/GeneralSettings.tsx`, `GeneralSettings.css`, `SettingsView.tsx`; model `settings.ts`                                                                   |
| Language              | `src/features/settings/ui/LanguageSettings.tsx`; `src/shared/i18n/index.ts`, `languages.ts`, `git.ts`, `technical.ts`                                                            |
| Power/tray/lifecycle  | `src/features/settings/model/keepAwake.ts`; `src/app/model/appLifecycle.ts`, `traySessions.ts`, `useTraySessions.ts`; `src/app/workspace/sessions/useSessionPersistenceFlush.ts` |
| Diagnostics           | `src/features/settings/ui/DiagnosticsSettings.tsx`; `src/shared/lib/performanceTrace.ts`, `performanceTraceSettings.ts`; `src/platform/tauri/clipboard.ts`                       |
| Version/update        | `src/features/settings/ui/BuildIdentityDetails.tsx`; `src/shared/model/build-info.ts`; `src/app/model/updater.ts`; `src/shared/lib/productIdentity.ts`                           |
| Support entry points  | `src/features/sessions/ui/SessionImportHost.tsx`; `src/features/onboarding/ui/OnboardingHost.tsx`, `GuideHub.tsx`; `src/app/workspace/surfaces/useSurfaceOpeners.ts`             |

## Native and scope

- `native_language_set`: `src-tauri/src/native_language.rs`; menus follow app locale. Preserve independent Git/technical scope and platform-provided content.
- `set_keep_awake` with enabled/display intent: `src-tauri/src/keep_awake.rs`; tray behavior: `src-tauri/src/tray.rs`; registrations/cleanup: `src-tauri/src/lib.rs`.
- `build_identity`: `src-tauri/src/build_info.rs` and registration in `lib.rs`; do not equate a renderer-only stamp with the running native package.
- Power choices are local-computer/window-owned; no remote Host/phone power control follows from the Settings page. Mobile language/Settings state is separately owned in `mobile/src/features/settings/` and `mobile/src/state/machines.ts`.
- Diagnostics use the existing bounded trace/allowlist contract, not content/path capture or an upload channel. Copy and Clear have their own permissions and outcome feedback.
- Updater behavior and packaging/install coordination are documented in `docs/local-update.md`; inspect product/feed configuration before any owner-authorized update workflow.

## Focused checks

Select changed-owner tests: keepAwake, language/i18n, settings flags/storage, DiagnosticsSettings and trace settings, BuildIdentityDetails/build-info, updater/configuration, tray/lifecycle and relevant support-entry hooks. Browser settings/layout scenarios verify presentation only.

Exercise master-off retained values, pending/failure/retry, sibling locale updates, late callbacks after navigation, unknown build identity and manual restart recovery. Native menu, Windows tray, multi-window power claims, clipboard/opener and a real updater feed/install require their actual platform boundary; none is established by mock or fixture rendering.
