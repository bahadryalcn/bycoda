---
name: feature-voice
description: Change microphone capture, dictation, local/cloud voice, setup and companion UI. Preserve speech order and drafts; management has a separate owner.
---

# Voice

Own capture, recognition, playback and companion UI across `src/features/voice/`,
`host/voice/` and native audio/window adapters. Composer owns drafts/send;
[voice management](../feature-voice-management/SKILL.md) owns application actions,
and Assistant owns shared identity, Room and setup completion. Inspect mobile separately.

## Source starts

- UI/model: `src/features/voice/ui/` (VoiceCompanion, VoiceSettings, DictationButton)
  and `src/features/voice/model/` (voiceSession, localVoice, realtimeVoice).
- Host: `host/voice/` (runtime/setup and worker dispatch); `host/assistant/voice/`
  owns admitted Assistant delivery.
- Native: `src-tauri/src/` owns presence, microphone settings, generation and overlay
  adapters. Follow the affected adapter in the [owner map](references/surfaces.md).
- Tests: adjacent UI/model/Host suites and voice fixtures in `tests/browser/`.

## Workflow

1. Identify route, microphone lifetime, onset target, candidate/accepted sequence and playback owner.
2. Follow the [owner map](references/surfaces.md); load only the relevant runtime or interaction contract.
3. Trace consent, scope, persistence and cancellation across UI, model, Host and native boundaries.
4. Exercise rejection during pending speech, target switches, cancellation and uncertain delivery;
   distinguish protocol fixtures, recorded audio, live microphone/provider and installed proof.

## Preserve

- Capture needs explicit owner action. Authorized live recovery preserves mute; idle/lock sleep
  releases capture and returns Ready with microphone closed unless the opt-in return call is on.
  Disconnect cancels retries.
- Onset/accepted binding captures target, including absence. Candidates and accepted speech have
  separate ownership; rejected sounds cannot replace accepted work or interrupt playback.
- Preserve realtime microphone epochs, serialized item/commit matching, authorized response IDs
  and external cancellation. Unknown cleanup closes transport before authorized recovery.
- Manual turn end needs acknowledged owner opt-in; only Finish commits, and conscious changes
  win over pending acknowledgements. Silence, mute, disconnect and Stop work stay distinct.
- Effects retain immutable request identity across bounded waits/recovery. Timeout is uncertain;
  reconnect seeds text only, never tools. Quiet observation is not provider completion.
- Played history needs actual playback receipts. Preserve acknowledgement/wait policy,
  pending choices, engagement privacy and accepted-job tracking in local/cloud routes.
- Dictation uses composer draft/selection ownership, preserving IME, attachments and cancellation;
  no implicit send. Companion/dictation switches and recognition-only setup remain independent.
- Style, movement and compact changes preserve connection, focus, clamped placement and accessible
  actions. Overlays mirror owner audio/tools through whitelisted commands, never workspace authority.
- Persona, memory and rules are quoted data. Exact accepted corrections, versioned owner forget
  and store success govern memory; disabled memory rejects saves. Retain legacy backups.
- History binds original thread/session, scope and idempotency. Disclosure intersects frozen
  contributors with live visibility; missing history cannot redirect speech or grant tools.
- With Confirm jobs before starting on, job review creates nothing before Start; otherwise jobs start directly. Choices are not approvals; job/note actions need exact
  intent/scope, deletion confirmation and retained partial/unknown results. No model stop-all.
- Auto language follows accepted owner speech; fixed language wins, unknown Auto refuses real
  briefings. Output-only playback grants no capture/tools. Setup retains engine choices and
  truthful recovery without installation authority.

## Focused checks

Run adjacent suites in `src/features/voice/model/`, `src/features/voice/ui/` and
`host/voice/` using the web and `host/vitest.config.ts` configurations. Follow
[verification order](../../../docs/reference/testing.md#order-of-verification) for normal
web/Host checks and changed native adapters. Use affected voice fixtures in `tests/browser/`;
source/mocks cannot prove acoustic, OS permission, device, provider or installed acceptance.

## References

- [Owner map](references/surfaces.md): choose UI, model, Host, native and test owners.
- [Runtime contracts](references/runtime.md): recognition, recovery, playback and handoff changes.
- [Interaction contracts](references/interactions.md): memory/history, controls, setup, dictation and overlays.
- [Owner decisions](references/decisions.md): durable owner choices, without new authority.
- [Voice guide](../../../docs/guides/voice.md): user behavior and setup.
- [Voice management](../feature-voice-management/SKILL.md): application tools and draft attachments.
