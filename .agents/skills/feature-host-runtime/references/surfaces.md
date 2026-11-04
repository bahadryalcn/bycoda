# Host runtime ownership map

Paths are repository-root relative. This is an entry map, not a qualification checklist or a list of currently advertised capabilities. Read repository-root `docs/reference/host-runtime.md` for the architecture and current contract boundaries.

## Service and transport owners

- `host/store.ts`: legacy summary refresh bounds transcript hydration and uses revision/old-summary CAS with an authority fence. Cache publication requires unchanged project and external versions; skipped refreshes do not publish a cache.
- `host/store.ts`, `host/engine.ts`: cold, idle, desktop-shared managed sessions without a current authority head defer provider binding. First use rechecks the original indexed identity, current workspace and authority; a stale attempt fails before a later explicit retry may bind a verified replacement. Running, interrupted and authority-owned recovery remains eager.
- `host/transport/read-budget.ts`, `dispatch.ts`, `ws/server.ts`: separate authentication/heartbeat/control admission, shared physical work accounting and retryable overload classification. Adjacent tests exercise the actual dispatcher nesting.
- `src/shared/lib/host-runtime/environmentRuntime.ts` and its tests: bounded control FIFO, original monotonic deadlines, never-sent cancellation and physical slot retention. `src-tauri/src/host_ws/{connection,demand}.rs`, `mod.rs` and tests own reconnect queue and native cursor proof.

- `host/server.ts`, `host/engine.ts`: authenticated dispatch, session operations and provider lifecycle. Search the exact method in current neutral contracts, RPC registry/dispatcher and domain service; avoid adding a second service for WebSocket callers.
- Title regeneration uses `commands.dispatch` with `type: "regenerateTitle"` in `session-commands.ts`, `host/domains/commands/service.ts` and `host/engine.ts`. Generation waits outside SQL transactions; a completed receipt is recorded with the guarded title write. `src/features/sessions/model/regenerateSessionTitle.ts` retains exact Host/environment/session ownership and reconciles the same command ID before retry. Shared title inputs forward the selected utility model/settings without changing the conversation's model or transcript.
- `src/features/connections/model/`: shared client policy, protocol/capability handling and Host/native adapters. `mobile/` has its own active and compatibility transports; inspect its nested repository rules and actual producer.
- `src/integrations/harness/core/`: registry, child backend, JSON-RPC/ACP/Pi operation views, source context and output reduction. `src/integrations/harness/providers/` retains adapter-specific protocol and cleanup ownership.
- `host/provider-guardian.ts`, `packages/provider-process-guardian/`: private guardian control and process cohort proof. Native counterparts remain under `src-tauri/src/`; do not infer full OS descendant closure from a process handle subset.
- `host/conversation-tools.ts` and domain tool modules: scoped tool schemas and conversation principal; do not import a renderer-supplied principal or bypass the existing approval gate.

## Persistence, source admission and recovery

- `host/store.ts`, `host/domains/commands/service.ts`, `host/desktopLive.ts`, `host/desktop-command-delivery.ts` and adjacent tests own durable desktop command admission, original-principal status, one-time offer and page-scoped ACK. `src/features/connections/model/{desktopLive,useDesktopLive}.ts` and `src-tauri/src/desktop_control_page.rs` own original turn/page routing and receiver checks.

- `host/store-db.ts` and workers, `host/storage/persistence-health.ts`, `host/storage/authority-journal.ts`, `host/storage/snapshots.ts`: durable transactions, staged immutable snapshots, permanent generation decisions and recovery. Host-only snapshots are not proof of coherent Native+Host restore.
- `src-tauri/src/session_store.rs` and submodules: physical Store/window ownership, SQLite writers, source fences and restore. `src-tauri/src/native_provider_output.rs` retains native output lineage.
- `src/features/sessions/data/sessionOutputProjection.ts`, `src/integrations/harness/core/nativeOutputDelivery.ts`: accepted model/output ancestry and deferred delivery ownership. Ordinary storage ACKs are not FULL application/SQL qualification.
- `src/features/files/data/editorDraftPersistence.ts`, `src/features/files/ui/FileEditor.tsx` and editor adapters: actual editor producers, immutable baseline and filesystem-save capture. Search Native draft commands and recovery receivers when changing the wire.
- `src/features/sessions/data/composerDraftStore.ts`, composer/QuestionForm and Notes writers retain separate raw input, mounted owner and bounded Parent lineage; UI state cannot stand in for a physical source writer.
- Domain families include Files, DevServers, terminal pipes, Git, Tasks/Goals/Sprints, Automations/Stewards, Crews, Notes and scoped Browser/Devices/Inbox/Social tools. Their service permissions and resource lifetimes stay with those domains.

## Verification selection

- Remote connection recovery: `src/features/connections/model/remoteConnection.ts`,
  `remoteFailure.ts`, `connections.ts` and `src/features/connections/ui/RemoteSession.tsx`
  keep blocked transport state separate from ordinary operation errors. An HTTP
  success alone must not clear a blocked native lane. `src-tauri/src/remote.rs`
  and `host_ws/` own identity-verified explicit recovery without mutation replay;
  workspace path confinement remains in `host/workspace-commands.ts`.

Start with tests beside the changed schema/service/provider/native module. For actual interop choose isolated Host/native profiles and original process/window/Store owners; use fake repositories and scoped data. Include unauthorized/old clients, late original callbacks, duplicate commands, unknown write/cleanup outcomes, restart/recovery and capacity refusal when affected. Never turn an earlier checkpoint's test count, all26 label or installed version into present acceptance.
