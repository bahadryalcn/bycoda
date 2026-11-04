---
name: feature-host-runtime
description: "Change Host execution authority, authenticated HTTP/WebSocket transport, immutable operation identity, durable storage, native admission and recovery."
---

# Host runtime

Own common authority and transport contracts across domain services and desktop/mobile/native adapters. Domain skills own user workflows. Source support, advertised capability, qualified activation and installed acceptance are separate; never promote migration/defaults from a successful slice.

## Source entry points

Code paths below are repository-root relative.

- `host/engine.ts`
- `src/features/connections/model/remoteOutbox.ts` and `remoteOutboxDatabase.ts` for desktop remote-command evidence.
- `host/server.ts`
- `host/owner.ts`, `host/lifecycle-state.ts` and `host/storage/atomic-write.ts`
- `host/workspace.ts` and `host/storage/workspace-publication.ts`
- `host/storage/request-fence.ts`, `host/terminals.ts`, `host/device-preview.ts`
- `host/conversation-preview.ts`
- `host/desktop-command-delivery.ts`, `host/desktopLive.ts`, `host/domains/commands/service.ts`
- `host/transport/read-budget.ts`, `host/transport/dispatch.ts`, `host/transport/ws/server.ts`
- `src/shared/lib/host-runtime/environmentRuntime.ts`, `src-tauri/src/host_ws/`
- `host/child-backend.ts` and `host/run-writers.ts`
- `src/integrations/harness/core/`

## Workflow

1. Read the Host reference and the specific domain service before changing a wire or owner. Identify environment/session, canonical project, execution cwd, original process/turn and actual storage authority.
2. Trace the request through schema, authentication, captured principal, service mutex/admission, effect and acknowledgement. Keep one domain service behind HTTP/WS/native adapters.
3. Capture immutable original handles before deferred work and recheck authority at delayed disclosure/effect boundaries. Bind retries to the accepted command and payload; do not substitute the latest session route.
4. For persistence/migration, trace actual writers, flush barriers, source bytes, FULL transaction and durable decisions/receipts. Keep unsupported or missing evidence closed and ordinary legacy behavior explicit.
5. Choose focused contract/service/provider/native tests for the altered seam, then exercise isolated adapters/reconnect/recovery as applicable. Report source, fixture, native and serving-build evidence separately.

## Preserve

- Corrupt stored session owners remain routing fences even when excluded from list rendering. Quarantined outbox evidence counts toward admission; preserve distinct original bytes and never resend uncertain commands.

- Missing/corrupt lifecycle metadata or an unreachable endpoint never proves a Host stopped. Probe the kernel lease; live legacy owners without verified identity remain unknown. Keep corrupt policy, tunnel and credential state until explicitly repaired.
- Workspace saves retain expected-content checks, permission checks at publication, rooted target identity and original file permissions. Preserve uncertain replacement candidates; private-state atomic helpers do not preserve arbitrary workspace ACLs.

- One execution/history authority per environment/session. A socket or authenticated connection grants no new scope; credentials remain with their existing native/Host owners.
- Normal admission, accepted physical I/O lifetime, permission revocation, process retirement and provider protocol ACK are distinct. An observer timeout cannot settle work or certify cleanup.
- Original construction receipts, turn bindings, approval occurrences and pending identities must survive waits, retries and route replacement. Missing/ambiguous identity must not fall back to PID/current writer.
- A settled warm Host provider still owns its writer. Desktop continuation needs exact retirement before a run lease; timeout/refusal must retain unsent input rather than trigger an offline fallback on retirement-capable Hosts.
- Uncertain sends retain the original command ID and are never replayed because a socket closed. Pending/unknown ownership records cannot be evicted to admit fresh work.
- Authentication/heartbeat admission stays separate from ordinary controls. Queue waits share the original monotonic deadline; cancelled observers do not release physical work. Reconnect retains only never-sent requests, never dispatched mutations.
- Subscription resume requires committed cursor proof bound to the exact live page, owner, target and resource. Unproven or changed membership takes a fresh snapshot; renderer cursor input alone grants no replay authority.
- Desktop control admission persists the original receipt and delivery identity before offering it. Offered/unknown work is never reoffered after a lost response or restart; ACK proves handling only. Native page tokens route existing authority and never replace exact original turn/process grants.
- Retire only proven settled receipts using monotonic time. Fence their original authority/request identity before removing exact records; a fence match refuses execution. Keep pending effects, failed cleanup and unknown physical completion retained. Resource retirement requires its own proof, not only a fulfilled request.
- Persist remote commands before dispatch; retain exact ID, payload and unknown outcomes. IndexedDB settlements and quarantine preserve reviewed raw evidence; legacy localStorage bytes remain until a qualified writer-cohort retirement proves safe. Storage failures hold dispatch and attachment cleanup.
- Browser preview settlement includes verified presentation when requested. Read-only status failures can retire; uncertain claim/navigation/presentation work cannot. Token revocation removes disclosure authority, not evidence of an accepted effect. Recheck both original and current authority after delayed waits.
- Keep drafts, queues, approvals, attachments, exact source bytes and recovery copies. Detach does not Stop; new migration/default authority requires its complete admission contract.
- Snapshot/unit evidence does not prove crash/power-loss durability, all-actor closure, native sandbox enforcement or installed source inclusion.

## Verification and references

- Use schema/import-boundary checks and changed domain suites. Desktop/Host type checks use normal tsc-rs project commands unless fast mode is explicitly selected.
- Native ownership changes require relevant Rust/interop/lifecycle cases; transport changes need auth revocation, stale callbacks, reconnect, duplicate/uncertain outcome and old-client coverage. Run only checks justified by the change.
- Read the [surface map](references/surfaces.md) for the affected UI, state, transport and test owners. Re-search current callers before broad changes.
- [Canonical Host architecture](../../../docs/reference/host-runtime.md)
- [Workspace/delivery contract](../../../docs/reference/managed-workspaces.md)
