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
- `src/features/host-tools/toolsSessionRegistry.ts`, `toolsHubTransport.ts` and `HostToolsWindow.tsx`
- `src/features/connections/model/hostFeatureClient.ts`
- `host/tool-management.ts`, `host/conversation/conversation-preview.ts` and `host/conversation/conversation-tools.ts`
- `src/integrations/harness/core/toolWorkflowGuidance.ts` and `runtimeGuidance.ts`

## Workflow

1. Identify the selected computer, canonical project, tool target and owning Host before tracing a failure; preserve unknown associations rather than guessing.
2. Follow the existing domain controller through capability, lease, request and stale-result handling. Change shared shell composition separately from domain effects.
3. Keep capture/annotation/attachment drafts through navigation and recoverable failures. Feed attachments through the existing composer integration.
4. Exercise affected local/remote/offline and permission-denied states, control handoff, close/docking and retry without duplicate operations.

## Preserve

- Do not merge project identity, execution cwd and selected machine. Tool availability is not a control grant.
- Browser/device control retains explicit lease ownership and capability checks; annotation must use the exact captured frame and target.
- Devices require Host `controlProtocol: 1` and a device-bound lease before input.
  Viewing, restored drafts and inspection selection never claim control. Preserve
  request identity, expiry/revocation, competing controllers and stale-node rejection.
  Inspect captures a fresh tree then frame; capture is not OS-atomic. Preview picking
  requires verified pixel coordinates and matching dimensions; unknown scaling stays
  list-only. Platform text limitations retain the entered draft.
- Retain listeners with unknown project association, bounded logs/samples, process review/confirmation and truthful partial results.
- Development-server output redacts split credentials before bounded retention and releases discarded fragments. A port-conflict error clears only when the exact owned process identity is observed listening on that port; unrelated errors and unknown shutdown remain held.
- Keep pending/error/cancellation at the initiating control, target-generation guards and cleanup after navigation/close.
- Native/mobile counterparts retain their own transport and platform contracts; desktop fixtures cannot establish device acceptance.
- Tool metadata is not authority. Preserve legacy grant scopes independently from
  effect/retry descriptions, and filter discovery to each caller's exposure.
  Discovery `group` selects transport; `family` selects domain. Invalid options
  must identify the field and allowed values without echoing caller input.
  Numeric errors name field/type/bounds without echoing input. Align schema
  and service bounds; document default/cursor recovery.
- Preview execution, frame evidence and actual panel mounting are separate results.
  Viewport changes invalidate annotations; repeated request IDs must not renavigate.
- Dock visibility follows the active canonical conversation. Detached presentation
  follows by default and can be pinned; presentation selection never changes
  composer ownership or grants a browser lease. Retain hidden drafts and stop
  hidden polling. Native transfers require destination mount acknowledgement.
  Create detached windows through the native configured-window path, retaining
  the main WebView2 environment options and data directory. Window URLs contain
  bounded presentation metadata only; drafts travel through targeted events.
- Browser contexts are scoped to canonical native sessions. Alternate-machine
  presentation uses a separate owner-scoped namespace and advertised capability;
  unavailable scope support must not silently fall back to a shared page.
- Retain same-target frames during input, serialize input with document/lease
  checks, and reject stale results. Keep capture IDs and comments bound to their
  originating annotation scope. Browser drafts transfer capture references. Other
  domain drafts use bounded targeted native messages; never put draft text or image
  bytes in window URLs or persistent layout metadata. A transfer acknowledgement
  must match its source, destination, conversation, tool and machine.
  Retry an uncertain transfer with its immutable operation identity and payload;
  reconcile existing receipts and preserve both drafts when editable content changed.
  Persist versioned, bounded inspection geometry while keeping DOM node handles
  ephemeral. Traversal and layout overlays must reject stale or unsupported targets.

## Verification and references

- Choose SessionHostTools/ToolsWorkspace and changed Browser, Devices, Logs or resource/process model tests; cover target changes during pending work.
- Use the affected UI matrix and isolated dev-Host/native/device checks when effects change. Review long labels, keyboard, annotation recovery and reduced motion as applicable.
- Read the [surface map](references/surfaces.md) for the affected UI, state, transport and test owners. Re-search current callers before broad changes.
- [Host contracts](../../../docs/reference/host-runtime.md)
- [Agent tool management](../../../docs/reference/agent-tools.md)
- [User tool guide](../../../docs/guides/agent-tools.md)
- [Workbench behavior](../../../docs/guides/workbench.md)
