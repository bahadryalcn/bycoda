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
Sprints and Automations. Their finite method DTOs retain the existing service
owners, workspace/activity authorization and durable receipts. A request-scoped
capability retains the original paired principal through awaited work; it is not
a renderer-provided authorization flag. Task deletion uses a persisted-row CAS
after external workspace cleanup so concurrent edits are not silently deleted.
Sprint receipts compare JSON object content without changing persisted receipt
bytes. Automation compensation retains confirmed send IDs and retries only
cleanup of its own acquired activity.

Task, Note, Goal and Automation bulk results register internal resource
dependencies before their owners capture data. Actual committed deletion retires
both retained descriptors and late pending captures, including Automation run
copies removed by its existing cascade. Failed/rolled-back deletion leaves
unrelated copies usable. Notes uses its own worker's actual commit rather than
an unrelated HostDB transaction. This does not erase content already downloaded
by a client or change the owners' retained history contracts.

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
