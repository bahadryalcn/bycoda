# Assistant observations

Observations are a metadata journal, separate from a conversation, a provider
turn and an execution owner. Creating or acknowledging an observation grants no
permission to start a task, send a message, enable a microphone or publish.

## Sources and coverage

Each event retains its Host environment, canonical source type and ID,
database-owned source revision, opaque event ID, change kind and permitted
project/account scope. Source changes and journal inserts share the canonical
database transaction. Rollback publishes neither. Retained source counters
distinguish deletion and recreation of the same ID; timestamps are not revisions.

The Host producers cover its sessions, tasks, goals and Social records/jobs.
Crew settings produce scoped invalidation metadata where project ownership is
known. Native Notes use a transactional outbox. Saved Servers use durable
write-ahead metadata beside the canonical file store, with exact-state restart
reconciliation. Failed reconciliation produces a source gap rather than a false
atomicity claim. Native library scope is the verified installation identity,
exclusive of project or account; models cannot choose an installation identity.
Native-only sessions and unscoped Crew records require their own source owners.
These producers are not a universal event feed. Project scope does not grant access to
Social account events; account policy remains a separate admission boundary.

Retention is bounded to 10,000 events and 30 days. Expired or removed history
advances a retained sequence floor. An offline Host, expired cursor, omitted
source or incomplete snapshot never means an empty complete account.

## Room cursors and recovery

`observations.read`, `observations.ack` and `observations.resnapshot` use the
real Room thread as consumer identity. The caller chooses exactly one project
or account target. Account consumer identity also includes the trusted grant
generation, so reenrollment cannot acknowledge an older grant's offered data.
Models cannot choose another consumer or inject a generation.

Reads are bounded to three events and 3,000 serialized bytes. Acknowledgement
cannot advance past offered data. Oversized events and retention gaps require
an authorized baseline. An incomplete or changed baseline cannot clear the gap.

Account baselines use eight-row metadata pages, bounded to 2,048 rows and
512 KiB. Durable one-hour receipts bind the actual consumer, account grant,
source revisions, retention floor and snapshot ID. Pages count only after their
actual provider/HTTP disclosure. Sequential coverage can continue across Room
turns. A changed source or grant invalidates the receipt; pages from different
snapshots cannot be combined. Larger baselines report incomplete explicitly.
Recovery establishes a current baseline; missed changes are not replayed.

Project recovery accepts source-qualified task, Host session and goal baselines.
Each source owns a distinct consumer. Goal pages require current Native captures
for every contributing project and bind their exact directories to the receipt.
They cannot clear another source's gap or the aggregate project cursor.

Native library reads require a fresh, signed source status. Native Notes and
Servers begin with incomplete coverage; a Host journal at sequence zero proves
no source coverage. Recovery retains ordered page disclosure receipts and requires
the original Native source to acknowledge the matching fingerprint and watermark.
Lost completion stays uncertain without automatic replay. A Native-only recovery
does not fabricate a journal floor or skip prior journal events. Project recovery
for additional sources still requires their owning baseline.

## Admission and delivery

Authorize scope and each source outside SQL, then retain a synchronous captured
permit inside the database operation. Revalidate before actual provider calls,
history persistence and socket disclosure. Observer timeout is not physical
settlement; the canonical owner's promise or exact receipt controls release.
Native identity follows [native admission](assistant-native-admission.md).

The Assistant's default-off completion and needs-input notification settings
apply to explicitly supervised projects. Internal polling, outbox acceptance,
native delivery and actual display are separate states. Availability requires
the complete source-to-delivery permit path. Missing ports or failed native
qualification keep the feature unavailable and retain saved preferences.
Speech is a separate output channel and remains behind existing consent,
presence, quiet-hours and delivery-receipt rules.

Source owners: `host/assistant/observations/assistant-observation-journal.ts`,
`host/assistant/observations/assistant-observation-producers.ts`, `host/assistant/observations/assistant-observation-tools.ts`
and `host/assistant/service.ts`. Runtime results and build inclusion belong in
the task handoff, not this contract.
