---
name: feature-host-runtime
description: Host authority and WebSocket migration inventory for neutral schemas, authenticated RPC, shared client policy, domain services, native/mobile adapters, durable admission and staged recovery. Read before changing transport or execution ownership.
---

# Host runtime and WebSocket migration

## Purpose and scope

Maintain one execution/history authority per `(environmentId, sessionId)` while
macOS, Windows and mobile clients control the conversation. Execution cwd,
project identity, transport and current writer are separate. T2: 26 surface
groups in `temp/local/2026-10-27-host-architecture-plan/PLAN.md`; W00-W11 and
G01-G09 remain the complete implementation/acceptance scope.

Read `docs/reference/host-runtime.md` for the current source boundaries. Exact
method inventory is under that plan's `inventory/`: 349 Host branches, 326
referenced method literals and 958 production source files at capture time.
Unmatched literals require review; they are not automatically missing RPCs.

## Owner decisions and concurrency

Exact owner quotes, 2026-10-27, current conversation:

- "En iyi dediğin yapı neyse onu kullanarlaım fakat kodları doğru şekilde ayıralım ki sıkıntıları ortadan kalsın. İlk olarak planımızı tamamla. Zaman problemimiz yok geçiş için en mantıklısı ws ile ws ye geçelim. Subagentlar ile planımızı yapmaya başla".
- "tamam bunlarıda planlıyalım ozmana" adds G01-G09.
- "Tamam mainde yapmaya başla" authorizes this existing main checkout.
- "Start working toward this goal: ile jyap hepsini" requests completion of the remaining plan. The implementation goal is active; a completed slice is not completion of that goal.

No staging, main commit, branch switch, installation, live session conversion,
push or publication follows from this card. Preserve concurrent UI, voice,
settings, CI/local-update, package and native remote changes. Use one writer per
file and coordinate dependencies. Native subagents are explicitly authorized.

Read-only authenticated preflight found this checkout's project and no active
feature claims. No managed-workspace claim was acquired by this interactive
main session; this card is not a lock. The serving Host returned no
buildIdentity and no new transport capabilities. It was not updated/restarted.

## Surface inventory

| Group                       | Source and current implementation                                                                                                                                                                                      |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01 Contracts                | `src/shared/model/host-contracts/`: strict wire, session commands/reads/queue, authority and mobile TLS DTOs, policies and generated schema. Full domain DTO extraction remains open.                                  |
| 02 Shared runtime           | `src/shared/lib/host-runtime/`: deadlines, uncertainty, guarded commit/cursor, bounded logical resnapshot and immediate deletion fencing.                                                                              |
| 03 Host composition         | `host/server.ts`: explicit routed-method map, HTTP compatibility and WS/bulk composition; many legacy branches remain.                                                                                                 |
| 04 Read domains | Environment/project/session reads plus project directory/browse/create/open share domain services and closed DTOs. |
| 05 Commands                 | `host/domains/commands/`: semantic admission, receipts, native projection, queue/attachment/crew preservation.                                                                                                         |
| 06 Queue                    | `host/domains/sessions/queue-service.ts` routes all six HTTP/WS methods; existing `host/session-queue.ts` remains the lease/CAS owner.                                                                                                                                 |
| 07 WS transport             | `host/transport/ws/`: authenticated hello, deadlines, wait cancellation, read/control budgets, subscriptions/replay/applied ACK and dominating deletion.                                                               |
| 08 Bulk                     | `host/transport/http/bulk.ts`: scoped/hash/expiry/chunk bounds and deletion purge.                                                                                                                                     |
| 09 Native broker            | `src-tauri/src/host_ws/`: native credentials, TLS/SSH route, schema validation, one physical reconnect owner, bounded jobs and Tauri events. Cross-window logical demand union implemented and tested; installed acceptance open.                            |
| 10 Desktop clients          | Tauri adapter, `remoteMachineChannel.ts`, guarded `RemoteSession.tsx` application receipts. Capability-gated session streams; partial/hidden/unmigrated requests preserve explicit compatibility.                      |
| 11 Mobile native            | Separate `mobile/modules/bycoda-host-socket/`: Android/iOS WSS, CA-SPKI/hostname/expiry, native credential handle, lifecycle epoch and bounded I/O. Native compilation/device acceptance open.                         |
| 12 Mobile runtime           | Separate `mobile/src/remote/`, `state/host-runtime.ts`, AppProviders/query hooks: one reconnect supervisor, committed cursor and first 32 project activity streams; excess groups HTTP.                                |
| 13 TLS                      | `host/security/mobile-tls.ts`, `mobile-wss.ts`, `host/mobile-lan.ts`: stable per-profile CA, renewable SAN leaf and restricted TLS ingress; public metadata via authenticated bootstrap. Rotation/tickets remain open. |
| 14 Native store             | `src-tauri/src/session_store/authority.rs`: durable floor/reservation, old-writer SQL fences and verified decision/projection primitives implemented; no qualified live activation endpoint.                                                                    |
| 15 Host authority           | `host/storage/authority-journal.ts`: immutable staged snapshots, permanent generation decisions, mandatory actor proof and fail-closed native decision ACK. Coordinator source implemented; genuine authenticated native adapter/launcher/window qualification remain open.                          |
| 16 Host durability          | `host/store-db.ts`, worker, `host/storage/persistence-health.ts`: FULL critical transaction barrier and explicit recovery, committed-change notifications. Engine rechecks before provider effects.                    |
| 17 Backup/restore           | `host/storage/snapshots.ts`: Host-only coherent snapshot and blocked staged restore. Native+Host coherent restore remains open.                                                                                        |
| 18 Workspace/rewind | Captured generation through review/confirmation/effects; historical receipts preserved, partial file revert/Undo bookkeeping and rescue retained. Installed acceptance open. |
| 19 Files/editor/dev servers | Seven file and 13 DevServer HTTP/WS methods share neutral DTOs and existing owners; queued workspace/process/bridge effects recheck authorization. Installed acceptance remains open. |
| 20 Terminals | Six pipe-shell HTTP/WS methods and neutral contracts share existing process/receipt/activity owner. Native PTY/SSH/mobile leases remain separate and unconverted. |
| 21 Git/source control | Nine explicit HTTP/WS RPCs use neutral DTOs and a common service, rechecking grant after the actual repo mutex. Broad workspace tool routing and installed acceptance remain open. |
| 22 Tasks/goals/crews | 14 Task/eight Goal/11 Sprint/six Automation HTTP/WS methods share finite DTOs and existing schedulers. Task delete CAS, Sprint receipts and Automation outcome/cleanup recovery retain concurrent state. Stewards/Crews and rich-desktop Automation parity remain open. |
| 23 Scoped tools             | Browser/MCP/CLI/device/social/inbox boundaries remain; scope-specific extraction/tickets open.                                                                                                                         |
| 24 Lifecycle/support        | Detach never sends Stop; per-client generation/access fencing implemented. Full quit/lock/logout/restart support-floor qualification open.                                                                             |
| 25 Migration/recovery       | Default Host execution, idle migration, provider resume, rescue/downgrade and recovery UX remain disabled pending source and installed gates.                                                                          |
| 26 Checks/docs              | Schema drift, import boundary, focused suites, normal tsc-rs and this inventory/reference; complete performance/native/mobile matrix still open.                                                                       |

## Preservation and admission

Keep drafts, queues, approvals, attachments, provider IDs, workspaces and permission
gates. Uncertain delivery keeps its original command ID; never replay provider
work because a socket closed. Socket authentication grants no additional scope.
Recheck authorization before delayed disclosure. Credentials/SSH remain native;
never introduce a renderer socket or clear LAN bearer. Legacy mobile bootstrap
still handles a JS credential: do not describe all legacy paths as native-only.

Activation requires native writer inventory and flush barriers, immutable exact
source bytes, FULL source fence, permanent Host decision and durable native
receipt. Missing evidence blocks migration. Existing native work is not killed or
moved by implementation. Snapshot fixtures do not prove power-loss safety.

SessionStore now mandates native registration before writable SQLite opens;
canonical/physical database binding and kernel leases follow cloned writer
connections. Inspection closes only new registration admission, never claims
live writers are idle. Coverage is always Unknown: unregistered legacy binaries,
native channel authentication, executable/support qualification and remaining
platform process identity still require proof. No Complete inventory is issued.
Native window Ready/Started/destruction hooks retain one physical owner slot,
exact incarnation and bounded listeners. Qualification taint preserves ordinary
open work and actual committed operation results. Native/renderer drain coverage
remains incomplete; no migration capability, floor or default is enabled.

## Checks and remaining gates

Latest source registry: 1a682d66bdd7 (106 methods). Work-domain integration234/234
including full HTTP119; later planning-domain composition37/37; separate owner
Goals81, Sprints26 and Automations40; Native broker52/remote47 plus scoped Clippy;
mobile103 plus normal typecheck. Counts overlap and are not an aggregate total.
Normal Host/web tsc-rs, neutral/domain boundaries (48 files), actual in-memory
headless bundle (852 inputs, zero UI/React/CSS) and hygiene passed on 2026-10-28.
Rewind63 and file/checkpoint109 remain separate earlier focused evidence.
Notes4 methods additionally use the same storage worker/CAS/commit grant through
HTTP and WS; original outer expectedUpdatedAt remains required by its storage owner.
Task/Note/Goal/Automation retained bulk copies now fence actual committed
deletions before old descriptors or late captures can disclose removed rows;
Automation's existing run cascade is included. Final24 bulk plus7 worker cases
passed. Verified post-commit Note outcome and conservative unknown mutation
delivery passed39 domain/dispatcher/worker cases; shared policy/client contracts
passed105 across eight suites. Counts overlap. Already downloaded client copies
and remaining resource families are separate qualification work.
Native/mobile final follow-up and older full frontend evidence are recorded in
the local IMPLEMENTATION ledger. No fixture count proves installed acceptance.

W00-W07 remain partial overall; W08-W11 are unpromoted. Genuine native actor,
cohort/window/flush qualification, coherent two-store restore, remaining domains,
scoped web tickets, CA rotation, local Host default, historical migration/recovery
and compatibility retirement remain open. Do not advertise migration capability.
Before-fence cancellation has source implementation and retained native receipt;
missing snapshots never imply safe unfreeze. Existing fenced sources require a
permanent Host decision. Native bulk grants and shared-window union are source
implemented; installed/lifecycle qualification remains open.

No live Host restart, actual provider/SSH, installed desktop/native mobile build,
physical device, power-loss, two-store restore or release acceptance is claimed.
Future visual changes require light/dark1280/800 plus mobile320-430/tablet,
keyboard/rotation/large-text/privacy/accessibility checks. This slice changes
behavior/ports, with no layout redesign or screenshot acceptance claimed.

## Handoff identity

Baseline `0a42b1ab4fd891ccec5ca0fa238d7356b396b13c`; observed HEAD
`83053d6b830fba764f702411faca464de28b1a29`, branch main (2026-10-28). Another
writer's commit now includes prior Host/WS source; this session did not stage or
commit it. Subsequent additions require individual inclusion checks. Package
version 0.6.94 is not an installed build stamp. Serving Host inclusion is unknown.

Plan/progress: `temp/local/2026-10-27-host-architecture-plan/`.
Evidence: `temp/verification/2026-10-27-host-runtime-foundation/`.
W00-W11 details are engineering proposals implementing the quoted owner direction;
no new cloud/account dependency or operation authority is implied.
