# Host runtime and WebSocket migration

bycoda attaches execution to the selected project's machine. A conversation is
identified by `(environmentId, sessionId)`. Opening it on another computer or a
phone does not move its provider process, workspace or history authority.

## Source implementation

The migration separates neutral contracts (`src/shared/model/host-contracts/`),
client policy (`src/shared/lib/host-runtime/`), domain services (`host/domains/`),
transport adapters (`host/transport/`) and native credentials/OS integration.
The current source includes environment, project/directory, session, queue, file,
pipe-terminal, Notes and nine explicit Git services plus command admission shared
by HTTP and WS. Other domain methods retain explicit
HTTP compatibility paths while their extraction and qualification continue.

`/ws` uses the `bycoda.rpc.v2` subprotocol and an authenticated paired-device
Authorization header. Browser Origins are rejected. `connection.hello` verifies
the expected environment and advertises only actually routed capabilities.
The composition exposes session reads, command dispatch/status, logical
subscriptions, queues, files, pipe terminals, Notes and explicit Git operations.
Each method requires both an advertised route
and its explicit capability family; schemas alone never enable a route.

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

## Durability and authority

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
These observations explicitly remain unqualified. Mounted composer capture,
provider output/application watermarks, true producer closure and native
challenge-scoped checkpoint receipts still require integration.

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
