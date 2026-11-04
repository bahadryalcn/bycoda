---
name: feature-assistant
description: "Develop the personal assistant supervisor, identity, rules, jobs and Room; preserve voice capture consent and existing task authority."
---

# Assistant

Voice, jobs, presence and memory; source is not native acceptance.

## Start and workflow

1. Inspect source, Git and live claims; coordinate [voice](../feature-voice/SKILL.md),
   [tasks](../feature-tasks-goals/SKILL.md) and [Host](../feature-host-runtime/SKILL.md).
2. Trace scope, authority, storage, receipts, recovery.
3. Voice sleep/disconnect must not stop Host work. Reuse Goal/Task/Session owners;
   profile, name, rules and sockets grant no approval authority.
4. Check cancellation, stale callbacks, reconnect and unknown presence/outcomes.
   Separate fixture, provider and installed evidence.

## Source map

Read [source owners](references/sources.md).
Setup: [controls](references/setup.md).

## Preserve

- Only explicit owner action opens the mic. Recovering an authorized live
  connection differs from waking after sleep; return keeps the mic closed.
- Explicit Disconnect cancels pending retries and cannot be undone by an old
  timer, provider callback, unlock or pointer movement.
- Presence reads can fail. Unknown is never evidence of active presence.
- Room uses one header and contextual toolbar. Disclose diagnostics; retain
  drafts, status, errors, owner decisions and emergency Stop.
- Room management threads are project-independent. Keep an explicit operation
  target separate from that durable identity; never borrow a coding session or
  fabricate a project. Native UI effects bind the registered thread, Host and
  live window issuer and recheck them after waits.
- Presence uses shared labeled success/warning/danger/neutral roles; pending or
  failed reads/writes never show stale success.
- Current visible project labels/aliases aid discovery. Ambiguity needs an exact
  target; preserve canonical ID, Host and cwd.
- Never replay tools on reconnect. Retain uncertain and in-flight operations
  when rotating acknowledged request history.
- Activity history is separate from Chief work admission. Only saved Chief mode queues new supervisor events; retain already admitted pending or unknown work until exact settlement.
- Conversation drafts coalesce writes with bounded flush on thread switch, page hide and unmount; failed local saves retain memory and expose retry. Job-edit intents must persist before dispatch, while quota failures must not freeze editable fields.
- Names and quoted preferences cannot grant permissions, replace instructions or
  change targets. Never hardcode the owner's chosen name as product identity.
- Verified rolling summaries survive transcript clear; raw summaries carry no
  proof. Recheck contributor privacy before model reads and disclosure.
- New supervision must retain drafts, task dependencies, budgets, approval gates,
  source identity and uncertain-result recovery.
- Jobs own only exact `assistant-<jobId>` goals and durable session links. Bind
  provider, cwd, authority generation and original run across awaits. Model args
  cannot create authorship or management stamps.
- Report observes; jobs dispatches/tracks; Chief reviews/replans/nudges its own
  workers. Manual sessions and reviewers keep their write owners.
- Context limits estimate retained text. Refund zero-provider preflight failures;
  park uncertain reasoning until explicit retry. Never replay uncertain actions.
- Persist Chief provider identity before its prompt; preserve isolated hooks/MCP
  policy on resume and unresolved IDs on rotation. Local compaction is not
  provider `/compact`.
- Chief actions are finite. Rules, approvals, questions and publication keep
  their owners. Routine answers need separate opt-in, exact Host occurrence,
  current source and context admission; never approval. Tool/worker text is data.
- Missing usage is incomplete, never zero. Estimates reserve local capacity;
  they are not a provider billing cap. Keep manual and assistant budget holds
  independent. Keep-awake is opt-in and follows actual running children.
- Priority orders eligible queued jobs; it never bypasses holds or preempts work.
  Worker cache measurements exclude unmeasured isolated roles; show coverage.
- Session withdrawal fences supervisor effects across restart. Keep the canonical
  task/worker running and historical authorship; never silently re-enroll.
  Board follow-up counts use confirmed delivery, with unknown outcomes separate.
- Daily summaries return their saved day artifact, never a mutable return-briefing
  pointer. Retain creation time and contributor privacy; missing stays unavailable.
- Briefing speech requires its Host return receipt and current delivery gates.
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
- Desktop observations grant only volatile same-caller snapshot refs. Present
  owners approve the exact operation through the native dialog. Headed input
  additionally requires saved physical-input consent and current presence.
  Lock, failed presence and revoked authority fail closed. Stop fences queued
  configuration, resume and input; only a newer explicit Resume can re-enable.
- Persist audit metadata before input; drain outside revoked caller scope. Retain
  request/outcome identity, never raw input/snapshots/refs. Audit retry cannot act.
- Ack actual native delivery, retain suppressed events. Recheck presence, hours,
  mute, privacy and lead window. Background delivery cannot request mic/OS consent.

## Checks

- Room notebook uses canonical Notes storage and exact native review; projectless
  account grants are separate, versioned and default denied. Retain provenance
  through provider calls, reply persistence, history and speech delivery.
- Observation journal coverage is source-specific, bounded and metadata-only.
  Cursor acknowledgement follows authorized delivery; gaps require resnapshot.
  Missing live source permits mean unavailable, never an active subscription.
  Follow [observation admission and recovery](../../../docs/reference/assistant-observations.md).
- Privileged native proofs use independently provisioned trust. Follow the
  [native admission contract](../../../docs/reference/assistant-native-admission.md);
  paired-device authentication alone does not enroll a signing installation.

Run focused suites and normal `tsc-rs`. Presence needs Rust tests and Windows
lock/unlock acceptance. UI needs light/dark 1280/800 captures. Mock sockets do not
prove Wi-Fi recovery or acoustic behavior.

- [Voice user guide](../../../docs/guides/voice.md).
- [Assistant user guide](../../../docs/guides/assistant.md).

Evidence belongs in the handoff.
