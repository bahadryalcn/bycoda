---
name: feature-voice
description: Change voice audio, microphone capture, dictation, recognition admission, local/cloud playback, setup or companion visuals. Preserve speech sequencing and composer drafts; application management is a separate feature.
---

# Voice development

Use for the audio lifecycle, dictation and companion UI. Global application actions
belong to [voice management](../feature-voice-management/SKILL.md); composer owns
draft/caret/send. Source paths below are repository-relative.

## Start and workflow

1. Identify local/cloud/dictation route and its microphone lifetime, target binding,
   recognition candidate, accepted-speech sequence and playback owner.
2. Trace the UI/controller into the relevant model and Host worker using
   [the source map and audio contracts](references/surfaces.md).
3. Preserve settings/runtime keys, async cancellation and setup recovery. Exercise
   rejected recognition while earlier genuine speech is pending, not only success.
4. Check the affected capture/recognition/playback path. Report model/protocol,
   recorded audio, real microphone/provider and installed acceptance separately.

## Preserve

- Microphone capture is opt-in and starts only from explicit user action. Mute,
  disable, close and device changes invalidate the appropriate pending work.
- Capture the target at speech onset/accepted route binding. A later selected tab
  must not redirect an earlier candidate; a captured absent target stays absent.
- Acoustic candidates and accepted speech have separate sequence ownership. A
  rejected cough/non-speech candidate must not discard pending genuine speech,
  interrupt playback or become an instruction. Only accepted words supersede work.
- Realtime epochs identify microphone lifetime; preserve serialized commit/item
  matching and authorized response IDs. External cancellation still wins.
- Keep finite ASR confidence checks and non-speech transcript handling without
  discarding short lexical/code utterances. Text filtering is not acoustic proof.
- Silence is not Stop work. Preserve accepted-job tracking, abortable side replies,
  pin/follow behavior and the existing permission gates.
- Dictation inserts through the composer draft/selection owner, preserving IME,
  attachments and cancellation. It does not implicitly submit a message.
- Assistant visuals start with actual playback, not queued synthesis. Muted/closed
  mic RMS is zero; stale playback must not reactivate after silence.
- Style/compact/movement changes do not reconnect voice. Preserve overlay/focus,
  clamped movement, full actions on expand and reduced-motion/state readability.
- The floating window (`voice-overlay-<owner>`) is a mirror. Audio, recognition,
  playback and tools stay in the owning workspace window; the overlay renders its
  state snapshot and sends whitelisted commands. Overlay labels are never
  workspace windows (quit, tray, reap, window-state). Owner close/reload closes
  the overlay; overlay close docks without disconnecting voice.
- Keep CPU/GPU/automatic processing, cloud/system/natural voice choices and setup
  retry/error truth. Setup changes do not authorize installing in this task.

## Conditional references and checks

- Feature surface and runtime detail: [source map](references/surfaces.md).
- Durable choice provenance: [owner decisions](references/decisions.md).
- User behavior: [voice guide](../../../docs/guides/voice.md).
- Global tools/draft attachments: [voice management](../feature-voice-management/SKILL.md).

Run focused tests beside changed voice models/UI; Host worker changes use
`pnpm exec vitest run --config host/vitest.config.ts host/voice-python.test.ts`
or the affected adjacent suite. Use normal `pnpm check:web` / `pnpm host:build`
when needed. Real cough/breath/echo, device and provider behavior require explicit
acoustic/runtime evidence; source or mock checks do not establish them.
