# Voice source and contract map

Source paths are repository-relative; bare filenames in a row share its directory.

| Concern                                    | Owners                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Companion shell/lifecycle                  | `src/features/voice/ui/VoiceCompanion.tsx`, `VoiceCompanionGate.tsx`, `VoiceVisualizer.tsx`, `VoicePanelChoices.tsx`                                                                                                                                                                                                                                                                                                                                                                                                |
| Floating window                            | `src/features/voice/model/voiceOverlay.ts` (protocol), `ui/useVoiceOverlayHost.ts` (owner side), `ui/VoiceOverlayWindow.tsx`, `voiceOverlayMain.tsx`; `voice-overlay.html` + `apps/desktop/src/voice-overlay.ts`; native `src-tauri/src/voice_overlay.rs` (open/fit/nudge/close/show owner, `is_workspace_window` exclusion, destroy pairing); fixture `tests/browser/voice-overlay.*`                                                                                                                              |
| Settings and runtime identity              | `src/features/voice/ui/VoiceSettings.tsx`; `src/features/voice/model/voiceSettings.ts`, `voiceSession.ts`, `voiceVisualState.ts`                                                                                                                                                                                                                                                                                                                                                                                    |
| Companion persona                          | `src/features/voice/model/voicePersona.ts` (`bycoda.voice.persona`, prompt block), `ui/VoicePersonaDialog.tsx` (device style editor); Host identity/setup in `src/features/assistant/`; `voicePrompt.ts` `personaBlock` appended after the core rules in local, application-tool and realtime prompts; fixture `tests/browser/voice-persona.e2e.ts`                                                                                                                                                                 |
| Companion memory                           | `src/features/voice/model/voiceMemory.ts` (`bycoda.voice.memory`, 40 notes, quoted prompt data), `voiceOwner.ts` (persona + memory block per turn/connection); `memory_save`/`memory_forget` in `realtimeVoice.ts` `voiceTools`, dispatched in `VoiceCompanion.tsx` `realtimeTool`; local side replies use `remember`/`forget` JSON in `voicePrompt.ts`/`parseVoiceDecision`; `model/voiceHostMemory.ts` migrates legacy keys and writes Host memory; Settings routes management to the shared Room                 |
| Assistant setup and language               | `src/features/voice/ui/VoiceSetupSteps.tsx`, `model/voiceLanguage.ts`, `model/voicePreview.ts`; the shared `src/features/assistant/ui/AssistantSetup.tsx` owns wizard navigation and completion                                                                                                                                                                                                                                                                                                                     |
| Proven owner rules                         | `model/voiceOwnerRules.ts` brands exact accepted corrections and durably retains immutable pending saves; `voiceHostMemory.ts` permits facts without downgrading rules, and forget requires exact owner intent/card/version; `VoiceCompanion.tsx` intercepts corrections before model replies                                                                                                                                                                                                                       |
| Explicit turn end                          | `model/voiceSettings.ts` stores opt-in manual mode and conscious-choice revision; `model/voiceTurnPolicy.ts` saves/verifies the freshest explicit choice; `voiceVad.ts`, `localVoice.ts`, `realtimeVoice.ts` bypass automatic commits and expose `finishTurn`; shared `ui/VoiceTurnControl.tsx` shows the current mode and serves full/compact/floating controls through finite owner commands; `src/shared/ui/SplitButton.tsx` uses `nativeActionMenu.ts` for floating menus outside the short native webview      |
| Assistant owner controls                   | `model/voiceAssistantControls.ts` supplies bounded visible-project status, exact job/note controls, immutable uncertain receipts and immediate explicit stop-all; Companion provides canonical target cards through `present_choices`                                                                                                                                                                                                                                                                               |
| Accepted language and output-only playback | `model/voiceSpokenLanguage.ts` records supported accepted-owner language with original request ID/timestamp and no raw transcript; `voicePreview.ts` completion mode waits actual playback cleanup, accepts authoritative `languageHint`, and rejects unknown-auto real briefings; `voiceActivity.ts` arbitrates same-renderer conversation activity for Room playback                                                                                                                                              |
| Kept transcripts and reviews               | `src/features/voice/model/voiceThreads.ts`, `voiceChoices.ts`, `voiceJobs.ts`; `ui/VoiceChoiceCard.tsx`, `VoiceJobReview.tsx`; protocol mirrors through `voiceOverlay.ts` and owner-side IPC                                                                                                                                                                                                                                                                                                                        |
| Scoped tool subjects                       | `host/voice/voice-tools.ts`, `host/runtime-log-tools.ts`, `host/social/social.ts`, `host/session-authority.ts`; `src/shared/model/voiceToolScope.ts`; frontend `voiceController.ts` / `voiceToolClient.ts`. The app bridge no longer creates management sessions                                                                                                                                                                                                                                                                 |
| Scoped thread lookup                       | `model/voiceHistory.ts` captures local/global or remote history bindings at speech onset; `model/voiceHistoryTransport.ts` verifies captured remote machine/environment/project, assistant capability and exact thread, without local Room caching or project creation. `voiceThreads.ts` retains each original request closure, session proof and idempotency key through pending lookup/navigation/retry. Unavailable history stays pending; actual remote focused-session tools never receive a local thread ID  |
| History disclosure                         | `model/voiceHistoryPrivacy.ts` intersects frozen canonical contributor IDs with live visible/unlocked projects. Missing contributor metadata is unknown; explicit `[]` is global. Global summaries have no contributor proof and never seed reconnects. Companion checks before/after asynchronous reads and credentials; scope loss discards the active context and closes capture in Ready while preserving pending saves/review drafts. Fresh owner speech remains usable when historical context is unavailable |
| Dictation/composer integration             | `src/features/voice/ui/DictationButton.tsx`, `src/features/voice/model/dictation.ts`, `src/features/sessions/ui/Composer.tsx`                                                                                                                                                                                                                                                                                                                                                                                       |
| Local speech admission                     | `src/features/voice/model/localVoice.ts`, `voiceVad.ts`, `voiceTranscript.ts`; `host/voice/voice-python.ts`                                                                                                                                                                                                                                                                                                                                                                                                               |
| Realtime transport                         | `src/features/voice/model/realtimeVoice.ts`; preserve both OpenAI/xAI item, epoch, response authorization and timeout paths. Commit ACK is not insertion ACK: rejected audio waits for exact item knowledge before deletion and exact deleted ACK before new work, with separate bounded windows. Unknown cleanup closes the old transport before bounded authorized recovery; explicit Stop/sleep cancels recovery. Buffer-clear ACK never proves item deletion                                                    |
| Side replies and handoff                   | `src/features/voice/model/voiceConversation.ts`, `voicePrompt.ts`, `voiceWork.ts`; application-tool conversations also use `voiceAssistant.ts`. Follow the actual harness text-runner caller                                                                                                                                                                                                                                                                                                                        |
| Setup/workers                              | `host/voice/voice-runtime.ts`, `voice-setup.ts`, `voice-gpu.ts`, `voice-speech-python.ts`; follow worker/RPC dispatch rather than inventing new authority                                                                                                                                                                                                                                                                                                                                                                 |
| Global application tools                   | Separate `feature-voice-management` skill; shared VoiceCompanion consumes its bridge                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Native computer-use tools                  | `host/conversation/conversation-desktop-control-tools.ts` adds strict desktop operations; native exact-operation approval uses `src-tauri/src/conversation_tools_bridge.rs`. Real session and assistant-thread subjects stay distinct through the authenticated relay. `HostDesktopControl` retains allowlist, snapshot, request receipts, lock and physical-input gates. Thread approval grants no generic native UI or working-copy access. No owner settings/Stop tools                                                       |
| Native/mobile                              | `src-tauri/src/remote.rs`; inspect `mobile/` independently for mobile-facing changes                                                                                                                                                                                                                                                                                                                                                                                                                                |
| UI/browser checks                          | Adjacent model/UI tests; `tests/browser/voice-visual-styles*` fixtures and current voice settings scenarios                                                                                                                                                                                                                                                                                                                                                                                                         |
| Recovery and idle sleep                    | `model/voiceReconnect.ts` classifies failures and bounds retries/context; `model/voicePresence.ts` reads native presence; `src-tauri/src/presence.rs` supports Windows idle/lock reads. `ui/VoiceCompanion.tsx` owns retry cancellation and sleep/ready; `ui/VoiceOverlayWindow.tsx` mirrors those states. Paths under model/ui are relative to `src/features/voice/`.                                                                                                                                              |

## Conversation policy and delivery

`voiceSpeechPolicy.ts` intercepts whole acknowledgements after delivered speech,
without swallowing compound commands or answers to pending questions. Explicit
wait pauses output, never accepted background work. Local and realtime routes
intercept before superseding a genuine response.

Generated text is not played history. Realtime response IDs and local utterance
completion receipts own transcript persistence; cut unaligned text is omitted.
Suppress only cancellation errors correlated to this client's completed cancel.
`voicePresence.ts` extends idle capture for admitted speech; raw presence still
owns return detection. Clear engagement on mute, privacy loss and capture changes.
`voiceConversationPreset.ts` applies the optional professional preset while
preserving unrelated preferences and manual-turn revisions. `voiceBriefing.ts`
requires a fresh Host return receipt and meaningful classified events, preserving
quiet hours and delivery dedupe separately from saved daily artifacts.

## Recognition recovery

Local candidate IDs are not the accepted-speech watermark. Preserve onset targets
while carrying this instance's accepted sequence forward. An empty/rejected later
candidate cannot erase an earlier pending transcript. A recognized backchannel
advances the recognition watermark without interrupting playback; late older ASR
must not become a new command. Explicit wait preserves a pending choice, and only
a confirmed owner answer can resume its paused continuation. Mute/resume invalidates
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

## Dictation and microphone permissions

- `model/voiceSettings.ts`: `dictationEnabled` is independent of companion
  `enabled`. Both default off. Legacy settings missing the dictation property
  inherit the previous companion setting; explicit choices remain independent.
- `ui/VoiceSettings.tsx`: detection and recognition-only installation remain
  available with companion off, preserving saved reply-voice preferences and
  Python/model paths. `natural:false` skips TTS dependencies on the Host.
- `ui/MicrophonePermissionSettings.tsx`: feature switches never capture. A passive
  permission query may remain unknown. Explicit access checks immediately close
  tracks, including grants arriving after cancellation/unmount.
- `model/microphoneAccess.ts`: shared denial, missing/busy device and secure-context
  recovery for dictation/local/cloud voice. `ui/MicrophoneRecoveryAction.tsx` owns
  native settings-launch feedback in settings, composer, setup and companion.
- `src-tauri/src/privacy_settings.rs`: allowlisted native macOS/Windows microphone
  panes only. Opening settings is not a permission grant. Linux/browser recovery
  stays manual. `Info.plist` includes dictation/test/voice usage; the existing
  audio-input entitlement remains authoritative.
- Checks: adjacent microphone, permission-settings, recovery-action, dictation and
  voice-settings tests; Host `voice-setup.test.ts`; isolated fixture
  `tests/browser/playwright.dictation-permissions.config.ts`. Simulated platforms
  do not prove OS prompts, device capture or installed acceptance.

## Dictation fast start

- `src/features/voice/model/dictation.ts` opens the microphone while
  `voice.local.start` loads the recognizer. Phrases spoken meanwhile queue in
  spoken order; at most two recognitions are in flight (the Host limit). A lease
  arriving after cancel is released at once.
- `host/voice/voice-local.ts` keeps the recognizer loaded `DICTATION_WARM_MS` (5 min)
  after the last dictation lease only. Companion release still unloads at once. A
  warm recognizer is not `isActive`; `voice.local.setup` and a start with other
  settings unload it first.


## Bounded voice waits

- `voiceRuntimeDeadline.ts` bounds tool observers and preserves uncertain request identities; a timeout is not cancellation of a dispatched mutation.
- `hostFeatureClient.ts` and `machineSnapshot.ts` evict timed-out discovery promises. Late results must not replace newer cache entries.
- `voicePresence.ts` treats a timed-out native sample as unknown. `voiceCausalContext.ts` closes provenance locally before bounded Host invalidation; a late receipt cannot restore it.
- `voiceSessionProgress.ts` labels an observed quiet session without clearing busy or declaring provider completion.
- `host/voice/voice-elevenlabs.ts` bounds first-response and idle PCM waits. `host/voice/voice-speech.ts` ends stalled synthesis and rejects late chunks after terminal delivery.
- `host/voice/voice-runtime.ts`, `voice-setup.ts`, and `voice-gpu.ts` decode streaming UTF-8 across chunk boundaries. Detection remains install-free.

## Input feedback and controls

- `model/voiceGenerationRetirement.ts`, `model/voiceCausalContext.ts`, Native
  `voice_generation_retirement.rs` and `host/assistant/voice/assistant-voice-status.ts` bind
  actual runtime birth, original Room/window and closure. Preconnect registration
  cannot invent an utterance or create tool provenance.
- `model/realtimeVoice.ts`, `model/voiceSettings.ts` and `ui/VoiceSettings.tsx`
  own the default-off OpenAI semantic turn experiment. Preserve continuous-audio
  disclosure, automatic-mode restriction, reconnect requirement and local-onset
  plus provider-item matching. Wake word is a separate capability.
- `host/assistant/voice/assistant-narration.ts`, `model/voiceNarrationLifecycle.ts` and
  `VoiceCompanion.tsx` retain default-off announcements on the existing runtime,
  source admission and actual playback settlement before delivered receipts.

- `VoiceVisualizer.tsx` uses actual input level for local and cloud listening;
  reduced motion keeps acoustic feedback without animation. RMS is not recognition.
- `VoiceCompanion.tsx`, `VoiceTurnControl.tsx` and `VoiceOverlayWindow.tsx` keep
  compact stop/speaker/mic/finish actions and mode selection in the options menu.
  Disconnect, speaker mute, silence and Stop work remain distinct. Speaker mute
  also prevents or cancels output-only briefings without replaying them later.
- `ui/useVoicePushToTalk.ts` uses the opt-in `Voice: Push to Talk` binding only
  on a live connection with paused mic. Hold captures; release submits and pauses;
  Escape or blur cancels. Runtime end must preserve an already pending transcript.
- `model/voiceToolActivity.ts` tracks bounded tool observers, owner-card waits,
  uncertain outcomes and late results. Stop waiting never promises effect cancellation.
- `useVoiceOverlayHost.ts` uses scoped listeners, visible subscription failures
  and StrictMode-safe cleanup. The native window mirrors whitelisted commands.
