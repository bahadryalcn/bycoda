# Global voice source map

Source paths are repository-relative. These interfaces reuse existing permissions.

| Concern                                 | Owners                                                                                                                                                     |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App scope and management sources        | `src/app/App.tsx`, `src/app/workspace/bridges/useVoiceAppBridge.ts`                                                                                        |
| Session/project lifecycle               | `src/app/workspace/bridges/useVoiceWorkspaceActions.ts`, `src/features/voice/model/voiceWorkspaceActions.ts`                                               |
| Exact pane close                        | `src/app/workspace/tabs/useClosePaneActions.ts`                                                                                                            |
| Scope/controller and local/cloud routes | `src/features/voice/ui/VoiceCompanion.tsx`; `src/features/voice/model/voiceController.ts`, `voiceAssistant.ts`, `realtimeVoice.ts`                         |
| Existing tool discovery/execution       | `src/features/voice/model/voiceToolCatalog.ts`, `voiceToolClient.ts`                                                                                       |
| Host authenticated routing              | `host/voice/voice-tools.ts`, `host/server.ts`; `voice.tools.v1`, `voice.tools.list`, `voice.tools.call`                                                          |
| Native transport                        | `src-tauri/src/remote.rs`; retain explicit allowlist and bounded timeout                                                                                   |
| Unsent draft context                    | `src/features/sessions/ui/Composer.tsx`, `src/features/voice/model/voiceDraftContext.ts`                                                                   |
| Document extraction                     | `src/features/voice/model/voiceDocumentContext.ts`, `voiceDocumentParser.ts`, `voiceDocument.worker.ts`                                                    |
| Protocol tool families                  | `app_context`, `app_tools_list`, `app_tool_call`, `composer_context`, `composer_attachment`; preserve legacy tool compatibility                            |
| Verification                            | Adjacent catalog/client/controller/draft/document tests, app bridge/pane tests and `host/voice/voice-tools.test.ts`; current global-voice browser fixture config |

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

## Application management

- `host/conversation/conversation-management-tools.ts`: explicit schemas, native approval and
  durable request receipts. `host/server.ts` connects canonical domain owners.
- `host/conversation/conversation-session-management.ts`: revision-checked configuration,
  unsent contextual handoff and accepted same-session attachments in drafts.
- `host/conversation/conversation-workspace-management.ts`: preparation, claims, cleanup
  planning and delivery review; destructive cleanup/publication stay owner-only.
- `host/conversation/conversation-project-management.ts`: scoped project paths, organization
  contracts and bounded Git stash/pull inside `host/domains/git/service.ts` locks.
- `host/conversation/conversation-thread-work-tools.ts`: real assistant-thread task/goal/
  automation routes, explicit execution settings and durable uncertain receipts.
- `host/conversation/conversation-thread-crew-tools.ts`, `host/crews/crews.ts`: real-thread Crew
  reads and native-reviewed canonical controls, separate operation/run identities
  and revision revalidation through model discovery and effect admission.
- `src/features/assistant/model/useAssistantControlSource.ts`,
  `src-tauri/src/control.rs`: exact Room thread/Host registration and native
  window lifetime. Application UI routing uses `assistant-ui`, not a synthetic
  conversation ID or cwd.
- `host/conversation/conversation-management-runtime.ts`: projected environment/history/
  sync/tunnel/mobile metadata and bounded committed-change long polling.
- `src-tauri/src/conversation_tools_bridge.rs`: exact operation review; visible
  control-character escaping, native scope and unchanged operation hash.
- `src/shared/model/conversationSessionPage.ts`: list cursor/state/activity
  contract shared by desktop and Host. `voiceToolScope.ts` owns global allowlists.
- `host/voice/voice-capability-coverage.ts` and adjacent test: every Host RPC family has
  explicit supported tool IDs and remaining boundaries; no implicit blanket RPC.
- `src/features/voice/model/voiceToolActivity.ts` and
  `ui/VoiceToolActivityPanel.tsx`: observed waiting/completion/uncertainty,
  request identity and late results; stopping observation does not cancel effects.

Focused management suites live beside these modules. Native approval tests,
session command CAS tests and the server routing tests exercise integration.
# Room resource and disclosure owners

- `host/assistant/room/assistant-room-remote.ts`, `assistant-room-native-target.ts` and Native
  `assistant_room_delegation.rs` retain the original Room, reviewed action set,
  target CWD and uncertain request identity. Remote results do not fabricate local
  project or history provenance.
- `host/assistant/room/assistant-room-inbox.ts` and Native `room_inbox.rs` pin the provider
  account proof, listed record and source directory. Cached results require an
  exact fresh `{current:true}` check before redisclosure.
- `host/assistant/room/assistant-room-social-send.ts` and `host/social/social.ts` bind exact review,
  account grant, policy, project CWD and canonical job state through dispatch.
- `host/assistant/native/assistant-native-library-proof.ts`, `assistant-voice-context.ts` and
  `assistant-native-voice-leases.ts` preserve Native source provenance through
  model use, history, summaries and actual runtime retirement. Native permission
  is independent of project and Social account proofs.

- `host/assistant/room/assistant-room-files.ts`, `host/assistant/room/assistant-room-dev-servers.ts` and
  `host/assistant/room/assistant-room-terminals.ts` adapt canonical resource owners to a real
  Room source. Terminal pipe acceptance does not prove command completion.
- `host/assistant/room/assistant-room-browser.ts`, `src-tauri/src/assistant/room/room_browser_panel.rs` and
  `src/features/host-tools/BrowserPanel.tsx` share the actual Room browser actor.
  Private Native HTTP delivery holds project/device disclosure until response
  write; page readiness and mounted-panel acknowledgement remain separate.
- `host/assistant/room/assistant-room-workspace.ts` and `host/assistant/native/assistant-workspace-owner.ts`
  retain immutable Native workspace intent and distinguish owner acceptance
  from actual execution completion. Unknown intents do not replay.
- `host/assistant/summary/assistant-thread-summary.ts`, `host/assistant/native/assistant-visibility-admission.ts`
  and `src-tauri/src/privacy_account_capture.rs` retain actual Global Room
  issuer and contributing project CWD/account grant proofs through provider
  settlement and artifact commit. Account-only access invents no project.
- `host/conversation/conversation-tools.ts` filters Room-only actions from Session discovery
  and rejects execution under a Session source. Full catalog presence alone
  does not establish target readiness.
