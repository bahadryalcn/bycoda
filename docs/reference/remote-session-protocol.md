# Local and remote session contract

This contract extends the existing paired host RPC transport. There is no central server.

## Desktop directory heartbeat revisions

`sessions.desktopLive` may include a client-scoped `projectDirectoryRevision`
alongside the full privacy-filtered `projectDirectory`. A supporting host echoes
that revision only after accepting the contents. Subsequent beats may omit the
contents and renew directory freshness with the exact acknowledged revision.
Missing/mismatched revisions never renew an old projection or gain an acknowledgement.
After a host reset the client resends the full projection on the next beat.
Changed exclusions, ordering or appearance always receive a new revision and a
full payload. Older hosts omit the acknowledgement, so clients continue sending
full snapshots at the existing cadence. Client expiry and fail-closed multiwindow
privacy rules still apply; a revision is not new authority to disclose a project.

## Identity and authority

A session reference is `(environmentId, sessionId)`. The connection record's local
`machineId` is not a session identity. `sessionReferenceKey` encodes the pair without
collisions. Native transport and the server verify environment identity, so an
existing connection cannot silently write to a replacement host.

Session ownership, the machine running the provider agent, and the machine holding
the working directory are separate concepts. Ordinary remote sessions and agents
are created on the project's host. A local agent using SSH/MCP does not change
ownership, and unrelated SSH commands do not discover sessions. An adopted record
is a desktop view of the same host authority, not an independently writable copy.
An explicitly created independent copy receives a new identity. Agent handoff is
outside this contract.

Writes are serialized through the owning host's `commands.dispatch` and existing
provider rules. A second client does not gain permission to start another agent.
Existing queue/busy behavior applies when the host is occupied. The remote queue
belongs to the client and is not drained while the app is closed. Legacy local
agents started by the desktop retain their existing lifecycle.

## Views and history

`sessions.page` returns the latest page; the client does not automatically walk
older pages. `HostSession.history` carries the first loaded block index (`before`),
view revision, and total block count. Apply a page only to its matching revision.
Discard an older page completed after the live revision advances and reload using
the current cursor, preventing deleted blocks from reappearing.

For a partial view, `sessions.sync` accepts `partial:true`, `loadedBlockIds`, and
`windowStart`. The host computes the view from the first surviving loaded block in
the current order. The delta includes `partial:true`; `blockIds` is the authoritative
order for that view, and missing IDs indicate deletion. Only changed/new blocks
are transferred. If no loaded block survives or the revision is incompatible,
recover from the current latest page. Provider tokens may be coalesced into the
latest state rather than emitted individually for each revision.

A partial history ready for sending is not a complete history. `historyPartial`
and remote project paths prevent authoritative local session persistence. Revision
changes do not remount the composer; drafts, attachments, model/effort choices,
and queue state are retained.

New clients request `preview:true` on `sessions.page`. Large blocks are represented
as previews with explicit `remoteContent` markers. Legacy non-preview requests
retain their contract. New pages contain at most 100 blocks / 1 MiB; each preview
is at most 64 KiB. `sessions.block` fetches full content for the same
session/block/revision on explicit demand. Large responses use the existing bounded
`syncChunk` transport. Apply full blocks only to a still-matching revision.

`sessions.workedTime` returns `{ workedMs }`, the sum of finished submitted user
turns' `durationMs`, without transferring the transcript. The session detail card
reads it on open and adds a still-running turn from its own start time.

## Shared control channel and recovery

The control channel is a long-polling `machine.changes` request over paired HTTP
RPC. The SSH tunnel is shared through the native connection manager. No second
WebSocket server or message broker is added. Idle requests transfer no content
and renew on metadata changes or after at most 10 seconds. Existing authentication,
connection cancellation, and legacy-host fallback contracts remain in use.

`machine.changes` carries session revision and project etag changes for one machine.
A fresh server `instanceId` is created at each startup; it is neither a session
identity nor a persistent revision. Epoch changes return `reset:true`, and clients
recover from the current view. Notifications point to state deltas rather than an
unbounded event log. Requests made after a snapshot revision detect a different
current revision, closing the snapshot/subscription race.

Renderer consumers share a reference-counted channel. Native code combines window
registrations into one control request per machine. Separate data/command requests
do not wait for it. The last closing consumer unsubscribes with an empty registration;
crashed-window registrations expire after 45 seconds. A new window omitted from an
in-flight request is covered by the next combined request. After sleep, wake, or
disconnection, read the current delta from the known revision; load the latest page
if ordering or base state does not match.

Focus, network recovery, visibility restoration and verified reconnects wake an
idle control channel without opening a second in-flight poll. A successful
control response also retries a failed content read when no revision changed;
the content error stays visible while the retry waits. Library synchronization
refreshes machine discovery on wake and clears a recovered peer's failure
backoff only after its connection is verified, retaining normal cycle spacing
and other peers' backoff. These wakeups do not replay uncertain session commands.

Project lists send only `upserts` and `removed` summaries for a known etag. A base
mismatch fetches a full summary list without downloading transcripts. Task etag
notifications invalidate the shared task list; unchanged lists are not reread.
Visible conversations subscribe to content revisions. Native code coalesces equivalent
concurrent read-only requests, without retaining completed responses or including writes.

Capabilities `machine.changes`, `sessions.lazyHistory`, and `commands.status` select
new behavior. Older hosts retain list/sync queries. Authentication and authorization
revocation are checked before and after long polling.

## Waiting fields on session summaries

Session summaries (`sessions.list`, `machine.changes` project upserts) may carry two
optional fields. Older hosts omit both; clients then show no Waiting state.

- `waiting: { kind, count, since?, label? }`: the Host stamps it for a running Host
  turn the agent yielded while background work still runs (`commands`, `agents`,
  `tasks`, from the turn's `backgroundTasks`), and for an idle parent whose delegated
  children in the same project still run (`delegated`, `since` the earliest child start).
- `wakeSources: { kind: "pull-request", label, since?, until? }[]`: one entry per
  active pull request watch of that session (at most 10). The entry leaves the list
  when the watch ends: merged or closed and delivered, unwatched, or its session
  deleted. A client ignores an entry whose `until` has passed.

A watch starting or ending notifies the change signal and is part of the project
list etag, so held `machine.changes` requests return the updated rows. Clients rank
issue, interrupted and needs-input above Waiting; a plain running turn stays Working.
Scheduled automations and stewards start new sessions, so they are not wake sources.

## Command reliability and budgets

Command IDs and payload signatures bind to durable receipts. Retrying the same ID
returns the same receipt; a changed payload is rejected. `commands.status` queries
a known result without executing again. Receipts are retained for seven days. New
outbox entries stop automatic replay after six days and remain visible for recovery.
Legacy undated or unverified external side effects do not have the same guarantees.

Pages, transfers, host/client snapshot caches, subscriptions, and send queues have
separate bounds. The send queue allows 100 messages / 32 MiB; one outbox entry is
at most 2 MiB, with a total of 100 entries / 8 MiB. Exceeding a limit rejects the
composer request rather than silently dropping data. These are policy limits,
not measured memory consumption or speed improvements.

Native control is bounded to 64 machines, with 32 windows, 64 sessions, and 32
projects per machine; shared read-only flights are capped at 64. Host control waits
at most 10 seconds and holds at most 64 pending requests. Partial sync accepts at
most 32,768 loaded block IDs. Host transfers allow at most 32 Mi UTF-16 units;
the transfer cache holds 8 entries / 128 MiB. A single oversized transfer returns
an explicit error. Renderer snapshot caches hold 8 entries / 32 MiB, session-list
caches 256 entries / 8 MiB, and persistent summary caches 64 entries / 2 MiB.
Existing 120 ms provider stream checkpoint coalescing and transcript turn/block
memoization preserve the visible turn window without adding a token event log.

The persistent latest-page cache is a separate IndexedDB store, keyed by
`(environmentId, sessionId)` with a schema version, 24-hour TTL, 8 entries / 8 MiB,
and a 1 MiB per-entry limit. It stores at most the latest 100 blocks and excludes
drafts, outbox entries, and attachment payloads. It grants no send authority and
must be validated by a fresh host read. Summary writes coalesce per key and run
in separate macrotasks. Host operation continues if this cache is unavailable;
the cache database is separate from the authoritative session store.

## Attachment ownership and collection

Hosts advertising `attachments.ownership.v1` support durable draft ownership.
New clients acquire `attachments.claim` before uploading, and include `ownerId`
and `claimId` in `attachments.status` and `attachments.upload`. Claim and release
requests contain `{ ids, ownerId, claimId }`, with at most 20 attachment UUIDs per
request. Owner and claim IDs are bounded opaque identifiers, not credentials.
The host scopes each claim to the authenticated principal as well as those IDs.
Releasing one draft, device or generation cannot release another one's claim.
`attachments.claims` lists only that principal's claims for an `ownerId`, in pages
of at most 200 `{ id, claimId }` records. Its `after`/`next` cursor uses the same
pair. Clients use this inventory to recover claims established by a queue response
whose acknowledgement or local ledger write was lost. They reacquire all confirmed
references before releasing superseded or unreferenced generations.
Managed attachment UUIDs use lowercase spelling; legacy upload spelling remains
compatible with existing files.

Queue RPCs returning snapshots (`sessions.queue.get/change/claim/finish`) also
accept `ownerId` and `claimId`. The host acquires claims for their attachment IDs
before returning the snapshot, so an offline cached queue edit remains protected
if another device removes the original row. These attachment view claims are
separate from the queue's scheduling consumer claim. A snapshot returned without
ownership metadata conservatively protects any known managed files as legacy.

Who sends a shared queue is a drain lease, capability `sessions.queue.lease`: the
queue carries `drain: {holder, epoch, expiresAt}` (host clock; replies add `hostTime`
and `leased: true` for a client that sends `leaseAware: true`). Only a desktop window
(`desktop:<stable per-window id>`) holds one, taking it with `sessions.queue.lease`
(`takeover: true` for an explicit Resume, which bumps `epoch`). The window renews it on
its `sessions.desktopLive` beat (`queueLeases: [{sessionId, epoch}]`, answered per queue
with the extended lease or `null` when lost), so it lives 20 s without a beat. A claim
or finish with a stale holder or `epoch` is refused ("drain lease"); nothing was sent.
With no live lease the home host sends the head itself: when the queue changes, when a
turn settles, and once at the earliest lease expiry. A send whose sender is gone becomes
an unconfirmed hold (`deliveryUnknown`, paused) and is never sent again on its own.
Clients without `leaseAware` are served as before: they see the live holder as
`consumer`, asking for ownership grants them a lease, and each of their calls renews it.
Stored `consumer` and `restored` queue rows are migrated to unleased and paused.

Who may start a turn of a conversation is a run lease, capability `sessions.runLease`.
A desktop window (`desktop:<stable per-window id>`) takes it with `sessions.runLease`
`{sessionId, clientId, action: "acquire"}` just before it starts a turn, and gives it back
with `action: "release"` (plus the granted `epoch`; a lease that moved on answers
`LEASE_LOST`). The `sessions.desktopLive` beat that reports the conversation busy renews it,
the beat that reports it idle (or no beat for 20 s) ends it, and the host's own turns need
none (a running host session is the proof). `commands.dispatch` of a `send`, `compact` or
`contextual` command, and the host's queue drain, are refused while a window holds the
lease or an older app reports the conversation busy. The refusal is typed: its text starts
with `LEASE_HELD:`. It is a wait, not a failure: nothing was sent, so clients queue the
message and never pause the queue, raise an error or fork the conversation.

A completed upload's claim does not expire while its draft is offline. Clients
release only after durable draft removal or a durable session/queue handoff, and
retain release intent across failures and restarts. Closing a window, cancelling
a request, locking the app or disconnecting a device does not discard ownership.
A new acquisition cancels or supersedes stale release intent; an older generation's
delayed release cannot release a newly acquired generation. Desktop windows use
independent ownership scopes. Ownership mutations are never shared-read requests.
Desktop reconciliation uses `session_attachment_references`, a strict native
snapshot of draft and queue attachment IDs. Its optional `allSessions` inventory
also protects exports from a closed window into another local draft. These reads
neither prune old drafts nor treat malformed JSON as an empty reference set.

The host runs collection at startup and hourly. Explicit release starts a seven-day
grace period; incomplete uploads may also become eligible after seven idle days.
Before removing a managed file, collection checks current claims, durable session,
queue and other host references, and active attachment operations. Unknown reference
state defers deletion. Files touched by legacy clients without ownership metadata,
and pre-existing files whose external draft ownership is unknown, remain protected.
Clients without this capability retain the existing upload contract. This migration
does not authorize guessing that an old file or an offline device has no owners.

## Phone push notifications

A Host that advertises `push.expo.v1` accepts `push.register`, `push.unregister`
and `push.test`. Each acts only on the calling credential: the registration row
(`push_devices`, keyed by the credential hash) is joined with `devices`, so
revoking a pairing stops its pushes. A push token registered again under a new
pairing moves to it. The phone supplies the title and the localized text for each
event and its event choices; the Host stores no language and puts no project or
conversation names into a message.

`host/push/` reads every top-level conversation every four seconds while at least
one phone is registered and compares it with the previous read. Without a previous
read the result is only a baseline, so restarts never replay old state. A rising
`needsInput` sends `input`, a new failed `issueTurnId` sends `failed`, and
`running` → `idle` sends `finished`; interrupted turns, delegated children, drafts
and archived rows send nothing. Messages go to Expo's push service
(`exp.host`), which relays to APNs and FCM; this is the only third party on the
path and it receives only the phone's own text, the computer name and opaque IDs.

`sessions.desktopLive` carries `userActive: true` while a desktop window has focus
and recent input. Pushes are held while any window reported that within 20 seconds.
The phone suppresses the banner for the conversation it is showing.

## Compatibility between Hosts and clients

Desktops and phones must keep reaching a Host across ordinary Host updates.
`HOST_PROTOCOL_VERSION` in `src/features/connections/model/protocol.ts` is bumped
only for a change an existing client cannot survive: a removed or reshaped method,
payload or field. Additive changes never bump it: new providers, capabilities,
methods and optional fields are ignored by clients that do not know them. In
particular a Host that advertises a provider the client build does not know stays
reachable; `knownRemoteProviders` drops the unknown provider from the offered list
instead of rejecting the Host.

When versions do differ, `protocolMismatchMessage` produces the text every side
shows, written for the person holding the client: a newer Host asks them to update
the app, an older Host asks them to update the Host. The Host returns the same text
to a client whose request carries another version. Any change that does bump the
version must ship new desktop and mobile builds together with the Host release.
