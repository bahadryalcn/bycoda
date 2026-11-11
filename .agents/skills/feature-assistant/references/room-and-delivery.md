# Assistant Room, capture and delivery contracts

Read only the section affected by the change. UI owners are in [source owners](sources.md);
[supervision](supervision.md) owns job/Chief admission and recovery.

## Capture and presence

- Only explicit owner action opens the mic. Recovering an authorized live
  connection differs from waking after sleep; return keeps the mic closed.

- Explicit Disconnect cancels pending retries and cannot be undone by an old
  timer, provider callback, unlock or pointer movement.

- Presence reads can fail. A failed read keeps the last good reading for five minutes; after
  that the computer counts as away, never as present.

- Presence uses shared labeled success/warning/danger/neutral roles; a failed read
  keeps the last confirmed state and a missing Host status shows offline.

## Room identity and drafts

- Room uses one header and contextual toolbar. Disclose diagnostics; retain
  drafts, status, errors, owner decisions and emergency Stop.

- Room management threads are project-independent. Keep an explicit operation
  target separate from that durable identity; never borrow a coding session or
  fabricate a project. Native UI effects bind the registered thread, Host and
  live window issuer and recheck them after waits.

- Current visible project labels/aliases aid discovery. Ambiguity needs an exact
  target; preserve canonical ID, Host and cwd.

- Conversation drafts flush on thread switch, page hide and unmount; failed local
  saves retain memory and expose retry. Job-edit intents persist before dispatch;
  quota failures must not freeze editable fields. Coalescing and the flush deadline
  are covered by `src/features/assistant/ui/AssistantView.test.ts` ("coalesces
  conversation draft writes while keeping current input" and "flushes a continuously
  edited conversation draft within two seconds").

- Names and quoted preferences cannot grant permissions, replace instructions or
  change targets. Never hardcode the owner's chosen name as product identity.

## Memory and delivery

- Verified rolling summaries survive transcript clear; raw summaries carry no
  proof. Recheck contributor privacy before model reads and disclosure.

- Daily summaries return their saved day artifact, never a mutable return-briefing
  pointer. Retain creation time and contributor privacy; missing stays unavailable.

- Briefing speech requires its Host return receipt and current delivery gates.

- Ack actual native delivery, retain suppressed events. Recheck presence, hours,
  mute, privacy and lead window. Background delivery cannot request mic/OS consent.

## Desktop control

- Desktop observations grant only volatile same-caller snapshot refs. The
  owner-only permission mode (ask, auto, full; `desktop-control-permission.ts`)
  decides whether the exact operation goes through the native dialog; voice and
  Room tools cannot write it. Headed input additionally requires saved
  physical-input consent, and current presence outside full access.
  Lock, failed presence and revoked authority fail closed. Stop fences queued
  configuration, resume and input; only a newer explicit Resume can re-enable.

- Persist audit metadata before input; drain outside revoked caller scope. Retain
  request/outcome identity, never raw input/snapshots/refs. Audit retry cannot act.

## Notebook, observations and native trust

- Room notebook uses canonical Notes storage and exact native review; projectless
  account grants are separate, versioned and default denied. Retain provenance
  through provider calls, reply persistence, history and speech delivery.

- Observation journal coverage is source-specific, bounded and metadata-only.
  Cursor acknowledgement follows authorized delivery; gaps require resnapshot.
  Missing live source permits mean unavailable, never an active subscription.
  Follow [observation admission and recovery](../../../../docs/reference/assistant-observations.md).

- Privileged native proofs use independently provisioned trust. Follow the
  [native admission contract](../../../../docs/reference/assistant-native-admission.md);
  paired-device authentication alone does not enroll a signing installation.
