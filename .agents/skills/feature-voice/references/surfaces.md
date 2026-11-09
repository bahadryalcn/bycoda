# Voice owner map

Repository-relative owners; follow entry points and adjacent tests, not a file inventory.

- Companion, settings, setup, dictation, choices/reviews and floating presentation:
  `src/features/voice/ui/`, through VoiceCompanion, VoiceSettings and DictationButton.
  Shared setup completion and Room identity belong to `src/features/assistant/`.
- Capture, recognition, turn policy, playback, history, persona/memory, handoff and
  scoped clients: `src/features/voice/model/`, through voiceSession, localVoice,
  realtimeVoice, dictation and voiceController. Composer insertion belongs to
  `src/features/sessions/`; shared scope types to `src/shared/model/`.
- Runtime detection/setup, leases, recognizer/speech workers, GPU selection and speech
  providers: `host/voice/`, through voice-runtime, voice-setup, voice-local and voice-tools.
  Assistant narration/generation admission belongs to `host/assistant/voice/`.
- Global tool dispatch: [voice management](../../feature-voice-management/SKILL.md)
  owns the bridge; `host/conversation/` and native relay enforce exact desktop approval.
  Runtime logs, Social and session authority keep their domain owners.
- Native adapters: `src-tauri/src/` owns presence, privacy_settings, voice_overlay,
  voice_generation_retirement and remote dispatch. Overlay bootstrap belongs to
  `apps/desktop/src/`; native window adapters retain lifecycle authority.
- Tests: adjacent suites in those UI/model/Host folders; voice style, persona, overlay
  and dictation-permission fixtures in `tests/browser/`. Inspect `mobile/` independently.
  Fixtures cannot establish OS, acoustic, physical-device, live-provider or installed acceptance.
- Labels/recovery copy: `src/shared/i18n/locales/` and active override catalogs.

Read [runtime contracts](runtime.md) for recognition, playback, recovery and handoff;
[interaction contracts](interactions.md) for history/privacy, owner actions, dictation,
setup and presentation. Current settings/setup sources own engine/model revisions and voice IDs.
