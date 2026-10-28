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

| Group                       | Source and current implementation                                                                                                                                                                                                                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 01 Contracts                | `src/shared/model/host-contracts/`: strict wire, session commands/reads/queue, authority and mobile TLS DTOs, policies and generated schema. Full domain DTO extraction remains open.                                                                                                                                                            |
| 02 Shared runtime           | `src/shared/lib/host-runtime/`: deadlines, uncertainty, guarded commit/cursor, bounded logical resnapshot and immediate deletion fencing.                                                                                                                                                                                                        |
| 03 Host composition         | `host/server.ts`: explicit routed-method map, HTTP compatibility and WS/bulk composition; many legacy branches remain.                                                                                                                                                                                                                           |
| 04 Read domains             | Environment/project/session reads plus project directory/browse/create/open share domain services and closed DTOs.                                                                                                                                                                                                                               |
| 05 Commands                 | `host/domains/commands/`: semantic admission, receipts, native projection, queue/attachment/crew preservation.                                                                                                                                                                                                                                   |
| 06 Queue                    | `host/domains/sessions/queue-service.ts` routes all six HTTP/WS methods; existing `host/session-queue.ts` remains the lease/CAS owner.                                                                                                                                                                                                           |
| 07 WS transport             | `host/transport/ws/`: authenticated hello, deadlines, wait cancellation, read/control budgets, subscriptions/replay/applied ACK and dominating deletion.                                                                                                                                                                                         |
| 08 Bulk                     | `host/transport/http/bulk.ts`: scoped/hash/expiry/chunk bounds and deletion purge.                                                                                                                                                                                                                                                               |
| 09 Native broker            | `src-tauri/src/host_ws/`: native credentials, TLS/SSH route, schema validation, one physical reconnect owner, bounded jobs and Tauri events. Cross-window logical demand union implemented and tested; installed acceptance open.                                                                                                                |
| 10 Desktop clients          | Tauri adapter, `remoteMachineChannel.ts`, guarded `RemoteSession.tsx` application receipts. Capability-gated session streams; partial/hidden/unmigrated requests preserve explicit compatibility.                                                                                                                                                |
| 11 Mobile native            | Separate `mobile/modules/bycoda-host-socket/`: Android/iOS WSS, CA-SPKI/hostname/expiry, native credential handle, lifecycle epoch and bounded I/O. Native compilation/device acceptance open.                                                                                                                                                   |
| 12 Mobile runtime           | Separate `mobile/src/remote/`, `state/host-runtime.ts`, AppProviders/query hooks: one reconnect supervisor, committed cursor and first 32 project activity streams; excess groups HTTP.                                                                                                                                                          |
| 13 TLS                      | `host/security/mobile-tls.ts`, `mobile-wss.ts`, `host/mobile-lan.ts`: stable per-profile CA, renewable SAN leaf and restricted TLS ingress; public metadata via authenticated bootstrap. Rotation/tickets remain open.                                                                                                                           |
| 14 Native store             | `src-tauri/src/session_store/authority.rs`: durable floor/reservation, old-writer SQL fences and verified decision/projection primitives implemented; no qualified live activation endpoint.                                                                                                                                                     |
| 15 Host authority           | `host/storage/authority-journal.ts`: immutable staged snapshots, permanent generation decisions, mandatory actor proof and fail-closed native decision ACK. Coordinator source implemented; genuine authenticated native adapter/launcher/window qualification remain open.                                                                      |
| 16 Host durability          | `host/store-db.ts`, worker, `host/storage/persistence-health.ts`: FULL critical transaction barrier and explicit recovery, committed-change notifications. Engine rechecks before provider effects.                                                                                                                                              |
| 17 Backup/restore           | `host/storage/snapshots.ts`: Host-only coherent snapshot and blocked staged restore. Native+Host coherent restore remains open.                                                                                                                                                                                                                  |
| 18 Workspace/rewind         | Captured generation through review/confirmation/effects; historical receipts preserved, partial file revert/Undo bookkeeping and rescue retained. Installed acceptance open.                                                                                                                                                                     |
| 19 Files/editor/dev servers | Seven file and 13 DevServer HTTP/WS methods share neutral DTOs and existing owners; queued workspace/process/bridge effects recheck authorization. Installed acceptance remains open.                                                                                                                                                            |
| 20 Terminals                | Six pipe-shell HTTP/WS methods and neutral contracts share existing process/receipt/activity owner. Native PTY/SSH/mobile leases remain separate and unconverted.                                                                                                                                                                                |
| 21 Git/source control       | Nine explicit HTTP/WS RPCs use neutral DTOs and a common service, rechecking grant after the actual repo mutex. Broad workspace tool routing and installed acceptance remain open.                                                                                                                                                               |
| 22 Tasks/goals/crews        | 14 Task/eight Goal/11 Sprint/six Automation/five Steward/20 Crew HTTP/WS methods share finite DTOs and existing schedulers. Task delete CAS, Sprint receipts and accepted launch recovery retain concurrent state. Crew principals/read views, probe grants and deletion dependencies are explicit. Rich-desktop Automation parity remains open. |
| 23 Scoped tools             | Browser/MCP/CLI/device/social/inbox boundaries remain; scope-specific extraction/tickets open.                                                                                                                                                                                                                                                   |
| 24 Lifecycle/support        | Detach never sends Stop; per-client generation/access fencing implemented. Full quit/lock/logout/restart support-floor qualification open.                                                                                                                                                                                                       |
| 25 Migration/recovery       | Default Host execution, idle migration, provider resume, rescue/downgrade and recovery UX remain disabled pending source and installed gates.                                                                                                                                                                                                    |
| 26 Checks/docs              | Schema drift, import boundary, focused suites, normal tsc-rs and this inventory/reference; complete performance/native/mobile matrix still open.                                                                                                                                                                                                 |

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
open work and actual committed operation results. Fourteen core native persistence
commands now acquire exact physical-window write leases before Git/SQL, including
draft-list expiry and in-flight read-and-clear. Missing/stale tracking atomically
taints qualification while preserving ordinary open work; closed admission rejects
before effects. Native get/page reconciliation now holds only its effect lifetime;
the retained read continues when closed. Queued FTS work has a real process owner
through delay/parse/settlement plus effect-time SQL admission; closed writes stay
dirty for later indexing. No background job is assigned to a Window.
Provider/control/explicit rewind, startup, filesystem and renderer buffer drain
coverage remains incomplete; no migration
capability, floor or default is enabled.

Native applied-decision ACK reads persisted exact bytes under one coherent SQL
snapshot, validating fence/identities/terminal journal/current floor and digest.
Idempotent apply verifies the retained decision rather than only receipt/gen.
The Windows kernel peer foundation verifies held process/pipe identity and end
role, but does not enroll actors, qualify executables, revoke same-PID reconnects
or provide Complete inventory. A separate private Windows endpoint factory now
supplies protected current-user DACL, strict local addressing,64 KiB framing,
deadline/cancellation with actual I/O settlement and no replay. Runtime endpoint
activation, bootstrap/enrollment, support policy, actual port composition and
non-Windows peer support remain. A separate native channel now consumes the real
pipe and retains the captured SessionStore, mints fresh connection/actor epochs
and admits bounded expiring single-use challenges for exact scopes/steps. Opaque
work handles cover actual sync or awaited async settlement; transport closure
does not cancel effects, and unfinished drops remain unknown. Bounds are per
channel. Its private context is not the Host journal DTO or qualified actor grant.

Actual workspace buffer reports now own Buffers-lane admission before the report
gate through SQL/Host response and exact local ACK. Native nonce/payload/time is
checked before delivery and in confirmation CAS; same-millisecond replacements
cannot inherit an older ACK. Immediate schema upgrade preserves legacy rows.
Window-label row identity and compatible physical-owner recovery remain open;
this source accounting does not qualify a buffer checkpoint.

The executable's early private helper mode now runs before GUI/Store/provider
initialization. Strict64KiB framed stdio bridges actual private pipes. Separate
kernel current-image connect/accept does not weaken the existing exact owned-child
or current-process paths and does not qualify an executable/build/actor.
`host/native-authority/` provides Node protocol/client/global helper admission,
bounded queues/deadlines/backpressure and actual-exit retention without replay.
Private POST bootstrap now provides closed describe/register/lookup/status/retire
operations under the per-start administrative secret, loopback/no-Origin and
bounded body/admission. Every source result remains qualified:false. Windows
application startup retains the actual managed Store and selected profile,
discovers its private Host record and provisions a local protected helper grant
through an owned CLI/Windows Job. The grant binds raw executable bytes, profile
and generation; HTTP accepts only an opaque locator. Async ACL/hash verification
preserves Host responsiveness and actual child/file lifetimes. Source registration
uses a native nonce/epoch; a lost acknowledgement recovers through memory-only
lookup without replay. Status, retirement and application exit own actual IO and
helper settlement. Fresh construction UUIDs reject replaced Stores; no database
reopen or synthetic clone is used. Local transport permission is not supported
actor enrollment. Production authority-port/grant composition, complete producer
coverage, qualified migration and installed GUI acceptance remain open.

Registered sources now also expose an internal retained-snapshot reader with
closed open/chunk/close messages. It keeps exact UTF8 bytes, validates the actual
scope/fence and SHA256, decodes once, and distinguishes absence from unavailable
or corrupt data. Native SQL limits precede String allocation in one read
transaction. Both sides reserve at most two32MiB source-byte slots;16KiB chunks
share status/heartbeat ordering and one nonrenewable deadline. Process-wide Node
accounting survives module reload, and failure retains ownership through actual
helper exit. Returned immutable results belong to the trusted caller after close.
No public HTTP route, actor enrollment, Complete inventory or coordinator
activation follows from this read. Native test-only seeded fences are fixture
qualification only, never a production Complete constructor.

Native history conversion/SQL installation now use a versioned private target:
only HostSession is public; raw client draft/queue,13 retained Native tables and
record provenance stay journal-private. Source/fence consistency and full target
hashes are rechecked; a Native wrapper cannot silently use a bare target. The
critical journal validates callback immutability, ACK state and exact head after
installation before commit. Permanent retries preserve later Host edits. A fresh
native verification is required for private preservation reads. No production
supported-actor factory or coordinator activation follows from storage factories.

Native editor latest-draft backend is additive and local-only: actual physical
Window/Store owner epoch, required reload freshness, Buffers admission through SQL,
full revision/digest CAS, bounded quotas and metadata inventory. Save-reported
records retain payloads and do not prove disk save or release Host/buffer fences.
The current owner's new full capture may supersede old payload/ACK; retries are
database operations, never permission to replay a filesystem save. CodeMirror
producer, recovery content/UI, actual filesystem receipts and compatible legacy
local/Host reconciliation are still required. Legacy buffer namespace is intact.

Renderer `sessions/data/persistenceDrain.ts` now tracks actual accepted data work,
sticky failures and target/profile scopes. Session/draft services include queues,
blob/row ACK, import/rebase/repair and workspace/in-flight chains; scheduled draft
work is admitted before its debounce and accepted parent lineage is preserved.
Strict observation/flush APIs are separate from unchanged legacy quit/flush
behavior. HMR reuse retains pending prior hooks/jobs/failures and ordering.
Observations are always qualified:false with explicit missing native checkpoint,
mounted composer, provider output and full producer coverage. No producer closure
or native proof is claimed. A profile-wide native gate cannot enable target-only
migration while unrelated work continues without additional scope integration.

## Checks and remaining gates

Latest88-file checkpoint: production converter/SQL installer/private coordinator
and actual Native source/Host storage134/134 across6 suites. Current native
authority/source/bootstrap87/5ignored includes the new fragmented-HTTP fixture;
three default-parallel repeats87/5 passed after fixing accepted test sockets'
inherited nonblocking mode. Native latest-editor backend18, lifecycle18 and full
Store241/5 passed after the inventory accounting regression; normal Host/web
types, workspace/all-targets Clippy and binary compilation passed. Evidence:
`temp/verification/2026-10-28-native-target/ROOT-FINAL.md`. New journal verifiers
in integration remain explicitly synthetic; actual UI/actor/default acceptance
is not established. Previous75-file source metadata is archived, not overwritten
into a claim of whole-goal completion.

Previous source-association/retained-reader evidence is recorded in
`temp/verification/2026-10-28-native-retained-source/ROOT-README.md`: native86/5
fixture entries, Store241/5, Node reader80, real CLI5, actual isolated Native/Node
source interop1 and post-fixture HTTP119. Counts overlap. Three bounded native
default-parallel repeats passed after actual process-exit ownership was fixed;
unknown missed births stay unavailable. Normal Host/web types, Clippy, binary
compilation and headless863 checks passed. The12-file combined run retains its
307passed/2failed/1skipped provenance; the two startup-sensitive HTTP fixtures then
passed their full119 suite. No invented combined total or GUI/actor qualification.
Earlier results below are historical slices with their own source attribution.

Latest source registry: 3a32bdd78645 (131 methods). Final combined HTTP/WS,
deletion, Crew, Steward, Notes and dispatcher integration321/321 across16 suites,
including full HTTP119. Independent Crew retained-copy integration12/12 passed.
Exact artifact Native broker52/remote47 plus normal
scoped Clippy, mobile47 plus normal typecheck. Native store237 passed/5 ignored
of242; native lifecycle consumer17 and standalone barrier31 passed. New authority
ACK cases7 are included in authority38/1ignored and that store result. Windows
peer/pipe17/2ignored helpers passed under default parallel tests; normal Clippy
passed. A test-only global pending-I/O probe was replaced by budget-owned probes.
New private channel20 cases and native workspace8 cases passed on final source;
lifecycle17 includes two new Buffers-lane fixtures. Native store237/5 was rerun
after schema changes. Channel async fixtures cover pending work surviving channel
drop, and polled/unpolled owner abandonment staying unknown. Normal Clippy passed;
independent reviews found no remaining concrete defect. These fixtures do not
exercise an installed Tauri window/Host or qualified migration adapter.
Latest native helper/peer/pipe/channel suite51 passed/4 ignored fixture entrypoints;
normal Clippy and normal binary check passed. SessionStore237/5 was rerun after
managed-instance capture. A pre-review7-suite HTTP/WS/bridge run passed197;
final5-suite bridge run passed58, including45 Node/protocol cases,11 bootstrap
cases and two actual Node-to-Rust-to-Windows-pipe source fixtures. Independent
review's two Node P2s have failing/passing regressions: Proxy preflight bypass and
ready-after-real-exit. Final normal Host types and scoped lint passed. These counts
overlap; ignored native fixture entries are explicitly invoked by parent checks.
Three-process fixtures use the compiled unit-test executable and a fixture-only
prelude adapter, not the installed GUI binary. Host headless inputs now858;
schema131/hash3a32bdd78645 and53 domain boundaries are unchanged.
Renderer data296/296 across22 source/fixture files and normal Host/web types passed;
two independently found draft-lineage regressions have red/green evidence.
Independent reviews found no
remaining concrete defect in these frozen sources. Counts overlap
with earlier checkpoints and are not an aggregate total.
Normal Host/web tsc-rs, neutral/domain boundaries (53 files), actual in-memory
headless bundle (857 inputs, zero UI/React/CSS) and hygiene passed on 2026-10-28.
Rewind63 and file/checkpoint109 remain separate earlier focused evidence.
Notes4 methods additionally use the same storage worker/CAS/commit grant through
HTTP and WS; original outer expectedUpdatedAt remains required by its storage owner.
Task/Note/Goal/Automation/Steward/Crew retained bulk copies now fence actual committed
deletions before old descriptors or late captures can disclose removed rows;
Automation's existing run cascade is included. Final26 general bulk plus12 Crew bulk and7 worker cases
passed. Verified post-commit Note outcome and conservative unknown mutation
delivery passed39 domain/dispatcher/worker cases; shared policy/client contracts
passed112 across nine suites. Counts overlap. Already downloaded client copies
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
`c03fa98d4819494a53ebfa61ff74320105bd05fc`, branch main (2026-10-28). Other
writers' commits now include portions of prior source; this session did not stage
or commit them. Current131-method composition and later additions remain pending;
individual file inclusion must be checked. Package
version 0.6.94 is not an installed build stamp. Serving Host inclusion is unknown.

Plan/progress: `temp/local/2026-10-27-host-architecture-plan/`.
Full26-group source references/current evidence: `CURRENT-STATUS.md` in that directory.
Evidence: `temp/verification/2026-10-27-host-runtime-foundation/`.
W00-W11 details are engineering proposals implementing the quoted owner direction;
no new cloud/account dependency or operation authority is implied.
