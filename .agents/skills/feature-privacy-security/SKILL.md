---
name: feature-privacy-security
description: "Use when changing privacy launch, group lock and hidden groups, and native file-access consent. Not for remote file authority; see feature-host-runtime."
---

# Privacy and security settings development

Use for privacy/masking preferences, password/lock options, hidden-group management and local file-access Settings. Remote Hosts own their own file permissions; this does not define cryptographic or penetration-test acceptance. UI privacy is not disk encryption.

## Source starts

- `src/features/settings/ui/PrivacyStartupSettings.tsx`, `src/features/settings/ui/FileAccessSettings.tsx` and `src/features/group-lock/ui/` own the user-facing controls.
- `src/features/group-lock/model/` owns password/lock/attempt state; `src/platform/tauri/fileAccess.ts` bridges local native consent.
- Read [surfaces](references/surfaces.md) for consumers, native operations and focused checks.

## Preserve

- Privacy launch hides the workspace before private children mount; Continue/password/cancel retain their existing scope across main/Quick composer entry points.
- Email masking/reveal state and same-/sibling updates remain independent of project lock or permission authority.
- Protected configuration, currently locked state, hidden-group listing authorization and actual project unlock are distinct. Do not reveal concealed names/counts before authorization.
- Temporary restore is scoped to its actual group and ends under existing restart/Lock all rules; unlock-together and conceal-management controls must not broaden it.
- Preserve password validation, explicit remove/reset consequences, cooldown, durable-write requirements and fingerprint revalidation across concurrent completion.
- Unavailable/corrupt reads must not become no-password/empty/unprotected success. Keep drafts, pending ownership and recovery after partial write or dismissed dialogs.
- Native file access remains local consent with canonical/private/path guards. Read-only Refresh differs from consent; preserve known/unknown outcome and readback after uncertain writes.
- Native grant and access-mode writes sync before publication. Corrupt local files retain unique recovery evidence and reopen without deriving consent from their bytes; valid independent consent remains authoritative. I/O or quarantine failures stay explicit, and fresh access still requires the existing owner chooser/consent flow.
- UI privacy does not encrypt files or stop background work; restyling grants no new Host/file/auth authority. Cached downstream summaries must apply current lock/visibility policy.

## Workflow

1. Trace changed privacy state through startup, rail/search/task/notification consumers and the actual lock/file-access authority.
2. Reuse shared password/confirmation/overlay controls. Keep unknown access disabled where the source contract requires freshness rather than guessing from last-known state.
3. Use focused lock/password/settings/native tests from the map and fake stores for mutation cases; exercise cooldown, simultaneous results, relock, hidden recovery, native cancellation/partial write and current tier UI checks.

## Focused checks

Select the affected model, UI and native suites from the surface map.

## References

- Read [surfaces](references/surfaces.md) for storage/consent consumers and test entry points.
- Read [project privacy guide](../../../docs/guides/project-privacy.md) for user-facing concepts; verify navigation against the current UI before editing its instructions.
