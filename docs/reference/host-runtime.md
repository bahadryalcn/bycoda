# Host runtime and WebSocket migration

## Host server module architecture

`host/server.ts` is the composition root for `createHostServer`. It builds the
Host services, wires their shared bindings, and exposes the resulting server;
implementation modules live in `host/server/`. `bindings.ts` defines the typed
`ServerBindings` contract. Runtime modules accept narrow `Pick<ServerBindings,
...>` dependency sets, so each module declares which services it uses.

The composition root uses lazy binding getters for values produced by later
runtime constructors. This preserves existing forward references and service
cycles while keeping construction order explicit. Keep those references lazy
when moving a dependency; eagerly reading a later runtime during initialization
can observe an uninitialized value.

Async factories publish lexical getter objects into `runtime-slot.ts` slots before
their first await. An initialized local becomes available during its readiness
wait, while a later local retains its original initialization boundary. Do not
defer publication until all readiness promises resolve. Mutable heartbeat, closing
and observation state keeps lexical setters.

Runtime modules group session views, queues and leases; workspaces and projects;
conversation and management tools; assistant, social and mobile services;
devices, development, Git and voice; subscriptions and WebSocket setup; and
registry/HTTP composition. `registry.ts` maps typed Host methods to domain and
service operations. `http.ts` owns HTTP/RPC transport admission, request-scoped
authorization and response handling. Method-family dispatch should receive
typed dependencies, while transport authentication and authorization stay at
the request boundary. `lifecycle.ts` owns startup readiness and idempotent
resource shutdown; preserve cleanup ordering, in-flight request settlement and
late-start guards.

The refactor does not change wire methods, authorization ownership, HTTP/WS
route precedence, or shutdown semantics. Focused coverage remains in
`host/server.test.ts`, `host/server-websocket.test.ts`, and the owning domain
family tests.

## Execution and ownership

The current Host input path uses one shared in-process issuer across Engine and
the actual backend. Private operation handles cannot be restored from JSON IDs.
Normal writes and original cleanup have separate admission; both retain the true
accepted I/O lifetime. OpenCode HTTP views bind observed origin/session targets,
and auxiliary launch directories come from trusted backend creation/resolution.
This source work does not promote a default or complete raw/SSE/admin, Native
invocation, crash/recovery or installed acceptance.

bycoda attaches execution to the selected project's machine. A conversation is
identified by `(environmentId, sessionId)`. Opening it on another computer or a
phone does not move its provider process, workspace or history authority.

The Native warm-input layer gives each operation an immutable writer over the
same physical child. Native-issued bindings retain the original Live/output Arc,
window issuer, canonical target and turn behind a private bounded record. The
new strict bind/write commands fail on older runtimes rather than silently
ignoring extra metadata. Binding B waits accepted A writes and true callback
tails, then rechecks B's original source; late A never selects a latest turn.
Permission is revoked before finish waits. Uncertain byte work remains held,
independently of actual physical retirement or provider protocol acknowledgement.

RPC/ACP/Pi views share their original multiplexer and pending IDs. Registry
captures operation identity before deferral, records each actual construction as
it is selected and takes immutable source snapshots for cleanup. Queued steer
cannot inherit a failed predecessor, reach a replacement adapter or dispatch
after reentrant Stop. Manual compact/edit retain explicit account/app/lead
context. Local provider high-water guards are source matching rather than Host
run attestation. Native CLI/MCP invocation/final effect gates, unattributed/raw
messages, Host per-run writers, crash recovery and complete cohorts remain OPEN;
this layer is not full Native Buffers or migration qualification.

Native application access belongs to the original source-issued control turn and
the actual window issuer. Closing that window revokes its grants; revocation is
independent of physical process cleanup. A completed old turn can be finished
again without finishing the replacement. Fresh process construction accepts only
its captured control receipt, matching logical session, canonical directory and
original issuer. Later per-operation writes use the separate strict binding above;
process-birth authority alone does not authorize a new warm operation.

Original process cleanup records outlive current session routes. A targeted
cleanup can join the retained old process after its route closes without touching
a replacement. Missing records and uncertain cleanup remain errors. Admission
reserves bounded record capacity before stopping an existing process.

Host-to-desktop continuation keeps the settled original turn receipt after a
lightweight provider stays warm. Explicit desktop run-lease acquisition waits
for exact provider retirement; idle/busy flags and blocked task status do not
prove release. Codex's transfer hook refuses missing, stale or active ownership
and preserves the provider resume identity. Providers without that exact hook
refuse transfer and direct the owner to task repair. Heartbeats cannot perform
this transfer. The `sessions.host-writer-retirement.v1` capability makes desktop
clients retain unsent input on refusal, timeout or uncertain transport rather
than starting a second provider. A late grant is returned by its original epoch;
the abandoned request remains guarded until that return is acknowledged.
A late acquire refusal (`HOST_WRITER_RETIREMENT_PENDING`,
`HOST_WRITER_RETIREMENT_FAILED` or `LEASE_HELD`) confirms no lease was granted,
so a later owner attempt may query the Host again. It does not authorize a
provider start or replay the retained input. A transport failure or a failed
release after a late grant still leaves ownership unknown and guarded until the
run-lease TTL has passed, because this window never renews that lease. Desktop
acquire waits 25 s against a retirement-capable Host so the Host's 20 s
retirement window can answer first.

The provider retirement ledger retains captured handles and failed cleanup after
provider Live-map removal. Host activity release callbacks belong to the original
provider cohort, including optional title/branch work. Shutdown joins accepted
callbacks and reports their failures. Passive observation of a warm original does
not stop the next process. Repeated registry cancellation preserves its original
failed result; a session-name retry cannot establish new cleanup authority.

## Source implementation

The standalone provider guardian lives in `packages/provider-process-guardian`.
It shares Native's Windows job owner and has no GUI, Store or Tauri startup.
The Host's `provider-guardian.ts` adapter separates private control frames from
the provider's stdin/stdout/stderr. The original control channel and guardian,
parent and actual-provider construction identities bind each command. Provider
output cannot issue a terminal receipt. Async startup preparation has a final
synchronous check of its original Host attempt immediately before dispatch.

A Windows private terminal receipt follows actual leader wait, job drain and
joined accepted writer/output work. Natural leader exit also retires the retained
job so a pipe-holding descendant cannot strand the join. The ordinary failed
result of a completed stdin write remains a failed write; independent physical
retirement can still succeed. Missing birth coverage, process/job API failures,
lost IO work or a missing private receipt cannot prove retirement. Host lifecycle
retains an unknown original after route removal and refuses its replacement.
Other session owners are independent. This is not provider protocol ACK or a
complete all-provider/alias/activity authority cut.

The explicit `pnpm host:guardian:build --target win32-x64 --target-dir <cache>`
creates a hashed fixed local bundle under `build/host-guardian/<target>/`.
`host/package.mjs --provider-guardian` requires that matching bundle; an existing
valid default bundle is also included. The executable and bounded manifest are
checked before spawn without accepting a path from HTTP or looking in PATH.
Ordinary JavaScript builds do not build Rust. Missing optional bundles retain
the legacy JS guard and its limited evidence; invalid declared bundles refuse.
The selected packaged guardian currently supports Windows. The Unix runtime
reports unsupported descendant retirement and is not enabled as a stronger Host
contract. Surviving recovery after guardian loss, six-target release packaging
and installed application acceptance remain separate work.

Provider process startup returns the original backend's strict construction
receipt. Targeted stdin and kill compare that construction before selecting a
physical child. Clients create one handle before startup and retain it through
pending writes, replies and cleanup. A delayed operation for an old process
cannot be redirected to a replacement with the same conversation key. Native's
construction is its actual output stream epoch; the registry epoch and PID are
not substitutes. Old clients without a receipt must update before these actions.

Process output invalidation uses the same original construction. A missing
identity after an invoked start retains uncertainty even if output arrives later.
Explicit administrative shutdown and HTTP/SSE routes have separate semantics.
These checks do not prove provider consumption or complete OS descendant
termination. Unknown Native orphans and
logical retirement without a complete owner-bound cohort remain held rather than
being reported as successfully cleaned up.

Low-level stdin work retains its actual Node callback or Native writer thread.
A deadline requests a stop on the original owner; bounded callers can stop
waiting independently. Host replacement and shutdown also drain originals that
have already left the current route map. Exit codes and escalation timers do
not complete a missing callback or child-close observation.

Native command results and retirement evidence are separate. Valid stdout and
the original exit status remain available when descendant coverage is unknown.
Strict helper/mutation completion, Host activity and Native spawn reservation
release still require the original retirement evidence. Individual successful
stdin byte-I/O settlement is independent of process retirement. Actual Windows
capture or termination API failures remain errors, even after later queries
succeed; missing birth coverage cannot certify the whole tree.

Committed send/compact dispatch reacquires the database and session operation
owners, verifies the same accepted run and authority, and seeds provider state
from the current stored revision before releasing either owner. A delayed title
update cannot be overwritten by the older command snapshot at provider onset.

Native reminder commands and their process-owned timer claim actual Persistence
admission before SQL. A closed timer tick leaves due rows untouched and returns
to the same loop. An accepted tick retains admission through final notification;
failed reads/notifications cannot certify idle or replay a committed fired row.
The three SSH group configuration writers and Control's save/private scratch
commands use their actual caller boundaries too, preserving their original
permissions, lock order and atomic updates.

Notes image jobs create a fresh file, bound the actual opened-source stream and
sync its bytes before granting access. A failed copy/sync/grant returns its
original error without publishing a path or deleting an uncertain replacement.
These file-byte checks do not establish namespace/power-loss or Notes-row/image
graph durability. The Native Buffers lane still requires a complete native cut;
partial raw retention alone does not finish its second checkpoint operation.

Native Automation writes use the actual caller's global Persistence admission
before entering SQL. An admitted transaction and its notification retain their
original lifetime even if the observer stops waiting; the connection is unlocked
before notification. Event claims keep the original webview caller restriction
and recovery label. SSH runbook scalar writes and durable status recovery use
the same actual-caller Persistence path. Start captures its original admission
before review/proxy consumption or SQL; accepted background workers retain that
admission through final persistence and actual worker completion. Cached status
and cancellation control accepted work without requesting a new write grant.
Durable lookup errors propagate before credentials are consumed; missing rows
and uncertain recovery are distinct. These wired families do not qualify the
whole store or prove complete writer coverage.

The cross-process backend test uses the real Native Store schema and fence owner
with a separate Node process and production Host worker. It checks both closed
states, original queued commits, attested reads and exact retirement. The Desktop
lease controls also cover accepted/running preparation before actual provider
onset; command acceptance is not a provider-start latency promise.

Participating Host Notes writers now reserve their actual physical databases
before entering the serial queue. Each original retains its reservation until
its SQL connections have closed or its Worker has actually exited. A lost public
reply does not release ownership or authorize a resend. Read-only jobs remain
available during closure and attest the actual connection without a writer lease.
On Windows, the trusted SQLite extension checks the main HANDLE before storage
PRAGMAs or schema changes; existing post-lock authorization and CAS still apply.

Native preparation closes and drains these participating Host writers before
asking renderers to prepare. It then retains the existing Native barrier order.
A process-owned bounded keeper preserves original fences through hard errors and
coordinator replacement; observer cancellation and object destruction cannot
release them. Actual SQL and matching round retirement still control release.
Missing native admission is explicitly unjoined. A corrupt configured module or
a fault after joining holds protected work. This does not establish complete
writer coverage, Unix attestation or qualification; those migration gates remain.

Checkpoint preparation closes known Parent input callbacks and the mounted
source/merge editor roster before closing Composer and draining persistence.
Private tickets let work accepted before closure finish through its actual
acknowledgment. They do not admit unrelated new work. External updates are applied
and invalidate preparation. Cancellation and deadlines retain the gates until
the matching Native release acknowledgment; active IME is not forcibly committed.

The actual Native window supplies admission for text reads, writes and formatting.
Its blocking worker retains admission through completion even if the IPC waiter
is dropped. These known routes do not establish complete filesystem, attachment,
Notes, editor-alias, actor or provider conservation. Both complete Native lanes
and default migration remain gated on those separate obligations.

The Native checkpoint path now retains the exact bounded mounted Composer raw
capture beside its existing comparison. Empty and whitespace text are preserved;
own undefined attachment/MCP object members use separate presence paths. The
original prepare, physical window and session bind both byte strings. Actual
parent receipt and raw child commit in the same FULL transaction, with a private
transaction-local parent-insertion witness and independent retained-data quotas.
Missing initialized storage, changed payloads and conflicting receipts fail closed.

The v2 raw envelope also retains explicit Parent input and actual mounted
source/merge editor captures. Independent registry epochs and mount revisions
invalidate stale captures; accepted work remains represented through retirement.
Normal editing and existing draft queues continue. A callback exception preserves
unknown disposition and cannot authorize a resend. Private question snapshots
are separate from normal transient drafts and never restore or answer a question.

Exact editor ACK claims are compared with the actual Native owner, whole stored
metadata and exact text/EOL/baseline inside the same checked FULL transaction.
Missing or coalesced ACKs stay unverified. This validates captured rows only;
`rosterComplete` remains false, and Buffers/actor/FS admission proof is still open.

After an uncertain reply, a bounded read of the original retained artifact can
report data retention only. It does not replay the checkpoint, rebuild an owned
projection receipt, refresh a window/round or prove provider application. Reopen
inspection is a distinct historical data read preserving the old runtime identity.
This foundation remains unqualified: parent and Buffers producer coverage,
native attachment durability and full actor/input/writer closure are still open;
automatic historical migration and default promotion remain disabled.

The migration separates neutral contracts (`src/shared/model/host-contracts/`),
client policy (`src/shared/lib/host-runtime/`), domain services (`host/domains/`),
transport adapters (`host/transport/`) and native credentials/OS integration.
The current source includes environment, project/directory, session, queue, file,
pipe-terminal, Notes and nine explicit Git services plus command admission shared
by HTTP and WS. Other domain methods retain explicit
HTTP compatibility paths while their extraction and qualification continue.

The 20 internal Native workspace operations use a shared Host domain for turns,
activities, buffer reports, rewind and cleanup. Owner-bound ports close over the
actual issued workspace authorization; RPC fields cannot supply it. Platform hash,
base64, fatal UTF8 decoding and timer adapters remain outside the domain.

Native consumers use a process-lifetime workspace channel and guarded projection.
The recovery reader retains its narrower three-method scope. Local SQL consumes
actual replies only through a commit fence covering all relevant nested replies:
saved route, Native caller lifecycle, resource and bulk grant. Network waits remain
outside this fence. Generic window/mobile ingress denies native.* and raw
devServers.bridge* operations; ordinary cleanup routes retain their accessibility.
Development preview uses its dedicated process-owned WS gateway. Its listener and
streams retain the actual saved route, paired principal and exact SSH tunnel
slot/generation. Raw bridge methods remain inaccessible through generic ingress.
Response and bulk leases survive through the original browser socket write; short
admission releases global locks before IO. Retirement stops new admissions, while
already admitted bounded writes may settle on their original stream. Old-Host
HTTP compatibility is selected before dispatch and shares the original deadline;
a consuming read is never replayed after an interrupted WS result.

Model discovery and 16 Native helper operations now share owner-bound Host domain
services and canonical WS contracts (203 total methods, including private delivery
epoch operations). Helper RPCs use the finite
private `native.services.*` scope; scoped tools and social peer grants cannot mint
that owner. Terminal senders, desktop relay jobs, UI authorization and provider
grant renewal retain their original issuer. Social grants retain the returned
authority endpoint/environment, which may differ from the local issuer. Provider
tool forwarding keeps its scoped bearer/MCP protocol and does not become a paired
device call. Its bounded response admission is serialized with issuer/route
revocation, retaining the original principal through child socket settlement.

Five private service-upload methods carry large desktop finish/format requests.
They verify exact original JSON bytes, hash and target, and dispatch only those
two existing owners. The client uses one original upload identity and deadline;
ambiguous commits are not automatically replayed. Staging itself is in-process;
original delivery is tracked separately in the actual managed Native Store.

Nine existing public `devices.*` operations share a captured owner service over
HTTP and WS. Keeping their existing names also migrates the actual desktop panel
and mobile transport; no alias widens a scoped credential into an owner port.
Device queues and each subsequent Host-admitted OS command recheck their original
authority. An admitted third-party command may settle after waiter loss; later
Host commands stop on revocation. Fresh frame cache publication occurs only after
the final authority gate inside the original device lane.

Preview jobs retain immutable input, actual principal/environment/owner namespace
and original deadline. Inline disclosure and every bulk chunk recheck both current
and original authority. Evicted snapshots and active chunk/body admissions stay
charged until actual IO settlement. Native relays also retain both original
desktop issuer and paired target through UI waiting and final result forwarding.
Their original grant deadline survives decoding independently of the RPC wait
budget. Expired/retired results are withheld; only an unknown-outcome error may
return to the still-live original issuer. Desktop route changes preserve that
uncertainty and the separate preview operation identity, without stale frames or
automatic repeated input. Native raw recovery/workspace/helper methods remain
inaccessible through generic ingress.

Device setup/stop and the three existing mobile-preview operations also share
this owner domain. Their finite method lists stay separate from the exact nine
Native Host-tool operations. Setup retains explicit agent-control consent and
pinned installs; authority checks reach stage writes and cache promotion, with
rollback limited to the exact invocation's preserved cache. Stop keeps
unconfirmed owned resources tracked for disposal, whose cleanup remains owned by
the process. Mobile preview keeps its original token/project namespace and cwd
continuity; it does not require a live Desktop snapshot to execute on a headless
Host. Project registration is not proof of Desktop UI visibility; complete
Host-owned project/privacy provenance remains separate work.

Terminal and device-preview receipts use a ten-minute monotonic retirement
window only after their own settlement proof. Before deleting an exact receipt,
the Host records its authority/request key in a fixed-size, process-lifetime
fence. Fence matches refuse execution (including possible false positives);
saturation refuses new resource admission. This is not durable cross-restart
idempotency. Live, pending and unknown effects never expire to make room.
Terminal history is bounded separately from live capacity, and physical close
plus successful activity-lease release proves terminal retirement. Device
previews settle on a confirmed ready result or read-only preflight failure;
failures after setup begins remain uncertain. Receipt expiry does not tear down
device resources. Original authorization is retained for replay and checked
again after delayed authorization before screenshot disclosure.

Conversation browser previews apply the same receipt fence to verified results
and read-only status failures. Requested panel presentation must also be verified
before settlement. Unknown claim/navigation/presentation outcomes retain admission
slots, including after token revocation; revocation cannot erase evidence and
authorize a retry. Natural token expiry cannot supply a result through a newer
authorization callback. Ten-minute receipt retirement is lazy on later requests
and never closes the user's browser page.

Text workspace retirement follows the issuing run, all accepted grant-wide
preparations and every observed physical child completion. Finishing a run alone
does not revoke its live child access. Proven retirement revokes the grant;
cleanup moves only its exact owned temporary directory to a unique same-root
candidate and rechecks identity before removal. Failed or uncertain cleanup keeps
the candidate and capacity slot for retry. Node pathname operations still cannot
exclude every uncooperative same-user path or child-entry swap.

HTTP and WS preserve known pre-admission rejection versus an admitted device
operation whose outcome cannot be confirmed. The HTTP compatibility path reads a
bounded rejection envelope before classifying device401 responses, preserves
explicit unknown delivery and never retries capture as a read. Incomplete or
oversized effect responses are uncertain. The Native typed IPC path also
preserves known envelope identities and uncertainty if its final saved-route
check fails after receiving an accepted reply. No command receipt is invented.
Scoped tool adapters, other auxiliary domains, exhaustive original-input coverage and
installed cross-device acceptance remain separate work.

Buffer updates larger than a WS frame use five bounded private upload methods.
The Host verifies exact original bytes/hash before dispatching the original update
once. The Native registry retains the same upload ID across new channels, preserves
unknown commits, and removes an intent only after successful local consumption.
Authenticated missing staging can restart under that same ID only before any
possible commit. A single absolute budget covers staging/admission/send with a
reserved status window. Upload state is in-process; original identity and outcome
are retained separately as described below. Crash/authority qualification remains
separate work.

The actual Native buffer producer and finite desktop finish/formatter client
journal complete first request bytes in their managed SessionStore, including
requests small enough to send inline. A private original identity binds method,
selected route and exact bytes/hash. Physical buffer owner/nonce/version and the
original finish job determine semantic identity; independent format invocations
remain independent even with identical input. A restored or possibly dispatched
original can query status only. Neither an absent receipt nor a lost connection
authorizes resubmitting its effect.

Five private delivery methods use `native.buffers.delivery.v1` and
`native.services.delivery.v1`. The Host records critical intent before effects.
Buffer outcomes require matching proof in the actual current/archive filesystem
projection; status performs no writes or clock changes. Native records and ACKs
the exact result using FULL transactions under original/current response gates.
Current buffer confirmation and original ACK share one transaction. Recovery
does not mark an old physical report fresh or recreate its former owner.

Large requests stage the unchanged original params up to16MiB. Service outcomes
above the inline threshold use bounded result.read chunks, preserving the32MiB
result limit, exact hash/length and all original resource/revocation guards.
Finish receipts prove handler-result recording, not final requester consumption;
formatting is never rerun solely because its response was lost. Host receipt
payload retirement now has the separate finite ACK lifecycle below; exhaustive
writer/input coverage remains open.
Filesystem temp-file sync/rename does not prove parent-directory power-loss
durability. Process-restart fixtures do not qualify installed/default authority.

Once Native guarded consumption and its local FULL ACK commit, a metadata-only
outbox can send `native.buffers.delivery.ack` or `native.services.delivery.ack`.
Separate `.delivery.ack.v1` capabilities preserve older delivery catalogs. The
Host compares the immutable original and canonical consumed-result digest, then
critically retires result/proof bytes and their capacity reservation. It retains
the original/digest tombstone: a duplicate apply or ACK never repeats the effect.
Lost ACKs and failed local completion markers retry only this idempotent cleanup.
An unknown service original cannot be retired; buffer retirement additionally
requires its same verified current/archive proof. Retired status carries no
payload and changes no source freshness or execution owner.

New formatting reserves 4 MiB before invoking its handler, matching the enforced
serialized formatter output bound. `native.services.workspace.format.bounded.v1`
advertises that bound; Native keeps the original 32 MiB allowance for older Hosts
and retained legacy originals. The Host format pool remains 64 MiB globally and
32 MiB per principal; tiny fixed buffer/finish outcomes use their bounded metadata
row allowance instead. Native admission separates bounded formatting, legacy
formatting and control reservations: 64 MiB, 128 MiB and 128 MiB respectively,
including retained request bytes. Each lane admits at most 256 active result owners;
the existing 65,536 total-row bound remains shared. These are reservation ceilings,
not allocations of that much physical memory. A proven unavailable result no
longer occupies an active result slot; its original request bytes and total-row
slot remain charged. Unknown originals without that proof still occupy active
slots. Exhaustion rejects before the effect.
Consumed digests are stored separately from raw chunk hashes, so ACK does not
materialize a retained 32 MiB result. Immediate Native cleanup has a 250 ms budget and
cannot turn successful consumption into an error. Its receipt proves guarded Rust
handoff, not receipt or application by JavaScript. Epoch compaction below extends
that lifecycle; unknown-outcome resolution and target-platform power-loss
acceptance remain separate full26 work.

A format status may carry `resultUnavailable: true` only for an exact retained
unknown original whose Host result reservation has been durably released and
whose result cannot subsequently be recorded. Native verifies that original and
the qualified Host under its response guards, then records an irreversible local
result fence. Only the reserved result bytes are released; request bytes and
unknown/no-replay identity remain held. This is not proof of successful or failed
formatter execution, physical process retirement or permission to replay it.

Recovery may discard a verified recorded formatter result only after its original
live caller and unconsumed reply have relinquished ownership. Discard uses guarded
local acknowledgement and the existing remote cleanup outbox; it never applies
the old text to a current editor. An active caller's result remains protected.

The actual Host now retains buffer report bytes, archive parts and completion
proofs in its critical FULL SQLite owner. These reports contain file paths,
dirty/unknown state and Native provenance; they do not add unsaved editor text.
Content-addressed bounded chunks preserve exact legacy BOM/whitespace. A staged
mutation publishes its source/archive dependencies and proof in one critical
completion before ACK; clock reservation is a separate earlier FULL commit.
Unknown completion remains queryable without re-running the original handler.

Process startup retains legacy current/hold reports and independently recoverable
catalog metadata, validates complete clock chains including reserved gaps, then
adopts SQL floors. A known exact current body can survive an incomplete matching
legacy archive through an immutable raw fallback, while conflicting headers stay
held. Once adopted, report and catalog reads use SQL only and never repair files,
rebuild counters from snapshots or restore Native owner freshness. Directory
metadata uses indexed bounded views, including concurrent legacy imports.

Filesystem copies are preserved legacy inputs. Backups/restores must include the
coherent Host database; copying those old JSON directories alone no longer backs
up newly retained reports. Compatibility with an older Host binary that lacks
this storage format is a separate downgrade/restore acceptance gate. File-backed
SQLite rollback/reopen and cache-deletion fixtures are not physical power-loss or
installed-platform acceptance. Actor/writer qualification remains disabled.

The delivery journal also owns the single admitted effect continuation. If that
handler or result-record await exits with failure, only its captured admission
winner can release the now-unneeded result reservation. The exact original and
planned buffer proof stay retained, and status remains unknown unless an actual
recorded result or verified buffer source proves otherwise. A zero reservation
fences every later result write for that unknown original. Failure bookkeeping
cannot overwrite a committed recorded/retired result after a lost COMMIT reply.
After authorization loss it uses only the existing process-owned recovery
bookkeeping path; result disclosure and ordinary effects remain denied.

An active handler, duplicate, lost admission ACK or process-crashed original has
no observed winner-continuation exit and keeps its reservation. This does not
resolve whether the external work happened. Metadata is not age-pruned: the
legacy UUID originals remain retained. New complete catalogs support the v2
epoch and semantic-origin fences below; unknown originals still cannot be
compacted or treated as failed.

### Host-issued delivery epochs and semantic retirement

Four finite private methods (`native.delivery.epochs.open`, `.status`, `.compact`
and `.close`) require `native.delivery.epochs.v2`. The authenticated Host issues
the owner UUID and global generation. Native persists its deterministic
Store/profile/route opening intent and allocates ordered originals as
`nd2:<owner UUIDv4>:<generation>:<sequence>` in FULL transactions. Structural wire
schemas are losslessly generated for both clients; owners separately validate
counter relationships, exact identity, authority and current route.

First open establishes an irreversible minimum-v2 floor for that principal.
Fresh legacy journal inserts and deliveryless buffer, finish and format effects
then fail before execution. Existing legacy status/results/ACKs remain readable.
Only the actual successful v2 admission's private, live execution context passes
the helper effect gates. A saved receipt or asynchronous callback after that
context exits cannot obtain this authority.

Compaction covers at most32 contiguous sequences across all three helper kinds.
Every position must be genuinely retired with matching consumed metadata; missing,
unknown and merely recorded positions stop the prefix. Host advances its permanent
floor and deletes those receipts in one FULL transaction. Status/apply below the
floor returns explicit `fenced`, without a result or fabricated consumption.
Global counters commit to complete retained header/witness coverage; missing
initialized rows cannot mint another epoch from a repeated open intent. Closed
streams are terminal and do not automatically rotate or close another peer.

Native independently requires local acknowledged originals and matching remote
ACK sidecars. Before deleting originals it commits exact semantic retirement
markers and its own floor in the same FULL transaction, under actual saved-route
and response gates. A Host floor alone never proves Native consumption. Markers
block old semantic identities before another UUID or sequence allocation; SQL
guards also reject older writers and replacements. Marker storage is separately
bounded to1m rows/128MiB weighted bytes, with no eviction. Exhaustion preserves
original rows and holds cleanup. Host header limits are65,536 globally/4096 per
principal; Native route intents are limited to1024.

This does not fence an older Host binary that performs bare external effects
without these gates, or prove arbitrary coherent two-store restoration. Retained
marker scans and FULL writer-lock scaling require target workload acceptance.
Qualification, history migration and default promotion remain disabled pending
the remaining full26 requirements.

Local projects now expose an explicit **New conversation on this computer's Host**
project-menu action. It connects to the actual local profile Host, verifies its
environment and managed-create capabilities, opens the project and journals the
new shell's explicit Host owner before opening the tab. The first send uses the
existing durable create-and-first-turn command. The project's real local cwd and
selected worktree remain separate from `(environmentId, sessionId)` ownership.
Ordinary local creation and existing Native conversations retain their current
execution path; this opt-in does not migrate their history or change the default.
An empty Host shell is already bound to its project. Project navigation opens a
fresh ordinary session for another project, and Native-only directory/branch/
workspace callbacks cannot retarget or reset the Host shell.

The shared `session-execution.ts` policy is used by the owner-routed desktop
adapter. Closing or aborting a waiter does not stop accepted Host work. Its
binding journal stores shell metadata without Native transcript blocks; Native
save, adoption, queue and shutdown paths exclude these Host-owned shells.
Generation updates cannot replace a pinned owner, regress a known generation or
reopen a deleted binding. Pinned requests also verify the actual Native saved
environment before dispatch, independently of the renderer's machine cache.

Native profiles migrate binding and outbox evidence to versioned SQLite storage
after verifying the native effect guard. Original legacy bytes remain recoverable;
only unchanged, durably backed-up localStorage mirrors are removed. New admissions
refresh canonical ownership, and compact receipts require an authoritative value
reread. Browser storage retains its separate adapter. See the
[native storage epoch contracts](../../.agents/skills/feature-host-runtime/references/storage-epoch.md)
for migration, owner retirement and the recorded compatibility decisions.

Host sessions obtain models and optional Codex/Claude account choices from their
Host. Owner-only `models.list.accounts` contains bounded safe IDs/labels, never
Native desktop account IDs or credential contents. Canonical configure accepts
an omitted account to preserve it, null to clear it, or a validated Host account
ID. Changing accounts clears the old provider thread and preserves transcript
handoff. Scoped Conversation Tools do not receive the account catalog.

`/ws` uses the `bycoda.rpc.v2` subprotocol and an authenticated paired-device
Authorization header. Browser Origins are rejected. `connection.hello` verifies
the expected environment and advertises only actually routed capabilities.
The composition exposes session reads, command dispatch/status, logical
subscriptions, queues, files, pipe terminals, Notes and explicit Git operations.
Each method requires both an advertised route
and its explicit capability family; schemas alone never enable a route.

`transport.ws.terminals.command.v1` adds one-shot `terminals.create` commands.
`command` carries at most 10,000 source characters; `shellKind` selects `powershell`,
or `posix` from installed profiles. An explicit incompatible `profileId` is
rejected. Creation receipts include source and shell kind, so retries never run
changed code. The owned shell runs source as a command argument; `terminals.read`
reports exit only after the guardian exits and captured output drains. Clients
must require this capability before offering command execution on an older Host.

Live streams send a complete baseline followed by revision-bound deltas. A
consumer acknowledges only after its guarded application commit. Gaps, invalid
bases or bounded replay exhaustion request a fresh baseline. Reopening a logical
stream does not start another physical connection or stop provider work.
Committed deletion invalidates replay, pending snapshots and bulk handles; clients
must fence in-flight application before handling a stream's closing notification.

Authority commits request a new baseline even when transcript revision stays the
same. Project resnapshot and session deletion retire retained collection copies.
Desktop/mobile resync controls bypass an obsolete bulk/application wait; old work
keeps its resource reservation until it actually settles and cannot apply or ACK.

Large payloads use authenticated, environment/principal/resource-scoped bulk
descriptors with SHA256, expiry and bounded chunks. A snapshot is at most 32 MiB;
unsupported larger histories require an explicit alternate/rescue path rather
than truncation. Clients validate bytes before domain parsing and cursor ACK.

Requests, authentication jobs, sockets, service work and outbound buffers are
bounded. Ordinary reads and control operations have separate admission capacity.
Actual backend work stays charged until settlement, including I/O that ignores
cancellation. A command response deadline or client detach loses only the wait:
accepted work retains its command ID, is reconciled through its receipt, and is
never automatically replayed with a new identity.

Authentication and heartbeat work have their own bounded admission lanes. A
positive authentication rejection blocks the connection; temporary storage or
admission failures retain retryable unavailable/overload outcomes. Renderer
controls use eight physical slots and a FIFO of at most 64 waiters, independent
of ordinary reads. One monotonic response deadline covers startup, queue wait,
request and bulk decoding. Local cancellation releases a wait, not the physical
control slot. The native reconnect queue retains only never-sent requests with
their original deadline, owner and resource scope; dispatched mutations are
never queued for replay.

Native reconnect resumes retained subscriptions only from proven application
commits, exact live page issuers, logical targets and resource scopes. A complete
membership cut from the retired connection permits shared streams to resume from
their minimum committed cursor. Returning members never receive replay they
already committed. Absent members retain bounded replay/backpressure state for
at most ten seconds, without event disclosure or physical request slots. Missing
proof, changed membership, replacement pages, gaps, invalid epochs or expired
rejoin waits require a fresh baseline. Renderer cursor input alone never proves
application or authorizes an ACK.

File mutations retain the existing workspace confinement, serialized content CAS
and editor activity owner. They recheck the authenticated grant inside the actual
filesystem mutation queue. Files and queue operations without durable command
receipts are never automatically retried; reconcile their current state first.

## Desktop and mobile adapters

The Rust broker owns saved device credentials, verified TLS/SSH routes, physical
connections, reconnects and generated wire-schema validation. Tauri exposes
scoped attach/request/cancel/bulk/detach operations and generation-tagged events.
The shared runtime owns logical demand and guarded application; it creates no
renderer socket or bearer. Legacy calls select compatibility before sending when
the Host capability or canonical parameters are unsupported. A sent or uncertain
command never falls back to a second transport.

The three Native-profile recovery queries use a separate Native-lifetime broker
pool over the same WebSocket broker and wire policy. Only the actual saved local
profile's loopback route can enter that pool; generic window and mobile callers
remain denied. Window detach cannot retire Native recovery work. Saved-route and
reply guards, including bulk reservations, remain held through recovery decoding
and final projection checks. Discovery and unsupported old-Host capabilities may
select HTTP before dispatch. A dispatched WebSocket failure never replays on HTTP;
the HTTP compatibility reply receives the same saved-route projection guard.

Mobile has a separate repository and local Expo Android/iOS module. New WSS
traffic uses native credential handles, a paired CA's DER-SPKI pin, normal
hostname/expiry validation and a single TypeScript reconnect supervisor. Mobile
LAN enablement starts a restricted TLS ingress forwarding only WS and bulk to
the authenticated loopback Host. The existing encrypted-LAN/HTTPS discovery
path supplies authenticated public CA bootstrap metadata; its legacy JavaScript
credential handling remains an explicit compatibility exception. Native module
source and autolinking discovery do not establish a successful native build.

Mobile activity streams currently cover the first 32 mounted project demands;
additional groups and unmigrated domains use bounded HTTP compatibility. Web
browser tickets, CA rotation and full native lifecycle acceptance remain open.

Mobile's actual session list/page/sync and command dispatch/status calls share the
common execution client. Its wire snapshot adapter supports React Native without
a global structuredClone, and detaching an admitted waiter preserves its receipt
identity. Both TS policy and raw Android/Swift socket sends reject private Native
desktop and raw development-gateway operations. Generated root android/ios outputs
stay ignored while maintained
socket-module source remains visible. Native compilation/physical acceptance is
still required; source discovery and TypeScript checks are insufficient.

## Durability and authority

Desktop-owned Stop, approval and question-answer requests use a durable Host
receipt plus an immutable delivery row in one FULL transaction. Admission binds
the original principal, command payload, session, page and turn. An offer is
marked `offered_unknown` before its payload enters the heartbeat response; a lost
response is never reoffered. Heartbeat ACK records handling by the original
client/page, not provider completion. Host restart retains accepted/unknown rows
for status but cannot automatically offer them from a new process incarnation.
Generic receipt pruning and generic execution cannot erase or reuse these IDs.
The finite receipt capacity refuses new admission when full.

The native page token is a routing guard, not an execution grant. Receivers also
capture original child/control handles before the heartbeat and recheck them
after page verification and immediately before the existing control dispatch.
Changing the session route cannot redirect an old command to its replacement.
Missing original ownership proof holds the action; it cannot authorize a fresh
target or replay. Matching Host and desktop protocol support is required.

Orchestrated stops capture the run incarnation, active dispatch IDs and original
lead/worker stop handles before awaiting persistence. Revalidation after each
asynchronous boundary prevents a replacement run from receiving the old stop.
Native control grant capture and disable compare the original grant generation
and exact window issuer atomically; completion cannot revoke a newer grant.

Critical Host transactions select SQLite FULL durability before BEGIN; routine
stream checkpoints use their own policy. A persistence fault blocks new durable
admission until explicit validated recovery. Provider effects recheck admission.
Committed-change notifications never publish rolled-back writes.

`environment.persistence.status` reports sanitized storage admission state;
`environment.persistence.recover` performs an explicit, single-flight integrity
and write probe for recoverable faults. Neither endpoint guesses that failed
storage is healthy. Verified live Stop can reach the running provider during a
write fault; a missing durable receipt is reported as unknown delivery.

`host/storage/authority-journal.ts` stages immutable raw UTF8 source and converted
target snapshots. Permanent, generation-bound terminal decisions choose exactly
one of Host activation or abort. Actor/challenge verification is mandatory;
serialized safety booleans are not native proof. Acknowledgement also requires
proof that native storage durably applied the exact decision digest. Missing
proof fails closed. Existing target sessions are not silently overwritten.

Native authority-floor, old-writer SQL fences and execution reservations now
implement these contracts. The source coordinator reconciles permanent decisions
across interrupted steps; its real authenticated native adapter and supported
launcher/window inventory are still unqualified. Historical migration and a new-local-session default switch
remain disabled until the trusted coordinator, writer inventory, window flush,
provider resume, coherent two-store backup/restore and downgrade gates pass.
Active native sessions continue under their existing owner during development.
Host-only snapshot/staged-restore helpers do not prove that two-store contract.

Native SessionStore now registers before its first writable SQLite open. Its
identity uses the canonical database and physical file identity, independently
of executable path or launch arguments. Kernel leases follow every cloned writer
connection, including provider reservations. Query handles are genuinely
read-only. A native inspection excludes new registrations while held; existing
live writers continue and must be coordinated separately. Live and unleased
records never imply a complete process roster or process death. Coverage remains
`Unknown`, including older binaries that never registered. Native OS start
identity is recorded where implemented; missing identity stays unknown.

Physical native windows also have one lifecycle slot and destruction listener.
Page starts replace their exact incarnation without accumulating listeners;
delayed callbacks cannot overwrite or remove a replacement with the same label.
Native write/checkpoint leases distinguish closed admission from qualification
taint. Failed or abandoned work prevents migration proof while ordinary open
work and successful committed results remain usable. Temporary admission
saturation recovers when tracked work/windows settle. These source hooks do not
certify renderer drafts or complete native persistence instrumentation, and do
not enable migration, change support floor or launch a new executor.

Fourteen core persistence commands now acquire a lease from their native-injected
physical Window before Git/SQL work and retain it through the actual result. This
includes draft-list expiry deletion, in-flight read-and-clear, full/imported
sessions, queue/draft/workspace saves and incremental transcript deltas. No
renderer token or same-label replacement supplies the owner. Missing/stale
tracking atomically taints qualification while preserving ordinary open writes;
an already closed gate rejects before effects. Accounting failure never replaces
the actual committed value or source error. Provider workers, control, explicit
rewind, startup, filesystem and renderer buffers still need instrumentation.

Read-triggered rewind reconciliation in native get/page now holds an exact
Window operation for its effects; a closed gate still permits the retained read.
FTS indexing has a separate process owner. Its queued lease survives thread
creation, delay, parsing and actual settlement, and SQL admission is checked again
immediately before the index transaction. Closing admission defers unstarted
index writes without losing dirty rows or poisoning search results. Process work
is not assigned to a Window and cannot disappear when a requester closes.

Workspace buffer reports now hold the actual Window's Buffers-lane admission
before waiting for the report gate, through SQL, the actual Host response and
local confirmation. A native-generated report nonce plus exact payload/time is
checked before delivery and in the confirmation CAS, so an older response cannot
confirm a replacement row from the same millisecond. Schema upgrade serializes
column inspection and preserves legacy dirty/unknown rows. The legacy Window-label
row namespace remains; physical row ownership and compatible recovery are still
required before treating this as a qualified buffer checkpoint.

Native application acknowledgement reads the actually stored Host decision bytes
through one SQL snapshot. Fence, source store/profile IDs, decision digest,
terminal journal and current floor must agree. Verification alone is not an apply
receipt. Idempotent apply also checks the saved decision; it cannot silently heal
a missing receipt or replace a different decision with the same receipt ID.

The private Windows peer identity module verifies kernel pipe-end/PID and held
process start/image/user identity. It is not an enrolled authority channel or
supported-executable policy. Same-process reconnect requires a separate channel
epoch and challenge invalidation; peer identity alone does not provide it. Other
platforms remain unsupported by this new identity capability until implemented.

The separate private Windows pipe factory now creates protected current-user
endpoints with strict local addresses and kernel peer verification. Control frames
are bounded to64 KiB before allocation. Partial/error operations close the
connection without replay. Overlapped cancellation retains its event/buffers until
actual I/O completion; the deadline bounds the cancellation request, not a promise
that kernel cleanup has finished.

A separate native channel consumes that real connection and retains the actual
SessionStore. It mints fresh connection/actor epochs and bounds single-use,
expiring challenges by exact source, environment/session/migration/generation and
coordinator step. Matching is atomic and comes after actual peer-checked reads.
Transport errors revoke pending challenges without cancelling accepted effects.
Opaque work handles remain owned through synchronous or awaited asynchronous
settlement; unfinished drops remain unknown. The64-slot budgets are per channel,
not a process-global reconnect budget. This private context is not the Host
journal request DTO and cannot supply its qualified nativeActorId. Actual Node
adapters, enrolled actor/context projection, executable support, global admission,
verified-decision handles and runtime activation remain separate work.

The native executable now handles `--native-authority-helper` before GUI, Store,
provider or control initialization. It bridges strictly framed bounded stdio to a
real private pipe. Separate current-image connect/accept policies obtain actual
peer identity from the kernel; exact owned-child/current-process APIs keep their
previous behavior. Image matching provides no supported-build or actor grant.

`host/native-authority/` owns the strict Node protocol and child client. Its
process-wide helper budget and per-runtime/queue limits remain charged until
actual exit. Startup, cancellation, framing, backpressure and shutdown never
replay work. Delivery classification describes a helper command, not domain
admission. Proxies are rejected before serialization; known-exited helpers cannot
become ready from delayed stdout. The helper executable must come from trusted
installation composition, never a registration request or renderer path.

A separate `/native-authority/bootstrap` private POST, composed by the Host CLI,
accepts closed describe/register/lookup/status/unregister requests under its
per-start administrative secret with no Origin and a loopback peer. Bounded
bodies/admission/deadlines expose the actual initialized Host environment and
qualified:false. Accepted work survives an abandoned HTTP waiter; shutdown awaits
its settlement and actual helper exits. Lookup is memory-only and cannot renew
the source or prove that a domain operation was never admitted.

The Windows application now captures its actual Tauri-managed Store and selected
native profile in a background lifetime owner. It reads that profile's private
Host discovery record, runs a bounded owned local CLI to provision a protected
helper deployment, and registers a one-shot kernel-checked SourceEndpoint. The
native manager and private construction UUID reject replacement even when durable
Store IDs match. Registration recovery queries the original nonce without replay;
status and retirement retain the same native epoch. Application exit cancels the
endpoint and joins actual work. Missing Host capabilities leave normal use available.

Helper selection accepts only an opaque deployment locator, never an HTTP-supplied
executable path. The local CLI binds the selected Host/profile, canonical executable,
raw SHA256 and a fresh generation; asynchronous ACL/file verification retains the
actual opened file through startup validation. Bounded spawn-time metadata checks
do not synchronously hash files or run PowerShell on the Host event loop. The
native provisioning invocation owns a separate Windows Job and reaps its own
descendants before releasing its IO lifetime. A local deployment grants transport
permission; it does not authenticate a supported actor or complete writer coverage.
Production actor/context projection, authenticated authority-port composition and
qualified migration remain incomplete. Installed GUI startup is separate acceptance.

The registered source also supports a trusted internal retained-history reader.
Closed open/chunk/close messages bind its existing source epoch, increasing request
IDs, session/migration and actual retained fence. SQL byte bounds are checked in
the same read transaction before loading strings; an absent retained record is
distinct from corrupt, oversized or unavailable data. No read creates a floor,
fence, quiesce request or decision. The reader transports exact UTF-8 bytes in
16 KiB base64 chunks, checks their SHA256, and decodes UTF-8 once. Each export is
at most 32 MiB, with two process-wide fixed reservations of 32 MiB on each side;
that is a source-byte budget rather than a total heap/RSS limit. A single deadline
is not renewed by chunks or heartbeats. Accepted work owns its serialized source
lane and reservation until explicit close or actual failed-helper settlement.
Successful immutable results become the trusted caller's responsibility. This
reader has no ordinary RPC/HTTP route and remains qualified:false; a historical
fence's claims do not enroll an actor or activate a migration coordinator.

Historical Native snapshots now have a production deterministic converter and
SQL-only target installer. A versioned private target separates `hostSession`
from `nativePreservation`: exact client queue/draft data, retained Native SQL rows
and raw record provenance stay in the immutable journal alongside source bytes.
Normal session reads and events receive only the public projection. Native sources
with private state cannot use a bare target that omits that envelope. Conflicting,
ephemeral, unsupported or oversized inputs block conversion rather than selecting
a different provider policy or discarding fields.

The existing critical journal transaction installs the target only after native
verification, staged-byte checks and exact head/generation CAS. The production
installer rechecks the registered project and conversion, then uses the normal
Store writer. The journal rechecks its immutable body, acknowledgement flag and
current authority head after the callback; a violation rolls back target, journal,
cache and outbox together. Terminal retries return the permanent decision without
overwriting later Host work. Private preservation reads require fresh native
verification. Supported actor/port composition remains mandatory and unimplemented;
isolated verifier doubles in storage tests do not enable runtime migration.

Native editor latest-draft storage is a separate additive backend. Five local
Tauri commands open a native owner epoch, capture/read the current owner's latest
document, report a revision-covered save, and list recovery metadata. Ownership is
bound to the actual Window resource incarnation and Store construction UUID;
required epoch matching also rejects first writes queued across a page reload.
Buffers admission lasts through actual SQLite settlement. Revision/digest CAS
preserves newer edits, with bounded per-document/profile storage and no eviction.
A save report retains the full payload and is not independent disk-save proof or
permission to retire a local/Host fence. A newer full capture may supersede it.
CodeMirror producers, recovery content/UI, verified filesystem receipts and legacy
buffer reconciliation still need integration; existing legacy rows remain intact.

Renderer session/draft services now account accepted work before timers/awaits,
including coalesced writes, blob storage, repairs and separate workspace/in-flight
chains. Migration-specific strict observations retain failures that legacy tails
intentionally catch. Only confirmed full replacements/equivalent receipts recover
them; partial delta success alone does not. Late target edits invalidate an
observation while ordinary work and unrelated sessions continue. Module reload
keeps accepted work, prior pending hooks and failure history in order.
These observations explicitly remain unqualified. Original Native output items
now retain opaque event/work ancestry across tracked asynchronous provider
consumers, timer callbacks, questions and edited-resend replay. Actual accepted
session-model versions bind those origins to covering ordinary transcript save
acknowledgements. An unknown write requires a later covering full replacement;
a delta ACK alone cannot clear it. Pending snapshots coalesce, old-lifetime ACKs
cannot apply to a replacement session, and late submission callbacks cannot
commit events into a newer turn.

Before a persistable local desktop provider starts, its real conversation save
must acknowledge. An optional logical-session locator then lets Native bind the
unchanged routing ID to the actual existing row. Native retains the original
Store instance, physical producer and private SQL row-incarnation token; a
same-ID delete/reinsert cannot inherit the old binding. Public metadata is not
an operation grant. Final routed events identify their actual physical recipient
separately from the private original producer.

Normal save ACKs do not establish FULL SQL durability or exhaustive provider
input conservation. Application watermarks remain null. Initialization/config,
exit/cancel/late unknown-delivery paths and additional or multiple-input ancestry
still need closure. The private selected-Host source channel now initiates an
on-demand Native prepare/challenge coordinator with actual window receivers.
Its atomic input/write/FULL observation remains unqualified: true producer
closure, application conservation and actor/port qualification are separate
requirements. No execution default or support floor is promoted.

Original output comparisons now include the immutable original batch and
zero-based item index. Native independently matches actual retained recipient
enqueue outcomes and bounded per-item commitments, returning a private
nonserializable eligibility handle only for a sealed stream. That handle does
not certify a reducer or a covering SQL write.

Renderer candidates retain exact accepted-model versions and the same immutable
sanitized payload actually sent to the save service. Native full/delta commands
optionally capture a comparison receipt inside their real transaction and
publish `nativeWriteId` only after commit. The Store-local ledger binds the ID
to Rust-normalized input, actual ACK, private row/Store/physical owner and the
ordered SQL transcript plus metadata. A successful later write retires the old
locator. Limits or instrumentation failures omit the ID while ordinary saves
continue; missing IDs cannot make a comparison candidate eligible.

Native comparison data is still not authority. Its private SQL comparison uses
the already checked physical-owner scope without reacquiring resource locks
under the SQL lock. Checkpoint rounds now retain the original row incarnation
from one SQL snapshot and recheck it inside their FULL transaction. Recreated
rows cannot consume an old round; historical committed receipts remain readable
as historical facts. Pending challenges recheck their deadline after a blocking
row read and under the actual admission mutex, without cancelling admitted IO.
The production coordinator now holds the actual original-producer and recipient
captures, stable retained input states and target roster through the Store-owned
FULL transaction and durability restoration. The same transaction checks the
original normal write and private row lifetime and inserts the Native nonce
receipt. The returned comparison uses the owned post-commit write, while its
application watermark stays null. A frozen comparison DTO alone grants no
execution ownership, migration admission or provider application watermark.

Preparation first captures and flushes mounted/Quick composer state through
window-scoped listeners. Busy providers are refused before preparation; Native
execution reservations also register session admission before waiting for SQL.
The idle-close decision shares that admission mutex, so a running reservation
cannot be closed over. Unknown external work remains a blocker. Challenges keep
the absolute preparation deadline even after blocking validation. A cancelled or
expired waiter retains every accepted SQL operation until it actually settles;
only then may the exact target round reopen and a renderer release its closure.
No provider Stop or automatic resend is introduced. Raw editor/parent producers,
multiple-input conservation and supported actor census remain open gates.

Before fencing, explicit native cancellation can commit a permanent cancellation
receipt and advance the source generation. Missing snapshots do not prove that
cancellation is safe; an existing fence requires permanent Host abort/recovery.
Rewind and file revert retain the authority generation shown during review through
confirmation and actual effects. Completed rewind receipts remain readable after
the current floor changes; they do not admit another mutation.

The Rust broker grants bulk access only from a validated Host descriptor bound to
the native window, physical generation, logical demand and resource. Closed/resync,
window removal and route changes retire matching grants, including unary results
in other windows. Native IPC checks saved credentials and disclosure again after
download; an already-admitted mutation remains an uncertain outcome if redacted.

### Database retention and maintenance

The serving Host (`HostStore.startMaintenance()`, started by `serve`) runs one
bounded pass 10 minutes after start and then hourly, off the request path
(`host/storage/host-db-maintenance.ts`; duration metric `storage.maintenance`):

- Native buffer blob GC deletes a blob and its chunks only when no
  `native_buffer_artifacts` row and no certificate (snapshot digest or artifact
  list) references its sha256. The orphan set is re-derived inside each delete
  transaction (at most 500 blobs or 64 MB). An unreadable certificate skips the
  pass. Artifacts and certificates are never deleted.
- Native buffer history is bounded only in the git store (see "Native buffer content store"). The
  legacy SQL rows are never trimmed.
- Replay events are capped at 256 MiB in total on top of the per-session 4 MiB.
  The oldest revisions of the largest sessions go first, and every session keeps
  its newest 50.
- After a pass that deleted rows, `PRAGMA wal_checkpoint(TRUNCATE)` runs, and so
  does `PRAGMA incremental_vacuum` (about 64 MB per pass) when the database uses
  `auto_vacuum=INCREMENTAL`.

Freed pages are reused by later writes, so small deletions do not shrink the
file. When more than 25% of the pages are free, the pass truncates the WAL and
runs `VACUUM` (`host/storage/host-db-compaction.ts`), only while no session or
shell is running, the Host has been up for 10 minutes and the last `VACUUM` is at
least a day old (`hostDbCompactedAt` metadata row). The same `VACUUM` switches
the file to `auto_vacuum=INCREMENTAL`, so later deletions are released by the
bounded step above and the rewrite stays rare. A second WAL truncation then
shrinks the file, and one log line reports the sizes. The pass result reports
`vacuum`. If the idle condition never holds the file stays as is.

### Native buffer content store

Native buffer content and history live in a bycoda-owned bare git repository,
`<host data dir>/native-buffer-store.git`, never in a user repository
(`host/native-buffer/native-buffer-git-persistence.ts`). One ref,
`refs/bycoda/native-buffer`, points at an unparented snapshot commit: each
completion writes a new commit whose tree is the previous tree plus the batch,
moved with a compare-and-swap `update-ref`, so superseded trees become
unreachable. Per report only the newest 20 history versions are kept; older
history keys and their certificates leave the tree in the same commit, and the
mutable current snapshot is never dropped. The maintenance pass runs `git gc
--prune=now` on the store after its retention steps (metric
`storage.nativeBufferGitGc`; failures are logged and do not stop the pass).
Clocks stay in SQL.

If `git` is not on PATH the Host logs one warning
(`Native buffer git store unavailable (git not found); using the SQL native buffer store.`)
and keeps the SQL store. Otherwise git is primary and the SQL rows are a
read-only fallback for keys git does not hold
(`native-buffer-composite-persistence.ts`).

The legacy SQL content has no value once the Host runs on the git store, so the
maintenance pass releases it automatically, and only while the git store is
registered. Each pass deletes rows in transactions of 20,000 through the store
worker (`native_buffer_blob_chunks`, `native_buffer_blobs`,
`native_buffer_artifacts`, `native_buffer_directory_children`,
`native_buffer_certificates`; clock tables and everything else stay), yielding
between batches, and stops after 200 batches or 2 minutes; the next pass
continues. The `VACUUM` above waits until the last row is gone. The pass result
reports `legacyRowsDeleted`.

For an immediate shrink with the Host stopped, the owner can run

`node host.mjs native-buffer legacy-release --data-dir <dir> [--yes]`

Without `--yes` it prints the row count and content bytes of the five tables and
changes nothing. With `--yes` it deletes the rows in one transaction, runs
`VACUUM` and prints the file sizes before and after. Back up `host.db` first:
the drop is irreversible, and `VACUUM` rewrites the whole file and needs about as
much free disk space as the file itself (roughly one to three minutes for 2 GB on
an SSD).

## Contracts and qualification

The shared HTTP/WS domain set now also includes Tasks, Goals, DevServers,
Sprints, Automations, Stewards and Crews. Their finite method DTOs retain the existing service
owners, workspace/activity authorization and durable receipts. A request-scoped
capability retains the original paired principal through awaited work; it is not
a renderer-provided authorization flag. Task deletion uses a persisted-row CAS
after external workspace cleanup so concurrent edits are not silently deleted.
Sprint receipts compare JSON object content without changing persisted receipt
bytes. Automation compensation retains confirmed send IDs and retries only
cleanup of its own acquired activity.

The 20 Crew operations share one paired-owner service. Conversation tools keep
their separately bound conversation principal; request parameters cannot supply
one. Read views redact instructions and launch/delivery details while mutation
results retain the original owner's full run shape. Crew list bootstraps defaults
and therefore uses mutation admission and no transport replay. Stop uses reserved
control admission. Existing request identities, revision checks, model selection,
independent review, task scopes and retained run snapshots remain owner rules.
Accepted create/send receipts are recorded through narrowly scoped SQL recovery
after caller revocation; it never authorizes another send or Stop. The native
image-capability probe rechecks authority after preparation and at the headless
process spawn boundary. Only completed public evidence is cached; waiting callers
check their own grant after an interrupted predecessor.

Task, Note, Goal, Automation, Steward and Crew bulk results register internal resource
dependencies before their owners capture data. Actual committed deletion retires
both retained descriptors and late pending captures, including Automation run
copies removed by its existing cascade. Failed/rolled-back deletion leaves
unrelated copies usable. Notes uses its own worker's actual commit rather than
an unrelated HostDB transaction. This does not erase content already downloaded
by a client or change the owners' retained history contracts.

Crew collection dependencies distinguish global definitions/agents from project
scope. Actual definition, agent and run removals retire their captured transfers;
Task deletion also retires Crew list/detail copies containing that Task. Failed
revision or scope checks leave existing copies usable. Deleting a saved definition
does not erase the snapshots retained by independent existing runs.

A failed post-commit Note notification settles its original worker wait and
does not repeat deletion. The domain reports the verified committed outcome;
transport rechecks the grant before disclosing it. Other unclassified effectful
failures carry unknown delivery with no synthetic receipt or operation ID.
Host and clients share effect classification in neutral `effects.ts`; method
retry policy and read-like names never establish whether an operation has effects.

The canonical WS method `goals.finalReview.recheck` maps to the original HTTP
spelling. Aliases are generated registry metadata and never broaden the wire
method grammar. Before acquiring a native socket, clients check the negotiated
method/capability, request shape and encoded UTF8 envelope budget. A legacy
variant or oversized valid file request selects its original HTTP route before
send. Accepted mutations never switch transports or replay. Cancellation or
failed disclosure after admission reports uncertainty, including non-command
mutations; it does not invent a receipt or a command identifier.

These domain extractions do not establish complete desktop parity. In particular,
paired Host Automations retain their existing four schedule kinds and limits;
richer desktop account/context/dollar-budget behavior and a mobile Sprint
producer are still outside the converted cohort. Local execution defaults remain
unchanged pending the full migration gates.

Zod wire schemas generate deterministic draft 2020-12 JSON Schema. Run
`pnpm check:host-contracts:write` after deliberate changes, then
`pnpm check:host-contracts` for drift. The artifact hash identifies the schema
bundle; independently released clients negotiate supported wire/method versions.
`pnpm check:host-boundaries` enforces neutral/domain import boundaries. Existing
normal `tsc-rs` checks and publishing restrictions remain separate.

`pnpm check:host-headless` inspects the actual production bundle in memory and
rejects UI, React or CSS dependencies. Translation state and provider attachment
formatting are separate from React hooks and file-picker composition. This check
writes no mutable build output and installs nothing.

The full W00-W11 checklist and G01-G09 acceptance gates are tracked in
`.agents/skills/feature-host-runtime/SKILL.md` and the local architecture plan.
The migration is still in progress. Source tests use loopback services, fake
providers and temporary databases. They do not prove installed desktop, actual
SSH/provider, physical Android/iOS, power-loss or production acceptance. No
running Host restart, live session conversion, installation or release follows
from this source work.
