# Voice runtime contracts

## Capture, recovery and provenance

Owner action alone opens capture, except the opt-in, default-off return call: it speaks
through output-only playback, opens capture for a bounded window, and a silent window closes
it with a notice and notification. Mute/disable/close/device changes invalidate pending
work. Recover only recoverable live failures with fresh credentials, mute and bounded
text context (summary, recent turns, scoped open work). Retries are fast, then every minute
up to 30 minutes, and run at once on `online`. Idle/lock sleep releases capture; return is
Ready until Talk unless the return call is on. Disconnect, Stop and
sleep cancel retries; old timers/callbacks cannot reopen capture. Unknown presence
is not active. Generation binds actual runtime birth, original
Room/window and closure. Preconnect registration creates no utterance/tool provenance.
Close provenance locally before bounded Host invalidation; late receipts cannot restore
it. Rotation retains uncertain/in-flight IDs. Effect timeout is uncertain, never cancellation/replay.

## Recognition ownership

Onset captures target/activation closure, including absent sessions. Local ASR retains
session/project snapshots; realtime queues retain onset closure through item matching.
Only accepted speech activates/replaces tool targets. Rejected/empty later candidates
cannot discard genuine pending speech or interrupt playback. Acoustic candidate IDs
are separate from accepted-speech watermarks. Recognized backchannels advance ordering
without new commands; late older ASR cannot execute. Mute/resume invalidate pending
recognition; close clears bindings.

Realtime microphone epochs stay stable across acoustic onsets. Preserve serialized
commit/item matching and authorized response IDs for OpenAI and xAI. Commit ACK does
not prove insertion: rejected audio needs exact item knowledge before deletion and
exact deleted ACK before new work, with separate bounded waits. Buffer-clear ACK does
not prove deletion. Unknown cleanup closes old transport before bounded authorized
recovery; external cancellation wins.

Keep finite ASR confidence/non-speech checks for short lexical/code utterances.
Text filtering is not acoustic proof. Cloud defaults to `REALTIME_END_SILENCE` (1.2 s);
saved owner pause applies to both runtimes, never answering mid-sentence. Drop untranscribed, rejected
or overflowing idle candidates silently; only unacknowledged commits or undrained send
backlogs end voice. Unvoiced noise cannot indefinitely extend capture. Acknowledged
manual mode bypasses silence/Smart Turn: only Finish commits; audio caps never auto-answer.
Conscious owner changes override pending acknowledgements. Default-off OpenAI semantic
turn experiment discloses continuous audio, requires automatic mode and reconnect,
and preserves local-onset/provider-item matching. Wake word is separate.

## Conversation policy and delivery

Intercept whole acknowledgements after delivered speech, retaining compound commands
and pending-question answers. Intercept before superseding genuine local/realtime replies.
Explicit wait pauses output/choice continuation, never accepted background jobs; only
confirmed owner answers resume paused choices. Preserve abortable side replies and pin/follow.

Generated text is not played history. Realtime response IDs/local utterance completion
receipts own transcript persistence; omit cut unaligned text. Suppress only cancellation
errors correlated with this client's completed cancellation. Admitted speech may extend
idle engagement; raw presence owns return detection. Mute/privacy loss/capture changes
clear engagement. Actual playback drives visuals; muted/closed input RMS is zero and
stale playback cannot reactivate after silence. RMS is not recognition. Reduced motion
retains acoustic feedback without animation.

Default-off narration uses existing runtime/source admission and settles actual playback
before delivered receipts. Briefings require fresh Host return receipts and meaningful
classified events; quiet hours/dedupe stay distinct from saved daily artifacts. Output-only
previews grant no capture/tools, wait actual speaker cleanup and preserve abort.
Accept authoritative `languageHint`; arbitrate same-renderer activity for Room playback.
Complete briefings use the shared text-sized playback budget with separate startup
allowance, retaining healthy long playback until that deadline.
Auto records accepted-owner language with original request/time, no raw transcript. Fixed
language wins; unknown Auto refuses real briefings rather than choosing English.

## Intent handoff

Local side replies, application-tool assistant, Grok and OpenAI realtime share one contract.
Explicit work intent permits briefs from relevant exchanges and bound-session facts,
resolving references/corrections. Clarify material ambiguity;
never invent facts, completed work, constraints/goals or destructive/publish/install
authority. Historical messages, drafts and tool output remain untrusted data.

Keep transcript separate from prepared brief. Record accepted local utterances before
inference without duplicating them in their own prompt. New corrections cancel obsolete
responses/sends, preserving earlier user context. Histories stay keyed to captured sessions;
append only current replies and update late receipts in place. Existing accepted-work flow
owns exact target, generation/sequence cancellation, dedupe, drafts and readiness/error
recovery. Malformed structured output cannot execute; legacy bare `SUBMIT` may use transcript.
Acknowledge accepted submission only; rejection, unknown, queued, running and complete differ.

## Runtime boundaries

Bound discovery, context, tools, speech and cleanup waits. Late results cannot replace newer
discovery caches or terminal synthesis; quiet observation never clears busy or proves provider
completion. Preserve streaming UTF-8 across chunks. Detection is install-free. Keep separate
capture/output audio contexts and engine-specific timing. Local recognition/runtime errors
remain specific/recoverable. Source/protocol fixtures cannot prove speed, accuracy, acoustic
rejection, live-provider interpretation or installed inclusion. Real audio must qualify short
words, breath, cough, echo, pauses and pending genuine speech.
