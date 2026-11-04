# Assistant source owners

Paths are repository-root relative. Follow only the lane affected by the change.

- Manual supervision: `host/assistant-manual-sessions.ts`, `host/store.ts`. Candidate discovery selects bounded recent metadata before transcript hydration and batches canonical owner lookups; enrollment revalidates visibility, ownership and the exact source token.
- Core: `host/assistant/service.ts`, `repository.ts` there,
  `host/assistant-runtime.ts`, `host/assistant-domain.ts`.
- DTOs: `src/shared/model/host-contracts/assistant.ts`.
- Workers and withdrawal: `host/assistant-sessions.ts`,
  `host/assistant-session-runtime.ts`, `host/assistant-questions.ts`,
  `host/engine.ts`, `host/server.ts`, `host/store.ts`.
- Queue priority and measured worker cache: `src/shared/model/assistantJobPriority.ts`,
  `host/assistant-cache-usage.ts`, `host/assistant-runtime.ts`.
- Read-only task badges: `host/assistant-task-metadata.ts`, `host/tasks.ts`,
  `src/features/tasks/ui/AssistantTaskBadge.tsx`. Cache by task revision and canonical
  source membership; metadata invalidation cannot block accepted-action bookkeeping.
- Header withdrawal: `src/features/assistant/model/assistantSessionDetach.ts`,
  `src/features/sessions/ui/AssistantSessionControl.tsx`, `SessionPane.tsx` there.
- Decisions: `host/assistant-owner-questions.ts`,
  `src/shared/model/assistantOwnerQuestions.ts`.
- Quick schedules: `host/assistant-quick-automations.ts`.
- Context: `host/assistant-chief-context.ts`, `host/assistant-text.ts`,
  `host/assistant-thread-summary.ts`, `src/shared/model/assistantContext.ts`.
- Room/setup/drafts/notifications: `src/features/assistant/`.
- Room Sessions: `ui/AssistantSessions.tsx`, `AssistantSessions.module.css` and
  `ManualSessionSupervision.tsx` in that feature. Keep job-session filters distinct
  from manual enrollment scope; unconfirmed supervision policy is Unknown, not Off.
- History: `src/features/assistant/ui/AssistantHistory.tsx` and its CSS module.
  Groups activity by local calendar day, newest first; Room owns query/type
  filtering and the existing clear-history confirmation and Host operation.
- Memory collection and editor: `src/features/assistant/ui/AssistantMemoryPanel.tsx`,
  `MemoryEditor.tsx` and `AssistantMemoryPanel.module.css`. Room retains Host-bound
  mutation, version checks, confirmation and undo ownership.
- Room settings: `src/features/assistant/ui/AssistantSettings.tsx` and its CSS module; shared profile fields remain in `AssistantProfileFields.tsx`. Manual project scope belongs to `ManualSessionSupervision.tsx`; computer permissions and helper setup belong to `src/features/host-tools/DesktopControlSettings.tsx` and `DesktopHelperSetup.tsx`.
- Notes presentation: `src/features/assistant/ui/AssistantNoteCard.tsx` and its CSS
  module. Room owns search, daily summaries, Host-bound note drafts, versioned
  deletion confirmations and undo receipts; cards only present and open notes.
- Room composition: `src/features/assistant/ui/AssistantView.tsx` and its CSS
  module. Jobs keeps its creation input before the collection in DOM and focus
  order; empty-result reset clears collection filters without changing the draft.
  Presence presentation: `model/assistantPresencePresentation.ts` and
  `ui/AssistantPresenceIndicator.tsx`, `AssistantPresenceStatus.tsx`,
  `AssistantPresenceMenu.tsx` under that feature; TitleBar consumes the same menu.
- Project display metadata: `host/project-display-names.ts`, `host/desktopLive.ts`,
  `host/server.ts`; voice aliases and finite resolution:
  `src/features/voice/model/voiceProjectNames.ts`, `voiceWorkspaceActions.ts` there.
- Desktop: `host/desktop-control-host.ts`, `host/conversation-desktop-control-tools.ts`,
  `src-tauri/src/conversation_tools_bridge.rs`.
- Voice: `src/features/voice/model/realtimeVoice.ts`, `voiceOverlay.ts` there,
  `src/features/voice/ui/VoiceCompanion.tsx`.
- Presence: `src-tauri/src/presence.rs`; Windows idle/lock, explicit unsupported elsewhere.
- Mobile: nested `mobile/src/features/assistant/` and `mobile/app/assistant.tsx`.
  Read the nested rules and feature-mobile skill before changes.

User behavior belongs in `docs/guides/assistant.md`. Verification and build inclusion
belong in the task handoff, not this source map.
