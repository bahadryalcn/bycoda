---
name: feature-servers
description: "Change Servers catalog, SSH forms/identity, details, terminal tabs and saved-tab restore while preserving trust, drafts, explicit connects and terminal lifecycle gates."
---

# Servers and SSH changes

## When and scope

Use for saved SSH targets and their terminal workspace. A saved target, connected Host machine and running SSH terminal represent different state. PTY execution and shared tools have separate owners.

## Source starts

Full paths are repository-root relative; adjacent abbreviated names share the preceding
directory. Follow current imports and callers; this map is not a completeness claim.

- `src/features/connections/ui/ServersView.tsx`, `ServersWorkspaceView.tsx`, `ServersConnectionTools.tsx`: catalog and purpose navigation.
- `src/features/connections/ui/QuickConnect.tsx`, `SshServerEditor.tsx`, `SshIdentityField.tsx`, `SshSettings.tsx`: configuration and trust/identity.
- `src/features/connections/ui/ServersTerminalWorkspace.tsx` and restore controls: tabs, focus and explicit reconnect.
- `src/features/connections/model/serverInventory.ts`, `serverTerminalRestoreState.ts`, `src/features/terminal/model/terminalClose.ts`: state and lifetime boundaries.

## Preserve

- Do not infer health from a saved entry, terminal existence or failed read. Machine connectivity and SSH capability remain distinct.
- Keep free group/tag/name entry, optional ephemeral names, search/selection/filter persistence and unsaved form drafts across purpose navigation.
- Retain identity cancellation, trust/configuration review, explicit submits, permission gates and duplicate-operation guards.
- Terminal close checks foreground/unknown process state; failed reads are not idle. Preserve tab neighbor focus and cancellation.
- Restore opens a fresh shell only after Connect. Never replay old commands or implicitly reconnect saved tabs.

## Workflow

1. Trace the catalog/form/tab operation to its identity, inventory and terminal owner; inspect compact and detail entry points.
2. Preserve mounted editors and state when regrouping navigation or shared controls.
3. Exercise independent inventory errors, blocked/cancelled close, explicit reconnect and pending operation feedback with isolated targets.

## Focused checks

Run `pnpm exec vitest run src/features/connections/ui/ServersView.test.ts src/features/connections/ui/SshSettings.test.ts src/features/connections/ui/ServersTerminalWorkspace.test.ts` plus changed identity/editor/restore tests.
Inspect purpose navigation, free entry, partial inventory, keyboard sash/tab close, X/middle-click/Delete confirmation and retry. Source or fixture checks do not establish live SSH/native acceptance.

## Read when needed

- [Servers and SSH guide](../../../docs/guides/remote-access.md#servers-catalog-and-terminal-tabs) for connection/restore semantics.
- [Terminal](../feature-terminal/SKILL.md) for PTY lifetime and [Conversation tools](../feature-conversation-tools/SKILL.md) for Host-machine tools.
