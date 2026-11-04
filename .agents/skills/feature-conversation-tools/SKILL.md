---
name: feature-conversation-tools
description: "Change tool navigation, computer/Host targeting, Browser, Devices, development servers, Logs, Resource usage, control leases and capture drafts."
---

# Conversation tools

Own tool workspace composition and selected target. Each Browser/Devices/Logs/process controller retains its own lifecycle and permissions. App-level Conversation Tools usage belongs to the bycoda app skill; this developer skill does not grant operation authority.

## Source entry points

Code paths below are repository-root relative.

- `src/features/host-tools/SessionHostTools.tsx`
- `src/features/host-tools/ToolsWorkspace.tsx`
- `src/features/connections/model/hostFeatureClient.ts`
- `host/tool-management.ts`, `host/conversation-preview.ts` and `host/conversation-tools.ts`
- `src/integrations/harness/core/toolWorkflowGuidance.ts` and `runtimeGuidance.ts`

## Workflow

1. Identify the selected computer, canonical project, tool target and owning Host before tracing a failure; preserve unknown associations rather than guessing.
2. Follow the existing domain controller through capability, lease, request and stale-result handling. Change shared shell composition separately from domain effects.
3. Keep capture/annotation/attachment drafts through navigation and recoverable failures. Feed attachments through the existing composer integration.
4. Exercise affected local/remote/offline and permission-denied states, control handoff, close/docking and retry without duplicate operations.

## Preserve

- Do not merge project identity, execution cwd and selected machine. Tool availability is not a control grant.
- Browser/device control retains explicit lease ownership and capability checks; annotation must use the exact captured frame and target.
- Retain listeners with unknown project association, bounded logs/samples, process review/confirmation and truthful partial results.
- Development-server output redacts split credentials before bounded retention and releases discarded fragments. A port-conflict error clears only when the exact owned process identity is observed listening on that port; unrelated errors and unknown shutdown remain held.
- Keep pending/error/cancellation at the initiating control, target-generation guards and cleanup after navigation/close.
- Native/mobile counterparts retain their own transport and platform contracts; desktop fixtures cannot establish device acceptance.
- Tool metadata is not authority. Preserve legacy grant scopes independently from
  effect/retry descriptions, and filter discovery to each caller's exposure.
- Preview execution, frame evidence and actual panel mounting are separate results.
  Viewport changes invalidate annotations; repeated request IDs must not renavigate.

## Verification and references

- Choose SessionHostTools/ToolsWorkspace and changed Browser, Devices, Logs or resource/process model tests; cover target changes during pending work.
- Use the affected UI matrix and isolated dev-Host/native/device checks when effects change. Review long labels, keyboard, annotation recovery and reduced motion as applicable.
- Read the [surface map](references/surfaces.md) for the affected UI, state, transport and test owners. Re-search current callers before broad changes.
- [Host contracts](../../../docs/reference/host-runtime.md)
- [Agent tool management](../../../docs/reference/agent-tools.md)
- [User tool guide](../../../docs/guides/agent-tools.md)
- [Workbench behavior](../../../docs/guides/workbench.md)
