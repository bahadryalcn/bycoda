---
name: feature-servers
description: "Use when changing SSH targets, forms and saved terminal tabs. Not for PTY execution; see feature-terminal."
---

# Servers and SSH changes

Use for saved SSH targets and their terminal workspace. A saved target, connected Host machine and running SSH terminal represent different state. PTY execution and shared tools have separate owners.

## Source starts

- `src/features/connections/ui/ServersView.tsx`, `src/features/connections/ui/ServersWorkspaceView.tsx`, `src/features/connections/ui/ServersConnectionTools.tsx`: catalog and purpose navigation.
- `src/features/connections/ui/QuickConnect.tsx`, `src/features/connections/ui/SshServerEditor.tsx`, `src/features/connections/ui/SshIdentityField.tsx`, `src/features/connections/ui/SshSettings.tsx`: configuration and trust/identity.
- `src/features/connections/ui/ServersTerminalWorkspace.tsx` and restore controls: tabs, focus and explicit reconnect.
- `src/features/connections/model/serverInventory.ts`, `src/features/connections/model/serverTerminalRestoreState.ts`, `src/features/terminal/model/terminalClose.ts`: state and lifetime boundaries.
- `host/conversation/conversation-server-tools.ts`, `host/conversation/conversation-desktop-relay.ts`, `src-tauri/src/conversation_servers.rs`, `src-tauri/src/conversation_ssh_execution.rs`: agent inventory tools and conversation-owned SSH commands.

## Preserve

- A stopping SSH forward retains its exact ID, owner and proxy leases until local process exit is confirmed. Unknown stop outcomes stay fenced and offer a stop retry; process waits and proxy/config cleanup run outside the shared forward registry and native window lifecycle locks.

- Do not infer health from a saved entry, terminal existence or failed read. Machine connectivity and SSH capability remain distinct.
- Keep free group/tag/name entry, optional ephemeral names, search/selection/filter persistence and unsaved form drafts across purpose navigation.
- Retain identity cancellation, trust/configuration review, explicit submits, permission gates and duplicate-operation guards.
- Terminal close checks foreground/unknown process state; failed reads are not idle. Preserve tab neighbor focus and cancellation.
- Restore opens a fresh shell only after Connect. Never replay old commands or implicitly reconnect saved tabs.
- Agent SSH commands require in-app approval of the exact saved target and command unless the Host verifies current full-access permission for the original coding session. Other modes and Assistant Room still require approval; downgrade before execution revokes the bypass. Bind request IDs and output to the original Host, project and conversation; revalidate configuration and authority after approval. Never adopt private manual SSH terminals or bypass host-key, credential or proxy gates.
- Start acknowledgement is not command success. Read bounded output and exit status; cancelled, timed-out or interrupted local SSH can leave the remote outcome unknown. Never automatically replay a command after restart or an uncertain reply.

## Workflow

SSH receipt eviction applies only to definite settled outcomes after the retry
retention period. Keep active, poisoned and remotely uncertain records; expiry
never grants permission to automatically rerun a command.

1. Trace the catalog/form/tab operation to its identity, inventory and terminal owner; inspect compact and detail entry points.
2. Preserve mounted editors and state when regrouping navigation or shared controls.
3. Exercise independent inventory errors, blocked/cancelled close, explicit reconnect and pending operation feedback with isolated targets.

## Focused checks

Run `pnpm exec vitest run src/features/connections/ui/ServersView.test.ts src/features/connections/ui/SshSettings.test.ts src/features/connections/ui/ServersTerminalWorkspace.test.ts` plus changed identity/editor/restore tests.
Inspect purpose navigation, free entry, partial inventory, keyboard sash/tab close, X/middle-click/Delete confirmation and retry. Source or fixture checks do not establish live SSH/native acceptance.

## References

- [Approval decision](references/decisions.md) for full-access coding-session authority.

- [Servers and SSH guide](../../../docs/guides/remote-access.md#servers-catalog-and-terminal-tabs) for connection/restore semantics.
- [Terminal](../feature-terminal/SKILL.md) for PTY lifetime and [Conversation tools](../feature-conversation-tools/SKILL.md) for Host-machine tools.
