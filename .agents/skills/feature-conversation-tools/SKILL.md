---
name: feature-conversation-tools
description: Change tool navigation, computer/Host targeting, Browser, Devices, development servers, Logs, Resource usage, control leases and capture drafts.
---

# Conversation tools

Own tool workspace composition and selected target in `src/features/host-tools/` and
`host/conversation/`, with native window/remote adapters and corresponding mobile routes.
Browser, Devices, Logs and process controllers keep their lifecycle and permissions;
the bycoda app skill owns tool usage, never granting operation authority here.

## Source starts

- UI/presentation: `src/features/host-tools/`, through SessionHostTools and ToolsWorkspace;
  `src/features/devices/` owns device inspection and capture.
- Target/transport: `src/features/connections/model/`, through hostFeatureClient;
  `src/integrations/harness/core/` supplies workflow/runtime guidance.
- Host: `host/conversation/`, through tool-management and conversation-tools; domain
  owners remain in `host/browser/`, `host/devices/` and `host/dev-servers/`. Secret
  requests, storage and `secrets.run` belong to `host/secrets/`.
- Native: `src-tauri/src/` owns configured detached windows and remote delivery;
  inspect corresponding `mobile/` routes independently.

## Workflow

1. Identify selected machine, canonical project, execution cwd, tool target and owning Host;
   preserve unknown associations instead of guessing.
2. Follow the domain controller through capability, lease, request and stale-result handling.
   Separate shell presentation changes from domain effects.
3. Trace capture/annotation/attachment drafts through navigation, transfer and composer insertion.
4. Exercise local/remote/offline, denial, control handoff, close/docking and uncertain retry
   without duplicate operations; use the [owner map](references/surfaces.md).

## Preserve

- Project identity, execution cwd and selected machine remain distinct. Availability and
  metadata grant no control; discovery respects caller exposure and legacy grant scopes.
- Browser/device input needs exact lease ownership and capability checks. Inspection/viewing
  and restored drafts never claim control; annotations retain exact captured frame/target.
- Browser frames require the matching conversation scope, not a control lease. Captures
  never acquire or renew control; mutations and annotations retain active lease checks.
- Devices retain protocol/device-bound admission, expiry/revocation, competing controllers,
  stale-node rejection, coordinate proof and entered text across platform limitations.
- Unknown project listeners remain visible. Logs/samples stay bounded; process effects retain
  review/confirmation and truthful partial results. Unknown shutdown is not success.
- Pending/error/cancellation stay at initiating controls. Target generations and cleanup fence
  delayed results across navigation/close; native/mobile keep their own acceptance contracts.
- Discovery transport/domain filters, schema/service bounds and cursor/default recovery stay
  aligned; validation identifies fields/types/bounds without echoing caller input.
- Preview execution, frame evidence and mounted panel are separate. Viewport changes invalidate
  annotations; repeated immutable request IDs never renavigate.
- Dock follows active canonical conversation; detached view follows or pins without changing
  composer ownership/leases. Retain hidden drafts, stop hidden polling, require mount ACK.
- Detached windows retain native configured-window environment/data directory. URLs carry
  bounded presentation metadata only; drafts use targeted native events, never URLs/layout storage.
- Browser contexts are canonical-session scoped; alternate-machine presentation requires a separate
  owner namespace and advertised support, never fallback to a shared page.
- Input retains same-target frames, document/lease checks and serialization. Capture IDs/comments
  remain annotation-scoped; geometry persists bounded/versioned, DOM handles stay ephemeral.
- Transfers match source, destination, conversation, tool and machine. Uncertain retry retains
  immutable identity/payload and reconciles receipts; changed content preserves both drafts.

## Focused checks

Run adjacent SessionHostTools/ToolsWorkspace and changed Browser, Devices, Logs, resource/
process model suites in `src/features/host-tools/` and `src/features/devices/`, then affected
Host domain suites using `host/vitest.config.ts`. Follow
[verification order](../../../docs/reference/testing.md#order-of-verification). For changed
effects, exercise isolated Host/native/device paths and relevant `tests/browser/` fixtures;
review keyboard, long labels, annotation recovery and reduced motion as applicable.

## References

- [Owner map](references/surfaces.md): locate UI, model, transport and domain tests.
- [Control and transfer contracts](references/contracts.md): device admission, discovery,
  presentation, draft transfer and process lifecycle details.
- [Host contracts](../../../docs/reference/host-runtime.md): common authority and transport.
- [Decision provenance](references/decisions.md): owner decisions that changed lasting contracts.
- [Agent tool management](../../../docs/reference/agent-tools.md): exposure and discovery.
- [User tool guide](../../../docs/guides/agent-tools.md): user-visible operations.
- [Workbench behavior](../../../docs/guides/workbench.md): dock and detached navigation.
