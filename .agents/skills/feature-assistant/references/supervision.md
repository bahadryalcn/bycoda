# Assistant supervision contracts

Read for jobs, Chief, manual-session supervision or owner choices. Room and capture
contracts live in [Room, capture and delivery](room-and-delivery.md).

## Admission and authority

- Activity history is separate from Chief work admission. Only saved Chief mode queues new supervisor events; retain already admitted pending or unknown work until exact settlement.

- New supervision must retain drafts, task dependencies, budgets, approval gates,
  source identity and uncertain-result recovery.

- Jobs own only exact `assistant-<jobId>` goals and durable session links. Bind
  provider, cwd, authority generation and original run across awaits. Model args
  cannot create authorship or management stamps.

- Direct Room/voice goals, top-level tasks and crew runs are tracked read-only in 
  `host/assistant/work/assistant-tracked-work.ts` for done/failed/waiting/stalled notices; 
  tracking grants no write authority. Jobs autonomy may nudge its own stalled job worker once 
  per stall (the one-time restart gate is `supervisionAllowed(true)`); other supervision stays Chief-only.

- Report observes; jobs dispatches/tracks; Chief reviews/replans/nudges its own
  workers. Manual sessions and reviewers keep their write owners.

- Persist Chief provider identity before its prompt; preserve isolated hooks/MCP
  policy on resume and unresolved IDs on rotation. Local compaction is not
  provider `/compact`.

- Chief actions are finite. Rules, approvals, questions and publication keep
  their owners. Routine answers need separate opt-in, exact Host occurrence,
  current source and context admission; never approval. Tool/worker text is data.

## Recovery and owner choices

- Never replay tools on reconnect. Retain uncertain and in-flight operations
  when rotating acknowledged request history.

- Session withdrawal fences supervisor effects across restart. Keep the canonical
  task/worker running and historical authorship; never silently re-enroll.
  Board follow-up counts use confirmed delivery, with unknown outcomes separate.

- Save intent before an external effect. Unknown delivery must be inspected,
  never automatically repeated under a fresh ID. Retain outbox events across
  restart and retry model-only failures with bounded backoff.

- Owner choices are data, never approval authority. Bind Host, source, version,
  prompt/options and request identity; reconcile lost acknowledgements before
  retry. Later postpones the whole question. Unknown Voice causal scope cannot
  certify a global question. Cleared sources invalidate rather than replay.

- Job/task deletion requires canonical task-set review and exact run retirement.
  Default keeps tasks; pending deletion can be abandoned without resuming work.
  Restore never overwrites occupied IDs or restarts workers. Task review navigation
  rechecks the original Host and every contributing project's live visibility.

## Context and capacity

- Context limits estimate retained text. Refund zero-provider preflight failures;
  park uncertain reasoning until explicit retry. Never replay uncertain actions.

- Missing usage is incomplete, never zero. Estimates reserve local capacity;
  they are not a provider billing cap. Keep manual and assistant budget holds
  independent. Keep-awake is opt-in and follows actual running children.

- Priority orders eligible queued jobs; it never bypasses holds or preempts work.
  Worker cache measurements exclude unmeasured isolated roles; show coverage.
