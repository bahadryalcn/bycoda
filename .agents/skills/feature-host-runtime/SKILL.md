---
name: feature-host-runtime
description: "Use when changing Host transport, storage and native delivery. Not for workspace policy; see feature-managed-workspaces."
---

# Host runtime

Own common execution/history authority and authenticated transport across `host/`
domain services, desktop/mobile clients and native adapters. Domain skills retain
user workflows and permission gates. Source support, advertised capability, qualified activation and
installed acceptance remain separate; a successful slice grants no migration/default.

## Source starts

- Host: `host/domains/`, `host/transport/`, `host/storage/` and `host/execution/`; `host/server.ts` and `host/engine.ts` compose the runtime.
- Windows login tasks: `host/service/windows-task.ts` and `packages/host-service-launcher/`. Keep Node launch direct, preserve per-user authority and refuse live runtime replacement; never compile a launcher during installation or fall back to an encoded shell action.
- Domain effects: `host/workspaces/`, `host/desktop/`, `host/conversation/`, `host/terminals/` and `host/devices/`; public entries are domain services.
- Desktop: `src/features/connections/model/` and `src/shared/lib/host-runtime/`; schemas are under `src/shared/model/host-contracts/`.
- Providers: `src/integrations/harness/core/` and `src/integrations/harness/providers/`.
- Native: `src-tauri/src/host_ws/`, `src-tauri/src/session_store/` and sibling authority/control modules. Mobile transport follows nested `mobile/` rules.

## Workflow

1. Read the Host architecture and affected domain service. Identify environment, session, canonical project, cwd, original turn/process and physical storage owner.
2. Trace schema, authentication, captured principal, service admission, effect and acknowledgement; retain one domain service across HTTP/WS/native adapters.
3. Capture immutable original handles before deferred work. Recheck authority at disclosure/effect boundaries; retries bind the accepted command and payload.
4. For persistence/migration, trace actual writers, flush barriers, source bytes, FULL transactions and durable decisions/receipts. Missing evidence fails closed.
5. Exercise affected contract/service/provider/native seams and isolated reconnect/recovery; report source, fixture, native and serving-build evidence separately.

## Preserve

- One execution/history authority per environment/session. Authentication and sockets grant no new scope; credentials remain with their existing native/Host owners.
- Original construction, turn, approval and request identities survive waits, retries and route replacement. Ambiguity never falls back to PID/current writer.
- Admission, physical I/O lifetime, revocation, retirement and provider ACK are separate. Observer timeout/cancellation proves neither settlement nor cleanup.
- Settled warm providers retain writers until exact retirement. Failed retirement preserves unsent input; it cannot trigger an offline execution fallback.
- Persist remote commands before dispatch. Retain exact payloads, unknown outcomes, quarantined evidence and corrupt owner fences; never replay dispatched mutations.
- Corrupt lifecycle metadata or endpoint failure cannot prove Host retirement. Kernel-lease proof and explicit repair own legacy/corrupt-state recovery.
- Workspace publication retains expected content, rooted target, current permission checks and file ACLs. Preserve uncertain candidates and original source/recovery bytes.
- Authentication/heartbeat admission stays separate from controls. Original monotonic deadlines and physical slot accounting survive queue waits and observer cancellation.
- Subscription resume needs committed cursor proof for the exact live page, owner, target and resource; changed/unproven membership requires a fresh snapshot.
- Desktop effects persist original receipts before offer; unknown/offered work cannot be reoffered. Page tokens route existing scope; ACK proves handling only.
- Fence original authority/request identity before retiring proven settled receipts. Pending effects, failed cleanup, warm/unknown owners and physical completion need their own retained proof; preview settlement includes requested presentation.
- Preserve drafts, queues, approvals and attachments. Detach does not Stop; migration needs its full admission contract.

## Focused checks

Run schema/import-boundary checks and tests beside the changed service/provider.
Examples: `pnpm exec vitest run --config host/vitest.config.ts host/transport host/storage`
and `pnpm exec vitest run src/features/connections/model src/shared/lib/host-runtime`.
Native ownership changes need relevant Rust/interop/lifecycle cases; transport changes
need revocation, stale callbacks, reconnect, duplicate/unknown outcomes and old clients.
Evidence limits are in the [contract reference](references/contracts.md).

## References

- [Surface owners](references/surfaces.md): locate current services, adapters and tests.
- [Authority and recovery](references/contracts.md): detailed publication, outbox, receipt retirement and browser-presentation boundaries.
- [Native storage epoch](references/storage-epoch.md): migration, source preservation and exact native owner retirement, including linked conditional owner decisions.
- [Host architecture](../../../docs/reference/host-runtime.md): transport and storage design.
- [Native admission](../../../docs/reference/assistant-native-admission.md): WindowIssuer provisioning, exact signed scope and revocation; pairing alone grants no proof.
- [Workspace/delivery](../../../docs/reference/managed-workspaces.md): workspace authority.
