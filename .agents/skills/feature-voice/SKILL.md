---
name: feature-voice
description: "bycoda voice companion: local microphone, Whisper transcription, natural/system replies, visual styles, compact pill, settings, session routing and recovery. Read before changing voice surfaces."
---

# Voice companion

## Purpose and keywords

Talk to the active or pinned coding session while work continues, with readable
microphone, preparation, playback and agent-work states. Keywords: voice, speech,
Whisper, VoxCPM2, RMS, mark, wave, dots, orb, listening, muted, compact, pill.
This T2 delivery covers desktop visuals, signals, settings and fixtures. Existing
Host/RPC/provider behavior is inventoried for preservation; this delivery adds no
Host/Rust/RPC surface, dependency or native window.

## Inventory and coordination

Search roots: `src/features/voice/`, `src/app/`, `src/features/settings/`,
`src/features/connections/model/`, `src/integrations/harness/`, `host/`,
`src-tauri/src/`, `src/shared/i18n/`, `tests/browser/`, `docs/guides/`.
Baseline: `d8bf868fae841b8b391ce148487cd7d373ea9762` on
`feat/voice-visual-styles`. Relevant history includes `9f9271f5a`, `29d534f9f`,
`cf3944cfb`, `07a34eff9` and voice introduction `3419af022`.
Live feature-claim APIs are unavailable in this session. The owner's assigned
worktree and native agent ownership coordinate this voice-only scope; this card
is not a concurrency lock. `docs/reference/DESIGN.md` is absent in this checkout;
existing Arc adapters, shared tokens, design-system references and the owner's
prototype establish the implementation direction.

### Desktop UI and app routing

- `src/app/App.tsx`: renders `VoiceCompanionGate` with active session, sessions,
  submission and stop callbacks.
- `src/features/settings/ui/ChatSettings.tsx`: embeds `VoiceSettings`.
- `src/features/voice/ui/VoiceCompanionGate.tsx`: enabled preference mounts the
  lazy companion; only runtime settings key reconnection, not visual/compact.
- `src/features/voice/ui/VoiceCompanion.tsx` and `.module.css`: launcher, floating
  panel, session follow/pin, status/transcript/reply/error, start/cancel,
  pause/resume/silence/disconnect/close, grip, keyboard movement, saved position,
  compact pill and expansion with focus recovery.
- `src/features/voice/ui/VoiceVisualizer.tsx` and `.module.css`: four styles,
  eight voice states and independent working corner indicator; decorative SVG,
  microphone ref, direct frame writes, viewport/document visibility and reduced
  motion handling. Settings preview alternates listening and assistant poses.
- `src/features/voice/ui/VoiceSettings.tsx` and `.module.css`: enable, visual
  preview radio picker, natural/system choice, detection/install/retry,
  technical details and existing-file dialog. Shared `SegmentedControl` already
  supports preview accessories, radio semantics, arrows and visible selection;
  no shared-control extension is needed for four stable, single-choice options.

### Models, persistence and provider route

- `src/features/voice/model/voiceSettings.ts`: `bycoda.voice` storage and
  `bycoda:voice-settings` broadcast; `visual` is mark/wave/dots/orb (default mark;
  unknown values normalize to mark), `compact` defaults false. Existing persisted
  enabled/natural/python/whisperPath/ttsPath behavior is retained. Panel position uses
  `bycoda:voice-position` separately.
- `src/features/voice/model/localVoice.ts`: local capture, smoothed 0..1 RMS ref,
  VAD/transcription, local-only system utterances, streamed natural playback,
  actual playback start/end signals, muting, silence and lease cleanup.
- `src/features/voice/model/voiceCapture.js` and `voiceVad.ts`: worklet capture,
  segmentation, PCM/resampling; no React state per audio frame.
- `src/features/voice/model/voiceVisualState.ts`: error precedence, disconnected,
  connecting, mute, actual playback, user speech, preparation, then listening.
  Working comes independently from target session busy state.
- `src/features/voice/model/voiceSession.ts`: active/pinned target, bounded
  session context and viewport clamping.
- `src/features/voice/model/voiceConversation.ts` and `voicePrompt.ts`: immediate
  status/silence/explicit stop decisions, isolated signed-in-provider side reply,
  exact transcript submission through existing session callback. Uses
  `src/integrations/harness/` and `src/platform/tauri/fs.ts` for execution context.
- `src/features/voice/model/localVoiceClient.ts` uses local
  `src/features/connections/model/hostFeatureClient.ts` requests; remote project
  audio still runs on this desktop.
- `src/features/voice/model/grokVoice.ts`: existing hosted alternative with
  `session_context`, `submit_work`, `stop_work` tool declarations. It is not the
  default local companion route and gains no new authorization here.

### Host, RPC, native and mobile

`host/server.ts` dispatches `voice.local.inspect` to runtime inspection;
`voice.local.setup` / `voice.local.setupStatus` to `VoiceSetupService` in
`host/voice-setup.ts`; `voice.local.start`, `voice.local.transcribe`,
`voice.local.keepAlive`, `voice.local.release` to `LocalVoiceService` in
`host/voice-local.ts`; and `voice.local.speak`, `voice.local.speechNext`,
`voice.local.speechCancel` through `LocalVoiceService` lease checks to
`VoiceSpeechService` in `host/voice-speech.ts`.
Capabilities are `voice.local.v1` and `voice.local.setup.v1`. Setup remains local,
permission checked and interlocked with active voice.
`host/voice-runtime.ts`, `voice-python.ts`, `voice-python-install.ts` and
`voice-speech-python.ts` own dependency discovery/private Python/model workers.
Existing `voice.clientSecret` / `voice.realtime.v1` use `host/voice.ts`.
`src-tauri/src/remote.rs` retains generic RPC transport, voice allowlisting and
voice timeouts. No new visualizer or always-on-top native command exists.
No `mobile/` source directory is present in this checkout: mobile source/routes
cannot be inventoried or accepted from this worktree. No mobile visual was added.

### Localization and tests

Messages use English source keys in `src/shared/i18n/locales/` and Turkish
editorial overrides in `src/shared/i18n/tr-overrides.json`. New families:
`Visual style`, `bycoda mark`, `Wave`, `Dots`, `Orb`,
`Compact voice companion`, `Expand voice companion`, `Assistant speaking`.

Unit tests beside the feature: `VoiceCompanion.test.ts`,
`VoiceCompanionGate.test.ts`, `VoiceSettings.test.ts`, `VoiceVisualizer.test.ts`,
`localVoice.test.ts`, `localVoiceClient.test.ts`, `voiceSettings.test.ts`,
`voiceVisualState.test.ts`, `voiceSession.test.ts`, `voiceVad.test.ts`,
`voiceConversation.test.ts`, `grokVoice.test.ts`.
Existing Host tests: `host/voice.test.ts`, `voice-local.test.ts`,
`voice-runtime.test.ts`, `voice-runtime-probe.test.ts`,
`voice-python-install.test.ts`, `voice-setup.test.ts`, `voice-speech.test.ts`,
`voice-speech.integration.test.ts`. Host runtime tests are outside this visual
change's required checks; source inventory is not a new runtime acceptance claim.

Browser files: `tests/browser/voice-visual-styles.html`,
`voice-visual-styles.tsx`, `voice-visual-styles-mocks.ts`,
`voice-visual-styles.e2e.ts`, `vite.voice-visual-styles.config.ts`,
`playwright.voice-visual-styles.config.ts`; existing setup coverage is
`voice-settings.e2e.ts` via `settings.tsx`, `settings.html`,
`playwright.settings.config.ts` and `serve-settings.mjs`.

## Owner decisions

2026-10-27, source: `temp/local/voice-visual-styles/BRIEF.md`, owner session
`d0872f7e` relayed into this implementation session:

> bunlar güzel kullanıcı seçebilsin bari aralarından bunu yapalım uygun şekilde entegrasyonunu ve seçimleri kullanıcılara yaptıralım

The owner chooses among four prototype visuals. The prototype supplies visual
intent, not permission to copy literal colors or its fake window.

2026-10-31, source: owner chat session (voice companion "Local voice could not start"
investigation), after the agent proposed CUDA PyTorch installation:

> tamam yapalım kullanıcı kendide seçebilsin

The owner wants GPU acceleration installed automatically where possible and a
user-selectable processing device.

## Processing device and start errors (2026-10-31, uncommitted)

- `voiceSettings.ts`: `device` is `auto` (default, omitted from runtime config so
  existing runtime keys stay stable), `gpu` or `cpu`.
- `VoiceSettings.tsx`: **Processing** segmented row (Automatic/GPU/CPU); a ready
  CPU-only natural install with a detected NVIDIA GPU shows **Install GPU support**,
  which runs the existing setup job. New setup stage label `gpu`.
- `host/voice-gpu.ts`: `nvidia-smi` detection (name, `CUDA Version` or newer
  `CUDA UMD Version`), cached 5 min, none on macOS; CUDA wheel index selection.
- `host/voice-runtime.ts`: validates `device`; probe reports `accelerated` from the
  installed torch wheel without importing it; status reports `gpu`; GPU mode adds
  `GPU support (CUDA)` / `NVIDIA GPU` to missing items.
- `host/voice-setup.ts`: after packages, Automatic/GPU with an NVIDIA GPU and a
  CPU-only torch pins the newest `torch==X+cuNNN` from the newest supported index.
  Automatic tolerates failure (CPU voice); GPU mode fails setup.
- `host/voice-python.ts` / `voice-speech-python.ts`: CPU choice keeps Whisper and
  VoxCPM2 on CPU; GPU choice fails VoxCPM2 start visibly without CUDA.
- `VoiceCompanion.tsx` / `localVoice.ts`: string RPC rejections now display the
  Host's reason instead of the generic "Local voice could not start." fallback.

Checks: `vitest run src/features/voice` (62), host `vitest --config
host/vitest.config.ts host/voice` (45), `tsc-rs --noEmit --fast` web and host,
oxlint, oxfmt, `check-locales.mjs` (8 catalogs verified), repository hygiene.

## Response latency and recognition (2026-10-31, uncommitted)

Owner report, same session: "Ne sesimi iyi tanıdı ne yanıt verdi Çok yavaş
çalışıyor bana nerdeyse 2 3 saniye içinde yanıt verebilmesi gerekiyor."

Measured causes and changes:
- Every side reply spawned a new provider CLI (`claudeText.ts` drops its live
  process after each prompt): 12–18 s per reply cold vs 2.2–3.6 s warm. Voice now
  warms with identical options (`warmVoiceReply` → `warmupHarnessText(harness,
  cwd, {providerAccountId, model, modelSettings})`) on start, at speech onset and
  after each reply. `voiceModelSettings` keeps the session model, sets
  `effort`/`reasoningEffort` to `low` and drops `thinking` (Opus low was fastest warm).
- Newer `huggingface_hub` raises `IncompleteSnapshotError` for offline snapshots
  lacking optional files, so the worker silently fell back to Whisper base. Worker
  and runtime probe now use `try_to_load_from_cache` on required files.
- The app language was never sent; it is now a hint used when Whisper's language
  probability is below 0.75.
- On CUDA, a cached `mobiuslabsgmbh/faster-whisper-large-v3-turbo` (owned folder
  `~/.bycoda/voice/models/whisper-large-v3-turbo` or HF cache) replaces a stock
  small/base/tiny model; GPU-accelerated setup downloads it. CPU keeps the configured model.
- VoxCPM2 runs one discarded generation during start: first chunk 1.84 s → 0.22 s.

Evidence: `temp/verification/2026-10-31-voice-latency/README.md`.

## Composer dictation (2026-10-31, uncommitted)

Owner request, same session: "sesi anlık yakalayıp yazıya çeviren bir butondamı
koysak claude codedeki gibi chat yazdığımız yere yazsa otomatik"

- `src/features/voice/model/dictation.ts`: mic → `VoiceVad` phrases → ordered
  `voice.local.transcribe` with the app-language hint; `stop()` flushes the open
  phrase (`VoiceVad.flush`) and waits before releasing; `cancel()` discards.
- `voice.local.start` gained `recognitionOnly` (`host/voice-local.ts`,
  `host/server.ts`, `localVoiceClient.ts`): same runtime key as the companion, so
  both share one recognizer; natural speech is not started for that lease.
- `src/features/voice/ui/DictationButton.tsx`: ghost icon toggle before Send,
  shown only when voice is enabled; pressed while preparing/listening (clickable to
  cancel), loading while finishing. Errors use the composer's existing alert.
- `Composer.tsx` inserts through `insertAtCaret` (`composerTextareaEdit.ts`),
  which dispatches `input` like typing. New `Mic` icon in `src/shared/ui/icons.tsx`.
Evidence: `temp/verification/2026-10-31-composer-dictation/` (fixture built with a
HEAD copy of a concurrently broken `NotificationsSettings.tsx`).

## Voice stack evaluation and changes (2026-10-31, uncommitted)

Owner request, same session: "NVIDIA Nemotron-3.5 Streaming (0,6B) ve
Qwen3-ASR-1.7B yı yı da deniyelim. smart turn ü de kurabilelim claude cli da
halleldelim en iyi yapıyı en iyi kombinasyonu bulmaya çalış sadece türkçe değil
odağımız hız accurancy ve max dil desteği ingilizce ve türkçe öncelikli tabiki.
Ses sentezi içinde aynı şekilde başka şeyler de deniyebilrisin."

Measured (RTX 4070; FLEURS en/tr/de/fr/es; details and scripts under
`temp/local/voice-bench/`, summary `temp/verification/2026-10-31-voice-stack/README.md`):
- ASR: Whisper large-v3-turbo kept (WER en 5.0 / tr 6.0, 0.24 s). large-v3 slightly
  better, 2× slower. Qwen3-ASR-1.7B best English (3.8) but tr 9.3 and 3–4× slower.
  Nemotron-3.5 streaming fastest final text (0.09 s) but ~2× Whisper's errors.
- Smart Turn v3.2 fp32 (BSD-2, 23 languages): ~20–40 ms CPU; on synthetic FLEURS
  cuts, ~30–38% of mid-sentence pauses still judged complete at threshold 0.7.
- TTS: Supertonic 3 best Whisper-CER (tr ~1%), RTF ~0.15 CPU, 2 s load; VoxCPM2
  RTF ~0.9 GPU; OmniVoice weights CC-BY-NC; Chatterbox slower/worse Turkish.
- Local LLM (Ollama qwen3.5 2b/4b/9b): first token 0.25–0.30 s, SUBMIT/REPLY 7/8,
  but invents facts in answers. Proposal only: local decision + Claude content.

Delivered:
- `host/voice-python.ts`: Smart Turn endpoint checks (`endpoint: true` on
  `voice.local.transcribe`, threshold 0.7; `{complete:false}` without text),
  numpy log-mel matching the reference (max diff 6e-8), coding `hotwords`
  (FLEURS en 5.0→5.4, tr 6.0→5.7: neutral). Ready message reports `turn`.
- `voiceVad.ts`: optional `pause` callback at 0.2 s + `commit(pauseId)`; fallback
  `endSilence` 1.3 s with Smart Turn, 0.6 s without. `localVoice.ts` wires it.
- Engine choice: `engine` runtime key (`supertonic` default/omitted, `voxcpm2`);
  probe, setup (`supertonic==1.3.1`, model rev `724fb5ab…`, Smart Turn rev
  `f766f81d…`, turbo gated on an NVIDIA GPU rather than CUDA PyTorch), speech worker
  branch, `language` on `voice.local.speak`; worker exits on stdin EOF.
  Settings: Reply voice Natural / High quality / System voice; GPU offer only for
  High quality; VoxCPM2 folder picker only for High quality.
- Playback uses its own device-rate AudioContext (was the 16 kHz capture context);
  Supertonic plays with 0.05 s lead, VoxCPM2 keeps 0.35 s.
- `claudeText.ts`: no 8 s wait for `init` (CLI emits it only after the first
  message; stdin is buffered). Streaming replies (`REPLY:`/`SUBMIT` protocol,
  sentence queue) were added by a forked session in `voiceConversation.ts`,
  `voicePrompt.ts`, `localVoice.ts`, `VoiceCompanion.tsx`.
- End to end (recorded speech, real workers, warm Claude Opus low): turn+ASR 0.6 s,
  first Claude sentence 2.6–4.4 s, Supertonic +0.7 s → first audio ~4 s.

## Behavior to preserve

- Voice stays opt-in/off by default; request microphone only on explicit start.
- Preserve generation/sequence guards, stale recognition rejection, abortable side
  replies, accepted-job tracking and exact transcript/session binding.
- Pin/follow, drafts/messages, busy state, explicit stop and existing permission
  gates stay owned by their existing controllers. Speech silence is not work stop.
- Compact/style changes do not reconnect or cancel voice. Expanding restores
  full actions; dragging and arrows remain clamped in either size.
- Preserve overlay registration, Escape, focus return, movement persistence,
  setup progress/retry, runtime-key reconnection and cleanup on disable/close.
- Assistant visual starts with actual playback, not queued synthesis. Mic RMS is
  zero while muted/closed. Stale playback cannot reactivate after silence.
- Semantic shared tokens only; status text remains accessible source of truth.
  Shapes distinguish states without relying on color or motion alone.

## T2 surface checklist and checks

| Surface                                     | Source status | Evidence / observable acceptance                                                                                       |
| ------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Four visualizers, eight states, working     | Done          | `VoiceVisualizer.test.ts`; matrix fixture and reduced-motion captures opened and reviewed                              |
| Mic RMS and playback transitions            | Done          | `localVoice.test.ts`; muted/closed levels, actual onset/end, cancellation guards                                       |
| State mapping and open panel                | Done          | `voiceVisualState.test.ts`, `VoiceCompanion.test.ts`; error/mute/playback precedence                                   |
| Compact, drag, keyboard, focus, clamp       | Done          | `VoiceCompanion.test.ts`; browser interactions passed                                                                  |
| Settings picker and persistence             | Done          | `voiceSettings.test.ts` 11 passed; `VoiceSettings.test.ts` 11 passed; keyboard choice avoids runtime reinspection      |
| Translation catalogs                        | Done          | Eight visual strings exist in all eight locales; Turkish overrides agree                                               |
| User guide and feature card                 | Done          | `docs/guides/voice.md` and this inventory                                                                              |
| Complete browser light/dark 1280/800 matrix | Done          | `temp/verification/voice-visual-styles/`; 165 fixture captures; final 5 browser scenarios passed and captures reviewed |

Required commands: `pnpm check:web` (normal `tsc-rs`) or explicit `:fast`,
`pnpm exec vitest run src/features/voice`,
`node scripts/i18n/check-locales.mjs`,
`node scripts/checks/check-repository-hygiene.mjs`,
`pnpm exec playwright test --config tests/browser/playwright.voice-visual-styles.config.ts`.
Format touched files only using Oxfmt. Check ignored local evidence with
`git check-ignore`; never force-add it.

Fixture screenshots cover every visual with disconnected/listening/user/thinking/
assistant/muted/error/working states, compact pills and radio picker in light and
dark at 1280 and 800 widths, plus reduced motion. Exercise drag, arrows,
double-click expansion, focus, Escape, resize clamping and live style changes.
Open the images and resolve clipping/overlap/contrast defects before acceptance.
Final check outcomes and screenshot paths belong in
`temp/local/voice-visual-styles/REPORT.md` and the verification README.

Final exercised checks (2026-10-27): normal `pnpm check:web` passed 12,496 tests
(1,286 files; 15 tests / 4 files skipped), followed by final-source focused voice
checks (59 tests) and normal `tsc-rs --noEmit`. Browser fixture passed five
scenarios; 165 primary captures plus review contact sheets were opened across
light/dark at 1280/800, including reduced motion. Theme-color and repository
hygiene checks passed. Full locale check has the baseline blocker below.

## Known blockers and acceptance boundaries

- Full locale checker reports 5,359 pre-existing catalog issues, exactly matching
  the committed baseline. New visual strings pass scoped catalog coverage.
- Live feature claims are unavailable; owner-assigned worktree coordination is
  recorded above. Missing DESIGN.md is handled through existing UI references.
- Physical microphone acoustics, native WebView permissions/playback, installed
  desktop/Host and release acceptance require the owner-directed native environment.
  No installer, installation or release is authorized by this brief.

## Committed handoff references

Branch: `feat/voice-visual-styles`. Implementation:
`6637000d4e62f37b698644247d4326660fefaad4` (selectable styles, live audio signals,
compact companion, settings/locales, tests, browser fixture and user guide).
Baseline `d8bf868fae841b8b391ce148487cd7d373ea9762` excludes this feature.
Source and isolated browser fixture include the implementation. App version is
0.6.94; no installer was built. Installed-build inclusion is unknown.
Evidence: `temp/verification/voice-visual-styles/README.md` and logs/captures;
full handoff: `temp/local/voice-visual-styles/REPORT.md`.

## Proposals

A separate native always-on-top companion window is a future proposal only. It is
outside this delivery and requires its own lifecycle, permission, focus, placement
and cross-platform acceptance work.
