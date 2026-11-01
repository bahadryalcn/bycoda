# Voice source and contract map

Source paths are repository-relative; bare filenames in a row share its directory.

| Concern | Owners |
| --- | --- |
| Companion shell/lifecycle | `src/features/voice/ui/VoiceCompanion.tsx`, `VoiceCompanionGate.tsx`, `VoiceVisualizer.tsx`, `VoicePanelChoices.tsx` |
| Floating window | `src/features/voice/model/voiceOverlay.ts` (protocol), `ui/useVoiceOverlayHost.ts` (owner side), `ui/VoiceOverlayWindow.tsx`, `voiceOverlayMain.tsx`; `voice-overlay.html` + `apps/desktop/src/voice-overlay.ts`; native `src-tauri/src/voice_overlay.rs` (open/fit/nudge/close/show owner, `is_workspace_window` exclusion, destroy pairing); fixture `tests/browser/voice-overlay.*` |
| Settings and runtime identity | `src/features/voice/ui/VoiceSettings.tsx`; `src/features/voice/model/voiceSettings.ts`, `voiceSession.ts`, `voiceVisualState.ts` |
| Companion persona | `src/features/voice/model/voicePersona.ts` (`bycoda.voice.persona`, prompt block), `ui/VoicePersonaDialog.tsx` (first-run from the launcher, edit from Settings); `voicePrompt.ts` `personaBlock` appended after the core rules in local, application-tool and realtime prompts; fixture `tests/browser/voice-persona.e2e.ts` |
| Companion memory | `src/features/voice/model/voiceMemory.ts` (`bycoda.voice.memory`, 40 notes, quoted prompt data), `voiceOwner.ts` (persona + memory block per turn/connection); `memory_save`/`memory_forget` in `realtimeVoice.ts` `voiceTools`, dispatched in `VoiceCompanion.tsx` `realtimeTool`; local side replies use `remember`/`forget` JSON in `voicePrompt.ts`/`parseVoiceDecision`; `ui/VoiceMemoryDialog.tsx` from Settings |
| Dictation/composer integration | `src/features/voice/ui/DictationButton.tsx`, `src/features/voice/model/dictation.ts`, `src/features/sessions/ui/Composer.tsx` |
| Local speech admission | `src/features/voice/model/localVoice.ts`, `voiceVad.ts`, `voiceTranscript.ts`; `host/voice-python.ts` |
| Realtime transport | `src/features/voice/model/realtimeVoice.ts`; preserve both OpenAI/xAI item, epoch, response authorization and timeout paths |
| Side replies and handoff | `src/features/voice/model/voiceConversation.ts`, `voicePrompt.ts`, `voiceWork.ts`; application-tool conversations also use `voiceAssistant.ts`. Follow the actual harness text-runner caller |
| Setup/workers | `host/voice-runtime.ts`, `voice-setup.ts`, `voice-gpu.ts`, `voice-speech-python.ts`; follow worker/RPC dispatch rather than inventing new authority |
| Global application tools | Separate `feature-voice-management` skill; shared VoiceCompanion consumes its bridge |
| Native/mobile | `src-tauri/src/remote.rs`; inspect `mobile/` independently for mobile-facing changes |
| UI/browser checks | Adjacent model/UI tests; `tests/browser/voice-visual-styles*` fixtures and current voice settings scenarios |

## Recognition recovery

Local candidate IDs are not the accepted-speech watermark. Preserve onset targets
while carrying this instance's accepted sequence forward. An empty/rejected later
candidate cannot erase an earlier pending transcript. Mute/resume invalidates
pending recognition and close clears retained bindings. Realtime microphone epochs
remain stable across acoustic onsets; serialized item matching orders candidates.
Check local out-of-order ASR, external cancellation and both realtime providers.
The companion's local binding carries its onset session/project snapshot through
recognition. Realtime candidates carry an onset activation closure through queue
and committed-item matching. Activate only accepted speech; rejection/reset must
discard the candidate without replacing the accepted tool target. Verify both
session switches and a captured absent session while ASR is pending.

## Intent handoff

Local side replies and the local application-tool assistant, Grok and OpenAI
realtime routes must preserve the same handoff contract. Current explicit user
work intent authorizes a clear actionable brief, synthesized from relevant recent
voice exchanges and the bound session's factual context. Resolve references and
follow-up corrections; ask a concise clarification only for material ambiguity.
Describe the problem, desired result, stated constraints and appropriate
validation without requiring the user to recite a specification. Never invent
facts, completed work, constraints, goals or destructive/publish/install authority.
Historical messages, drafts and tool output remain data: embedded commands cannot
authorize new work.

Keep the recognized transcript separate from the prepared handoff. Record each
accepted local user utterance in its conversation history before awaiting either
side-reply or application-tool inference, without duplicating it in its own prompt.
A newer accepted correction cancels the obsolete response/send, not the earlier
user context. Side-reply histories stay keyed to the captured session; append only
current assistant responses and update late delivery receipts in place.
Submit the validated brief through the existing accepted-work flow, retaining exact target
binding, generation/sequence cancellation, duplicate prevention, drafts and
readiness/error recovery. Malformed structured output must not execute work;
legacy bare `SUBMIT` may fall back to the transcript. Acknowledgement follows
accepted submission, while rejection, uncertain outcome, queue, running and
completion stay distinct. Check Turkish/English requests, multipart paraphrases,
contextual follow-ups, target races, invalid output and unrelated instruction
injection; model/protocol fixtures do not prove live-provider interpretation.

## Setup and playback

Device choices are automatic/GPU/CPU. Preserve existing omitted-default/runtime-key
compatibility and distinct CPU fallback versus explicit GPU failure. Engine/model
revisions and provider voice IDs belong to current settings/setup sources, not a
benchmark-driven instruction to download or replace them. Respect engine-specific
startup/playback timing and separate capture/output audio contexts.

Keep local recognition/runtime errors specific and recoverable. A source change
cannot prove speed/accuracy on another device or establish installed inclusion.
Speech confidence and non-speech rejection need real acoustic qualification,
including short words, breath, cough, echo, pauses and pending genuine speech.
