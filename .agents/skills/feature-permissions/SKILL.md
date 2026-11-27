---
name: feature-permissions
description: Use when changing OS permission status, setup dialogs and the macOS Finder handoff. Not for feature enable switches; see feature-settings.
---

# System permissions

Owns OS permission presentation under `src/features/permissions/`, the typed platform bridge and native probes under `src-tauri/src/system_permissions/`. Host desktop-control readiness belongs to the helper process and is a separate fact.

## Source starts

- `src/features/permissions/index.ts`: public rows, setup dialog and status hook.
- `src/platform/tauri/systemPermissions.ts`: native report and command contract.
- `src-tauri/src/system_permissions/`: platform probes, explicit requests, the macOS companion card and app reveal in Finder.

## Workflow

1. Trace permission consumers and the native probe for the affected OS.
2. Preserve separate owner enable, OS/helper readiness and running state.
3. Update setup instructions and every affected consumer together.
4. Run focused model/hook tests, locale, compiler and UI drift checks.

## Preserve

- Opening a page only reads status. Only owner clicks can request access.
- Unknown and failed reads never imply access. Clear stale grants after failures.
- Helper permissions belong to its own process; app grants do not establish helper grants.
- Every `usePermissionStatus` consumer shares one report store (`hooks/permissionStatusStore.ts`): one focus listener, focus reads join a current read, and only an explicit `refresh` always reads again.
- macOS Screen Recording and Full Disk Access reach a running app only after a restart. Entry `detail: "restart-required"` means the OS switch is on but this process lacks it; the UI offers a restart, never "allowed".
- Poll only while a setup dialog is open.
- The macOS card only docks outside System Settings. The setup dialog keeps a Finder action for windows with no room for the card.
- Native drag starts only from the active card and carries the running app bundle. The webview supplies no file path. Click or a failed drag reveals the bundle in Finder.
- A webview refusal after a native microphone grant needs capture retry, not an OS settings redirect.
- Keep stable capture and elevated-target error codes intact.

## Focused checks

`pnpm exec vitest run src/features/permissions` covers model and status transitions. Also run the touched voice, quick-composer and settings tests, `pnpm check:locales`, `pnpm check:compiler`, and `node scripts/checks/check-feature-skills.mjs`.

## References

- [Voice guide](../../../docs/guides/voice.md): owner-facing setup and recovery.
- [Settings](../feature-settings/SKILL.md): navigation and three-state presentation.
- [Shared UI](../feature-shared-ui/SKILL.md): controls and overlays.
