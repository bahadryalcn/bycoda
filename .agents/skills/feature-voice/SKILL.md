---
name: feature-voice
description: Change voice audio, microphone capture, dictation, recognition admission, local/cloud playback, setup or companion visuals. Preserve speech sequencing and composer drafts; application management is a separate feature.
---

# Voice

Audio, dictation and companion UI. [Voice management](../feature-voice-management/SKILL.md)
owns application actions; composer owns draft/caret/send. Paths are repository-relative.

## Start and workflow

1. Identify route, mic lifetime, target, candidate/accepted sequence and playback owner.
2. Trace the UI/controller into the relevant model and Host worker using
   [the source map and audio contracts](references/surfaces.md).
3. Preserve keys, cancellation and setup recovery. Exercise rejected recognition
   while earlier genuine speech is pending.
4. Report protocol, recorded audio, real mic/provider and installed proof separately.

## Preserve

- Microphone capture is opt-in and starts only from explicit user action. Mute,
  disable, close and device changes invalidate the appropriate pending work.
- Cloud recovery may reacquire a microphone already authorized for the live
  connection, preserving mute. Idle/lock sleep releases capture; returning shows
  ready with the mic closed until Talk. Explicit disconnect cancels retries.
- Retry only recoverable failures, with fresh credentials and bounded text
  context; never replay tools. Keep unknown presence distinct from active and
  retain uncertain/in-flight request identities when rotating operation history.
- Capture the target at speech onset/accepted route binding. A later selected tab
  must not redirect an earlier candidate; a captured absent target stays absent.
- Acoustic candidates and accepted speech have separate sequence ownership. A
  rejected cough/non-speech candidate must not discard pending genuine speech,
  interrupt playback or become an instruction. Only accepted words supersede work.
- Realtime epochs identify microphone lifetime; preserve serialized commit/item
  matching and authorized response IDs. External cancellation still wins.
- Keep finite ASR confidence checks and non-speech transcript handling without
  discarding short lexical/code utterances. Text filtering is not acoustic proof.
- Cloud defaults to `REALTIME_END_SILENCE` (1.2 s); explicit owner pause applies
  to both runtimes. Don't answer mid-sentence pauses. Drop untranscribed/rejected/
  overflowing idle candidates silently; only unacknowledged commits or undrained
  send backlogs end voice. Steady unvoiced noise cannot extend capture to 20 s.
- Manual mode bypasses silence/Smart Turn commits in both runtimes; only owner Finish
  commits. Bound audio without auto-answering at its cap. Only acknowledged owner rules
  can enable it; conscious owner changes win over pending acknowledgements.
- Silence is not Stop work. Preserve accepted-job tracking, abortable side replies,
  pin/follow behavior and the existing permission gates.
- Dictation inserts through the composer draft/selection owner, preserving IME,
  attachments and cancellation. It does not implicitly submit a message.
  Fast start (mic during load, warm recognizer): [source map](references/surfaces.md).
- Visuals start on actual playback. Muted/closed mic RMS is zero; stale playback
  cannot reactivate after silence.
- Style/compact/movement changes do not reconnect voice. Preserve overlay/focus,
  clamped movement, full actions on expand and reduced-motion/state readability.
- Floating `voice-overlay-<owner>` mirrors owner-window audio/tools through snapshots
  and whitelisted commands. Never treat overlays as workspaces (quit/tray/reap/state).
  Owner close/reload closes it; overlay/native close docks and shows the app without
  disconnecting voice. Floating stays in Voice options.
- Persona is quoted style after core rules, never authority/target/format changes.
  Host setup replaces skip; core identity/budget and voice provider/playback/mic
  verification have separate gates. Retain legacy persona backups.
- Memory/rules are quoted preferences from current speech or Settings, never
  session/tool/draft content. Rules require exact accepted correction, not model
  quotes/fact promotion. Retain immutable pending intent across lost acknowledgements.
  Forget requires owner card + fresh version; acknowledge only store success. Disabled
  memory rejects all saves. Partial legacy migration retains backup/context.
- Transcript writes retain original thread/session focus and idempotency through retries.
  Reconnect seeds summary/text only; never replay tools. Thread grants are a real typed
  subject, never a fabricated session. Working-copy/desktop operations keep real focus.
- Job review creates nothing before explicit Start; freeze accepted payloads and keep
  partial/unknown results visible. A choice is not an approval or external-send grant.
- Job/note controls require explicit owner intent and captured/current scope intersection.
  Delete needs exact owner confirmation; clear Stop needs no extra dialog. No model stop-all.
- Auto uses saved accepted-owner language, never UI locale. Fixed language wins; unknown
  auto cannot silently choose English for real briefings. Output previews have no mic/tools.
- Preserve CPU/GPU/auto, cloud/system/natural choices and truthful setup recovery.
  Setup changes grant no installation authority.

## Conditional references and checks

- Runtime detail: [source map](references/surfaces.md).
- Durable choice provenance: [owner decisions](references/decisions.md).
- User behavior: [voice guide](../../../docs/guides/voice.md).
- Global tools/draft attachments: [voice management](../feature-voice-management/SKILL.md).

Run voice tests; Host workers use
`pnpm exec vitest run --config host/vitest.config.ts host/voice-python.test.ts`
or the affected adjacent suite. Use normal `pnpm check:web` / `pnpm host:build`
when needed. Source/mocks do not prove acoustic, device or provider acceptance.
