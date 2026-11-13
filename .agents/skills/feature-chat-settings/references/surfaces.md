# Chat Settings surfaces

Code paths are repository-relative.

| Area                  | Source owner                                                                                                                                                                                 |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page/display          | `src/features/settings/ui/ChatSettings.tsx`, `ConversationDisplaySettings.tsx`, `ChatSettings.css`; `useAppearanceSettings.tsx` and the Appearance preference model                          |
| Continuation/spelling | `src/features/settings/model/settings.ts`, `composerSpelling.ts`; runtime `src/features/sessions/model/usageLimit.ts`, `turnRecovery.ts`; `src/features/connections/model/remoteRecovery.ts` |
| Templates             | `src/features/settings/ui/TemplatesSettings.tsx`; `src/features/sessions/model/promptTemplates.ts`                                                                                           |
| Insertion/SSH         | `src/features/sessions/ui/Composer.tsx`; `src/features/connections/model/sshSnippets.ts`                                                                                                     |
| Translation/reprompt  | `src/features/settings/ui/HelperModelsSettings.tsx`; `src/features/sessions/model/translationPreferences.ts`, `translation.ts`; `src/features/sessions/ui/TranslationResultDialog.tsx`       |
| Voice settings        | `src/features/voice/ui/VoiceSettings.tsx`; follow current voice model and Host setup owner rather than duplicating voice runtime here                                                        |
| Desktop control       | `src/features/sessions/model/desktopPreferencesControl.ts`; `src/app/workspace/control/useAppControlRequests.ts`; `src-tauri/src/control.rs`                                                 |

## Data and capabilities

- Conversation titles use `src/features/settings/ui/HelperModelsSettings.tsx`
  and `src/features/sessions/model/titlePreferences.ts`. The `text.title` Host routing
  role owns explicit model choices.
  `helper-models` reveals the single Chat row linking all helper models. Automatic choice matches enabled
  Haiku/Terra/Flash catalog entries before other economical families; explicit
  model/account/settings choices use the shared Models role editor.
- Templates use `bycoda.promptTemplates` and `bycoda:prompt-templates-change`. Verify current name/body/count limits and normalization in the model; preserve explicit Save and disk comparison instead of introducing autosave.
- Preserve exact Chat reveal targets in `src/features/settings/model/settings.ts`, including display, continuation, translation/reprompt, voice-companion and prompt-template controls.
- Desktop controller routes `preferences.desktop.read`, `preferences.desktop.template.read`, `preferences.desktop.patch/status` under `preferences.desktop.v1`; reviewed template body access requires expected revision. Metadata visibility is not unrestricted body-read permission or general Chat-flag management.
- Voice capability families include `voice.local.v1`, `voice.local.setup.v1`; native allowlists and Host locality/active-voice gates must agree. Use the voice feature and `docs/guides/voice.md` when these paths change.
- Phone-local templates in `mobile/src/features/management/templates/template-store.ts`, `template-model.ts`, `template-library.tsx` use `bycoda.mobile.prompt-templates.v1`. Computer-template preferences in `mobile/src/features/workspace/desktop-preferences.tsx` are a different route; do not add automatic library sync by implication.

## Focused checks

Select tests beside TemplatesSettings/promptTemplates, sshSnippets, desktopPreferencesControl, translationPreferences/translation, composerSpelling and changed Settings controls. Recovery changes require their turnRecovery/usageLimit/remoteRecovery tests; voice changes require the voice skill's checks.

Browser entry points: `tests/browser/settings/settings.e2e.ts`, `settings-layout.e2e.ts`, `settings-subviews.e2e.ts`, `settings-organization.e2e.ts`; insertion coverage also belongs with Composer scenarios. Exercise dirty close/navigation, external conflict, validation focus, unavailable storage, failed Save/retry and inherited unsupported provider actions. SSH review, native setup and phone state need separate boundary evidence.
