# Host runtime ownership map

Paths are repository-root relative. This is an entry map, not a qualification checklist or a list of currently advertised capabilities. Read repository-root `docs/reference/host-runtime.md` for the architecture and current contract boundaries.

## Service and transport owners

- `host/server.ts`, `host/engine.ts`: authenticated dispatch, session operations and provider lifecycle. Search the exact method in current neutral contracts, RPC registry/dispatcher and domain service; avoid adding a second service for WebSocket callers.
- `src/features/connections/model/`: shared client policy, protocol/capability handling and Host/native adapters. `mobile/` has its own active and compatibility transports; inspect its nested repository rules and actual producer.
- `src/integrations/harness/core/`: registry, child backend, JSON-RPC/ACP/Pi operation views, source context and output reduction. `src/integrations/harness/providers/` retains adapter-specific protocol and cleanup ownership.
- `host/provider-guardian.ts`, `packages/provider-process-guardian/`: private guardian control and process cohort proof. Native counterparts remain under `src-tauri/src/`; do not infer full OS descendant closure from a process handle subset.
- `host/conversation-tools.ts` and domain tool modules: scoped tool schemas and conversation principal; do not import a renderer-supplied principal or bypass the existing approval gate.

## Persistence, source admission and recovery

- `host/store-db.ts` and workers, `host/storage/persistence-health.ts`, `host/storage/authority-journal.ts`, `host/storage/snapshots.ts`: durable transactions, staged immutable snapshots, permanent generation decisions and recovery. Host-only snapshots are not proof of coherent Native+Host restore.
- `src-tauri/src/session_store.rs` and submodules: physical Store/window ownership, SQLite writers, source fences and restore. `src-tauri/src/native_provider_output.rs` retains native output lineage.
- `src/features/sessions/data/sessionOutputProjection.ts`, `src/integrations/harness/core/nativeOutputDelivery.ts`: accepted model/output ancestry and deferred delivery ownership. Ordinary storage ACKs are not FULL application/SQL qualification.
- `src/features/files/data/editorDraftPersistence.ts`, `src/features/files/ui/FileEditor.tsx` and editor adapters: actual editor producers, immutable baseline and filesystem-save capture. Search Native draft commands and recovery receivers when changing the wire.
- `src/features/sessions/data/composerDraftStore.ts`, composer/QuestionForm and Notes writers retain separate raw input, mounted owner and bounded Parent lineage; UI state cannot stand in for a physical source writer.
- Domain families include Files, DevServers, terminal pipes, Git, Tasks/Goals/Sprints, Automations/Stewards, Crews, Notes and scoped Browser/Devices/Inbox/Social tools. Their service permissions and resource lifetimes stay with those domains.

## Verification selection

Start with tests beside the changed schema/service/provider/native module. For actual interop choose isolated Host/native profiles and original process/window/Store owners; use fake repositories and scoped data. Include unauthorized/old clients, late original callbacks, duplicate commands, unknown write/cleanup outcomes, restart/recovery and capacity refusal when affected. Never turn an earlier checkpoint's test count, all26 label or installed version into present acceptance.
