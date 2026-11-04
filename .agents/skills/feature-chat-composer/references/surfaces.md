# Composer surface map

Paths below are repository-root relative. Use this map for cross-producer, persistence or transport changes; re-search callers rather than treating it as a runtime capability list.

## Input and choices

- `src/features/sessions/ui/Composer.tsx`, `ComposerSuggestions.tsx`, `ComposerTips.tsx`, `QuestionForm.tsx`, `QueuedMessageEditDialog.tsx`: input, suggestions, questions and queue editing (basenames are in the same UI directory).
- In that directory, `ModelPicker.tsx`, `ModelFlyout.tsx`, `ModelExtras.tsx`, `ProviderAccountMenu.tsx`, `ProviderAccountRecoveryDialog.tsx`, `ProviderSignInDialog.tsx`, `AccessPicker.tsx`, `SessionDirsPicker.tsx` and `SessionFolderPicker.tsx` compose choices; policies remain with their domain owners.
- `AttachmentChip.tsx`, `AttachmentFilePreview.tsx`, `AttachmentTokenText.tsx`, `SkillTokenText.tsx`, `FileMentionPicker.tsx`, `McpServerPicker.tsx`, `TranslationResultDialog.tsx`, `TranscriptSelectionMenu.tsx` preserve attachment/token/translation/selection actions.
- `AttachmentIdentity.tsx`, `ComposerAttachmentHighlight.tsx` and model
  `attachmentPresentation.ts` own attachment type presentation. Keep editable
  reference text and native textarea metrics unchanged; presentation kinds do
  not extend provider kinds or change persisted token identities.
- `src/features/quick-composer/` owns popup UI, model/hooks and native launch coordination; `src/features/workspace/ui/WorkspacePicker.tsx` is the shared workspace choice.
- `src/features/devices/deviceComposer.ts`, `src/features/devices/deviceImageComposer.ts`, `src/features/host-tools/browserComposer.ts`, `src/features/host-tools/logsComposer.ts` produce contextual input. Notes, Inbox, Skills and source-control pickers remain adjacent feature owners.

## State and effects

- `src/features/sessions/model/questionDrafts.ts` retains answer text and durable per-question file metadata; `questionAttachments.ts` saves blob inputs before dispatch. `userQuestion.ts` builds replies and provider-readable references. `src/features/connections/model/remoteQuestionAttachments.ts`, `src/features/connections/ui/RemoteSession.tsx` and `host/engine.ts` upload, validate and resolve files on the executing Host. Remote question files require the explicit `sessions.questionAttachments` capability.

- `src/app/workspace/sessions/submit/`, `src/app/workspace/sessions/useQueuedMessageActions.ts`: preparation and dispatch.
- `src/features/sessions/data/composerDraftStore.ts`; session model basenames `composerQueue.ts`, `messageQueue.ts`, `queuePersistence.ts`, `queuedMessageEdit.ts`, `attachments.ts`, `attachmentTokens.ts`, `releaseAttachments.ts`, `translation.ts`, `translationHistory.ts`, `deliveryProgress.ts`, `deliveryReview.ts` under `src/features/sessions/model/`.
- `src/features/connections/model/queueState.ts`, `src/features/connections/model/useSharedLocalQueues.ts`: shared queue projection and leases.
- `host/session-queue.ts`, `host/engine.ts`, `host/contextual-session.ts`, `host/session-authority.ts`, `host/sessionRuns.ts` and authenticated dispatcher `host/server.ts`. Queue operations include `sessions.queue.get/change/claim/finish/release/lease`; also inspect `sessions.runLease` and `sessions.contextual.preview` in their current schema before changing a wire.
- `src-tauri/src/quick_composer.rs` and `src-tauri/src/quick_composer/` own native popup/delivery lifetime; `src-tauri/src/fs/attachment_reads.rs`, `src-tauri/src/pasteboard.rs`, `src-tauri/src/harness.rs`, `src-tauri/src/session_store.rs` own their existing native effects/storage.

## Verification entry points

- `src/features/sessions/ui/Composer.keys.test.ts`, `Composer.ime.test.ts`, `Composer.draftOwnership.test.ts`, `Composer.queueHeld.test.ts` in the same directory; `src/features/sessions/data/composerDraftStore.test.ts`; `src/features/quick-composer/ui/QuickComposer.commands.test.ts`.
- Browser families under `tests/browser/`: `composer-extras`, `quick-composer`, `question-flow`, `text-actions`, `chat-chrome`, `transcript-attachments`, `session-usability`; select their existing config and affected states.
- Search actual sentence keys in `src/shared/i18n/locales/` and override catalogs; do not invent a composer key namespace.
- For mounted-input recovery and original operation admission, consult repository-root `docs/reference/host-runtime.md`; for execution policy, `docs/reference/managed-workspaces.md`. These contracts do not establish serving-build inclusion.
