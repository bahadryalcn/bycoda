---
name: feature-chat-settings
description: Use when changing Chat preferences, prompt templates and translation defaults. Not for message sending; see feature-chat-composer.
---

# Chat settings development

Use for Chat Settings composition, conversation display preferences, continuation toggles, prompt-template management and translation/reprompt defaults. Use [composer](../feature-chat-composer/SKILL.md) for send/queue/insertion runtime, and [voice](../feature-voice/SKILL.md) for setup/audio behavior.

## Source starts

- `src/features/settings/ui/ChatSettings.tsx`, `ConversationDisplaySettings.tsx`, `TemplatesSettings.tsx` and `TranslationSettings.tsx` own page controls.
- `src/features/sessions/model/promptTemplates.ts`, `translationPreferences.ts` and `src/features/settings/model/settings.ts` own relevant preference data.
- Read [surfaces](references/surfaces.md) for template/SSH/mobile routing and focused tests.

## Preserve

- Keep separate chat width, code wrapping, transcript mode, anchor, streaming/pacing and spelling preferences; layout simplification must retain search/reveal IDs.
- Prompt names, bodies, optional triggers, stable IDs, limits and frontmatter-free template content keep their actual model validation. Delete remains draft-only until explicit Save.
- Keep window-lifetime template drafts, disk/storage comparison baselines, selection and conflict recovery across close/navigation. Unreadable or corrupt storage blocks overwriting it.
- Slash and trigger expansion insert without sending; keep cursor placeholders, ordinary draft/attachments/IME and reviewed SSH snippet identity.
- Continuation preference changes do not expand recovery/send authority. Runtime idle/reset/grace/queue and remote fresh-identity gates remain with recovery owners.
- Translation and reprompt inherit independently; keep action account/model/project/machine identity and explain unsupported choices without silent substitution.
- Conversation title generation has its own model/account preference. Automatic selection uses an enabled economical catalog entry, never the conversation's expensive model as an implicit fallback; unsupported catalogs require a choice.
- Voice enabled is saved intent, not runtime readiness. Settings must keep setup job identity and visible recovery; audio/install/locality gates belong to voice owners.
- Keep same-/sibling preference updates, failed-edit retry and local outcome truth; a later external write must not silently erase a dirty editor.

## Workflow

1. Trace the edited preference/template through storage and consumers; follow Composer/SSH or reviewed desktop control only if that behavior changes.
2. Use shared Settings rows and bounded searchable collections; keep explicit Save and keyboard focus when changing menu/editor composition.
3. Select colocated tests from the map, then exercise deep links, leave/return drafts, conflict/read/save failure, sibling updates and inherited unsupported choices.

## Focused checks

Run colocated TemplatesSettings/promptTemplates, sshSnippets, desktopPreferencesControl, translationPreferences/translation and composerSpelling tests. Browser coverage lives in `tests/browser/settings/`.

## References

- Read [surfaces](references/surfaces.md) for storage keys, capability identifiers, mobile differences and verification pointers.
- For Settings shell/shared row work also read [Settings](../feature-settings/SKILL.md); avoid loading unrelated Settings pages.
