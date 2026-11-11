# Host authority and recovery contracts

Read for the affected authority, persistence or delivery boundary;
[architecture](../../../../docs/reference/host-runtime.md) owns the full Host design.

## Authority and original identity

- One execution/history authority per environment/session. A socket or authenticated connection grants no new scope; credentials remain with their existing native/Host owners.

- Normal admission, accepted physical I/O lifetime, permission revocation, process retirement and provider protocol ACK are distinct. An observer timeout cannot settle work or certify cleanup.

- Original construction receipts, turn bindings, approval occurrences and pending identities must survive waits, retries and route replacement. Missing/ambiguous identity must not fall back to PID/current writer.

- A settled warm Host provider still owns its writer. Desktop continuation needs exact retirement before a run lease; timeout/refusal must retain unsent input rather than trigger an offline fallback on retirement-capable Hosts.

- A settled warm Host turn retains only its original provider, activity, operation context and authority needed for explicit retirement. Empty provider sets may be removed after exact retirement; warm or unknown owners remain fenced.

## Durable evidence and publication

- Corrupt stored session owners remain routing fences even when excluded from list rendering. Quarantined outbox evidence counts toward admission; preserve distinct original bytes and never resend uncertain commands.

- Missing/corrupt lifecycle metadata or an unreachable endpoint never proves a Host stopped. Probe the kernel lease; live legacy owners without verified identity remain unknown. Keep corrupt policy, tunnel and credential state until explicitly repaired.

- The Host takes the kernel owner lease before opening its database. A held lease that does not answer is a starting Host inside its boot grace, never a stopped one; it is neither repaired nor replaced, and a second starter loses before touching the database.

- Workspace saves retain expected-content checks, permission checks at publication, rooted target identity and original file permissions. Preserve uncertain replacement candidates; private-state atomic helpers do not preserve arbitrary workspace ACLs.

- Persist remote commands before dispatch; retain exact ID, payload and unknown outcomes. IndexedDB settlements and quarantine preserve reviewed raw evidence; legacy localStorage bytes remain until a qualified writer-cohort retirement proves safe. Storage failures hold dispatch and attachment cleanup.

- A session write extends the persisted-or-pending head by exactly one revision; the store refuses anything else before buffering. Store-owned session writes run through the engine's ordered session write. A refused live batch is rebased only when provably equal, otherwise preserved under `session-recovery/` while the turn settles interrupted. Refused constraints are never retried; transient failures back off.

- Keep drafts, queues, approvals, attachments, exact source bytes and recovery copies. Detach does not Stop; new migration/default authority requires its complete admission contract.

## Delivery and retirement

- Uncertain sends retain the original command ID and are never replayed because a socket closed. Pending/unknown ownership records cannot be evicted to admit fresh work.

- An existence or precondition failure raised before any effect is a typed refusal (`not-sent`); an unknown outcome is reserved for failures after admission. Refusal codes are a closed set for connected clients, so a new code needs client compatibility first.

- Only a refused connection to the Host on this computer is waited out, inside the request's original deadline; a request that may have been delivered is never sent again.

- Authentication/heartbeat admission stays separate from ordinary controls. Queue waits share the original monotonic deadline; cancelled observers do not release physical work. Reconnect retains only never-sent requests, never dispatched mutations.

- Subscription resume requires committed cursor proof bound to the exact live page, owner, target and resource. Unproven or changed membership takes a fresh snapshot; renderer cursor input alone grants no replay authority.

- Desktop control admission persists the original receipt and delivery identity before offering it. Offered/unknown work is never reoffered after a lost response or restart; ACK proves handling only. Native page tokens route existing authority and never replace exact original turn/process grants.

- Retire only proven settled receipts using monotonic time. Fence their original authority/request identity before removing exact records; a fence match refuses execution. Keep pending effects, failed cleanup and unknown physical completion retained. Resource retirement requires its own proof, not only a fulfilled request.

- Browser preview settlement includes verified presentation when requested. Read-only status failures can retire; uncertain claim/navigation/presentation work cannot. Token revocation removes disclosure authority, not evidence of an accepted effect. Recheck both original and current authority after delayed waits.

## Evidence boundaries

- Snapshot/unit evidence does not prove crash/power-loss durability, all-actor closure, native sandbox enforcement or installed source inclusion.
