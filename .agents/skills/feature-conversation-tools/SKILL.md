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

## Workflow

1. Identify the selected computer, canonical project, tool target and owning Host before tracing a failure; preserve unknown associations rather than guessing.
2. Follow the existing domain controller through capability, lease, request and stale-result handling. Change shared shell composition separately from domain effects.
3. Keep capture/annotation/attachment drafts through navigation and recoverable failures. Feed attachments through the existing composer integration.
4. Exercise affected local/remote/offline and permission-denied states, control handoff, close/docking and retry without duplicate operations.

## Preserve

- Do not merge project identity, execution cwd and selected machine. Tool availability is not a control grant.
- Browser/device control retains explicit lease ownership and capability checks; annotation must use the exact captured frame and target.
- Retain listeners with unknown project association, bounded logs/samples, process review/confirmation and truthful partial results.
- Keep pending/error/cancellation at the initiating control, target-generation guards and cleanup after navigation/close.
- Native/mobile counterparts retain their own transport and platform contracts; desktop fixtures cannot establish device acceptance.

## Verification and references

- Choose SessionHostTools/ToolsWorkspace and changed Browser, Devices, Logs or resource/process model tests; cover target changes during pending work.
- Use the affected UI matrix and isolated dev-Host/native/device checks when effects change. Review long labels, keyboard, annotation recovery and reduced motion as applicable.
- Read the [surface map](references/surfaces.md) for the affected UI, state, transport and test owners. Re-search current callers before broad changes.
- [Host contracts](../../../docs/reference/host-runtime.md)
- [Workbench behavior](../../../docs/guides/workbench.md)
