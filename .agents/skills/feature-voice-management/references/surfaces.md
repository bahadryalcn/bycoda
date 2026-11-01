# Global voice source map

Source paths are repository-relative. These interfaces reuse existing permissions.

| Concern | Owners |
| --- | --- |
| App scope and management sources | `src/app/App.tsx`, `src/app/workspace/bridges/useVoiceAppBridge.ts` |
| Session/project lifecycle | `src/app/workspace/bridges/useVoiceWorkspaceActions.ts`, `src/features/voice/model/voiceWorkspaceActions.ts` |
| Exact pane close | `src/app/workspace/tabs/useClosePaneActions.ts` |
| Scope/controller and local/cloud routes | `src/features/voice/ui/VoiceCompanion.tsx`; `src/features/voice/model/voiceController.ts`, `voiceAssistant.ts`, `realtimeVoice.ts` |
| Existing tool discovery/execution | `src/features/voice/model/voiceToolCatalog.ts`, `voiceToolClient.ts` |
| Host authenticated routing | `host/voice-tools.ts`, `host/server.ts`; `voice.tools.v1`, `voice.tools.list`, `voice.tools.call` |
| Native transport | `src-tauri/src/remote.rs`; retain explicit allowlist and bounded timeout |
| Unsent draft context | `src/features/sessions/ui/Composer.tsx`, `src/features/voice/model/voiceDraftContext.ts` |
| Document extraction | `src/features/voice/model/voiceDocumentContext.ts`, `voiceDocumentParser.ts`, `voiceDocument.worker.ts` |
| Protocol tool families | `app_context`, `app_tools_list`, `app_tool_call`, `composer_context`, `composer_attachment`; preserve legacy tool compatibility |
| Verification | Adjacent catalog/client/controller/draft/document tests, app bridge/pane tests and `host/voice-tools.test.ts`; current global-voice browser fixture config |

## Attachment limits

Preserve attached-ID lookup, DOM/live draft ownership with cache fallback, exact
source checks after reads and worker cancellation/timeout. Existing document
bounds are input <=8 MiB, text <=32k characters, PDF <=20 pages, workbook <=5 sheets,
100 rows and 30 columns; confirm current parser constants before changing them.
Keep DOCX expansion checks. Documents provide text, not OCR/images/charts.
Actual image payload support differs by provider; unavailable vision stays explicit.

Existing validators own capabilities. Missing APIs must remain unavailable rather
than being synthesized from a voice intent or an owner-only UI route. Mobile and
native/live-provider qualification are separate from browser fixture checks.
