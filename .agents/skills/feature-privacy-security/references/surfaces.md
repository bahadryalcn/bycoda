# Privacy and security surfaces

Code paths are repository-relative.

| Area | Owner |
| --- | --- |
| Privacy/masking/file controls | `src/features/settings/ui/PrivacyStartupSettings.tsx`, `FileAccessSettings.tsx`; Settings model/search and `displayPrefs.ts` |
| Lock/hidden/password UI | `src/features/group-lock/ui/GroupLockSettings.tsx`, `HiddenGroupsSettings.tsx`, `GroupPrivacy.css`, `SetLockPasswordDialog.tsx`, `PasswordPromptDialog.tsx`, `ForgotLockPasswordDialog.tsx`, `UnlockGroupDialog.tsx`, `PrivacyLaunchGate.tsx` |
| Lock state and races | `src/features/group-lock/model/groupLock.ts`, `lockSettings.ts`, `lockState.ts`, `passwordRecord.ts`, `attemptThrottle.ts`, `autoLock.ts`; follow `useGroupLock` |
| Membership/masking | `src/features/projects/model/projectGroups.ts`; `src/shared/ui/PrivateEmail.tsx` |
| Startup/consumer access | `src/main.tsx`; Quick composer entry; `src/app/workspace/lifecycle/useProjectLockRedirect.ts`; rail/search/recents/task/draft consumers |
| Native file grants | `src/platform/tauri/fileAccess.ts`; `src-tauri/src/file_access.rs`; registration in `src-tauri/src/lib.rs` |

## State and consent boundaries

- Native operations: `get_file_access_mode`, `configure_file_access`, `authorize_project_path`, `revoke_file_access`. Preserve typed outcome semantics; do not invent a no-change Cancel distinct from the native result contract.
- Broad access and selected-folder grants have different read/write consequences. Unknown bridge output is not a new permission grant; serial requests, fresh status and durable readback retain their own guards.
- Local UI privacy/file grants do not change remote Host permission. Mobile provider/session privacy/cache is separately owned; desktop password/hidden-group parity requires actual route/contracts.
- Hidden-group management access does not unlock projects. Password removal/reset preserves project data and hidden preferences, with its explicit phrase/confirmation; retain cross-window fingerprint/cooldown protections.
- Cached daily summaries are a cross-feature consumer: follow the Tasks/Notifications owner for current-access filtering on restore/read/render/relock. Do not infer all consumers are safe solely from rail filtering.
- Reveal IDs include startup privacy, mask-emails, file access and group-lock password/options/startup/idle/unlock-together. Preserve source translation calls and accessible private-state labels.

## Focused checks

Select PasswordDialogs, HiddenGroupsSettings, PrivacyLaunchGate, groupLock.race, lockSettings/lockState, hiddenGroups, attemptThrottle/autoLock, projectGroups, FileAccessSettings and displayPrefs tests as affected. Native consent/path validation requires the Rust/adapter tests and isolated OS runs; browser Settings fixtures cover layout only.

Cover no-password and password startup, cancellation keeping private children hidden, relock and simultaneous password operations, unreadable state, partial reset/remove, cooldown localization, authorized hidden search/temporary restore, masked reveal reset, file-status retry and uncertain configure readback. Use fake stores and paths; do not exercise real owner passwords/permissions for presentation checks.
