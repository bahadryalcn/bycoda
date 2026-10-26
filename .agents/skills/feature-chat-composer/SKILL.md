---
name: feature-chat-composer
description: Chat composer inventory for send, queue, steer, stop, drafts, attachments, model/provider/workspace selection, quick composer and translation.
---

# Chat composer

Prepare and deliver turns while preserving drafts, settings, attachments and honest delivery state. Keywords: composer, message input, send, queue, steer, stop, retry, draft, paste, IME, attachments, model, reasoning, workspace, quick composer, translation, reprompt.

Inventory inspected on 2026-10-26 at contracts baseline `f26ac112404e326478adb687c23ca9cc032acfef`. Paths are repository-relative. Re-run searches and inspect recent Git history before editing. This card is an acceptance inventory, not a concurrency lock: check live feature claims and session/workspace ownership across worktrees. `docs/reference/managed-workspaces.md` defines contracts; contract presence does not establish runtime capability.

## Surface inventory

### Desktop composer and dialogs

- `src/features/sessions/ui/AccessPicker.tsx`
- `src/features/sessions/ui/AttachmentChip.tsx`
- `src/features/sessions/ui/AttachmentFilePreview.tsx`
- `src/features/sessions/ui/AttachmentTokenText.tsx`
- `src/features/sessions/ui/BycodaWelcome.tsx`
- `src/features/sessions/ui/Composer.tsx`
- `src/features/sessions/ui/ComposerSuggestions.tsx`
- `src/features/sessions/ui/ComposerTips.tsx`
- `src/features/sessions/ui/ContextMeter.tsx`
- `src/features/sessions/ui/DeliveryProgressNotice.tsx`
- `src/features/sessions/ui/DeliveryReviewChoice.tsx`
- `src/features/sessions/ui/EmptySession.tsx`
- `src/features/sessions/ui/FileMentionPicker.tsx`
- `src/features/sessions/ui/McpServerPicker.tsx`
- `src/features/sessions/ui/ModelExtras.tsx`
- `src/features/sessions/ui/ModelFlyout.tsx`
- `src/features/sessions/ui/ModelPicker.tsx`
- `src/features/sessions/ui/ProviderAccountMenu.tsx`
- `src/features/sessions/ui/ProviderAccountRecoveryDialog.tsx`
- `src/features/sessions/ui/ProviderSignInDialog.tsx`
- `src/features/sessions/ui/ProviderSignInPanel.tsx`
- `src/features/sessions/ui/QueuedMessageEditDialog.tsx`
- `src/features/sessions/ui/SessionDirsPicker.tsx`
- `src/features/sessions/ui/SessionFolderPicker.tsx`
- `src/features/sessions/ui/SessionPane.tsx`
- `src/features/sessions/ui/SessionSurface.tsx`
- `src/features/sessions/ui/SkillTokenText.tsx`
- `src/features/sessions/ui/TranscriptSelectionMenu.tsx`
- `src/features/sessions/ui/TranslationResultDialog.tsx`

### Cross-feature composer UI dependencies

- `src/features/files/ui/FileTypeIcon.tsx`
- `src/features/inbox/ui/InboxMiniCard.tsx`
- `src/features/notes/ui/NoteMiniCard.tsx`
- `src/features/projects/ui/CwdPicker.tsx`
- `src/features/sessions/ui/HandoffMiniCard.tsx`
- `src/features/sessions/ui/HarnessIcon.tsx`
- `src/features/sessions/ui/QuestionForm.tsx`
- `src/features/sessions/ui/UsageLimitNotice.tsx`
- `src/features/sessions/ui/modeCommands.tsx`
- `src/features/skills/ui/SkillPicker.tsx`
- `src/features/source-control/ui/BranchPicker.tsx`
- `src/features/source-control/ui/WorktreePicker.tsx`
- `src/shared/ui/Alert.tsx`
- `src/shared/ui/Button.tsx`
- `src/shared/ui/ConfirmMorph.tsx`
- `src/shared/ui/DropdownMenu.tsx`
- `src/shared/ui/icons.tsx`

### Quick composer, specialized producers and workspace picker

- `src/features/devices/deviceComposer.ts`
- `src/features/devices/deviceImageComposer.ts`
- `src/features/host-tools/browserComposer.ts`
- `src/features/host-tools/logsComposer.ts`
- `src/features/quick-composer/main.tsx`
- `src/features/quick-composer/ui/QuickComposer.tsx`
- `src/features/quick-composer/ui/QuickGitPopup.tsx`
- `src/features/quick-composer/ui/QuickModelSelector.tsx`
- `src/features/quick-composer/ui/QuickPermissions.tsx`
- `src/features/quick-composer/ui/QuickProjectIcon.tsx`
- `src/features/quick-composer/ui/QuickWorkspaceControls.tsx`
- `src/features/workspace/ui/WorkspacePicker.tsx`

### State and submit pipeline

Entire submit pipeline: `src/app/workspace/sessions/submit/`; quick-composer state and launches: `src/features/quick-composer/model/` and `src/features/quick-composer/hooks/`. Review these mutation owners:

- `src/app/workspace/sessions/useQueuedMessageActions.ts`
- `src/features/connections/model/queueState.ts`
- `src/features/connections/model/useSharedLocalQueues.ts`
- `src/features/sessions/data/composerDraftStore.ts`
- `src/features/sessions/hooks/useClearComposerDraft.ts`
- `src/features/sessions/hooks/useComposerTranslationSelection.ts`
- `src/features/sessions/model/attachmentTokens.ts`
- `src/features/sessions/model/attachments.ts`
- `src/features/sessions/model/composerHistory.ts`
- `src/features/sessions/model/composerQueue.ts`
- `src/features/sessions/model/deliveryProgress.ts`
- `src/features/sessions/model/deliveryReview.ts`
- `src/features/sessions/model/messageQueue.ts`
- `src/features/sessions/model/queuePersistence.ts`
- `src/features/sessions/model/queuedMessageEdit.ts`
- `src/features/sessions/model/releaseAttachments.ts`
- `src/features/sessions/model/translation.ts`
- `src/features/sessions/model/translationHistory.ts`
- `src/features/sessions/ui/useCliCommands.ts`
- `src/features/sessions/ui/useComposerSkills.ts`
- `src/features/settings/model/composerSpelling.ts`
- `src/platform/tauri/clipboard.ts`

### Host RPCs/tools and native modules

`host/server.ts` dispatches `sessions.queue.get`, `sessions.queue.change`, `sessions.queue.claim`, `sessions.queue.finish`, `sessions.queue.release`, `sessions.queue.lease`, `sessions.runLease` and `sessions.contextual.preview`; `host/engine.ts` owns provider turn commands. Read the actual command union before altering send/stop/steer. Conversation reads do not authorize sends.

- `host/contextual-session.ts`
- `host/engine.ts`
- `host/server.ts`
- `host/session-authority.ts`
- `host/session-queue.ts`
- `host/session-tools-relay.ts`
- `host/sessionRuns.ts`
- `src-tauri/src/fs/attachment_reads.rs`
- `src-tauri/src/harness.rs`
- `src-tauri/src/pasteboard.rs`
- `src-tauri/src/quick_composer.rs`
- `src-tauri/src/quick_composer/delivery.rs`
- `src-tauri/src/quick_composer/git_popup.rs`
- `src-tauri/src/quick_composer/screenshots.rs`
- `src-tauri/src/session_store.rs`
- `src/integrations/harness/core/conversationToolsBridge.ts`
- `src/integrations/harness/core/runtimeGuidance.ts`

### Locales

Sentence-key catalogs: `src/shared/i18n/locales/`, plus `src/shared/i18n/en-overrides.json` and `src/shared/i18n/tr-overrides.json`. No composer dot-prefix exists. Key families: `Send`, `Sending...`, `Send draft`, `Queue message`, `Queue paused because you interrupted`, `Queued message text`, `Send next`, `Steer`, `Worktree unavailable`. Search Composer and quick-composer translation calls for every affected label.

### Browser fixtures/specs

- `tests/browser/browser-annotation-client.ts`
- `tests/browser/browser-annotation.e2e.ts`
- `tests/browser/browser-annotation.html`
- `tests/browser/browser-annotation.tsx`
- `tests/browser/chat-chrome.html`
- `tests/browser/chat-chrome.spec.ts`
- `tests/browser/chat-chrome.tsx`
- `tests/browser/composer-extras.html`
- `tests/browser/composer-extras.spec.ts`
- `tests/browser/composer-extras.tsx`
- `tests/browser/playwright.composer.config.ts`
- `tests/browser/playwright.sessions-composer.config.ts`
- `tests/browser/question-flow.html`
- `tests/browser/question-flow.spec.ts`
- `tests/browser/question-flow.tsx`
- `tests/browser/quick-composer.html`
- `tests/browser/quick-composer.spec.ts`
- `tests/browser/quick-composer.tsx`
- `tests/browser/serve-composer.mjs`
- `tests/browser/session-preview.tsx`
- `tests/browser/session-recovery.html`
- `tests/browser/session-recovery.playwright.config.ts`
- `tests/browser/session-recovery.spec.ts`
- `tests/browser/session-recovery.tsx`
- `tests/browser/session-recovery.vite.config.ts`
- `tests/browser/session-usability.html`
- `tests/browser/session-usability.spec.ts`
- `tests/browser/session-usability.tsx`
- `tests/browser/text-actions.html`
- `tests/browser/text-actions.spec.ts`
- `tests/browser/text-actions.tsx`
- `tests/browser/transcript-attachments.spec.ts`
- `tests/browser/transcript-long-text.spec.ts`
- `tests/browser/transcript-rewind.spec.ts`
- `tests/browser/vite.composer.config.ts`

## Behavior to preserve

Preserve session-owned drafts across hibernation/remount and account/model changes; IME and shortcuts; pasted files/images/tokens and resource cleanup; independent provider/model/reasoning settings and custom model IDs; first-send workspace errors; queue order/edit/reorder/cancel and lease ownership. Hold unknown delivery, never automatically resend it. Keep pending/error/recovery feedback local and Stop/cancel usable while operations run.

## Acceptance and checks

- Exercise empty/existing/running/recovered/remote sessions; Send/Queue/Steer/Stop; held and failed delivery; changing model/account/reasoning; file mentions, slash commands, browser/device/log attachments, long paste, IME, quick composer and draft restoration.
- Run `pnpm vitest run src/features/sessions/ui/Composer.keys.test.ts src/features/sessions/ui/Composer.ime.test.ts src/features/sessions/ui/Composer.draftOwnership.test.ts src/features/sessions/ui/Composer.queueHeld.test.ts src/features/sessions/data/composerDraftStore.test.ts src/features/quick-composer/ui/QuickComposer.commands.test.ts`; add relevant adjacent attachment/queue/submit checks.
- Open and review screenshots at 1280/800, light/dark, saved under `temp/verification/<id>/`. Include resizing, opened pickers, long names and busy/error controls. Changed send/lease/stop needs isolated Host/native execution. Compare build status before interpreting owner screenshots as new source failures.

## Owner decisions

## Proposals

No additional product changes are proposed by this inventory.

## Known blockers and evidence limits

This frozen checkout has no mobile source directory. Mobile screen enumeration and physical-device acceptance require the mobile source checkout; the shared Host/native paths above do not establish mobile proof. This inventory checks source paths, not installed behavior. Live feature claims and build status depend on serving Host capabilities.

## Committed handoff references

Contracts baseline: `f26ac112404e326478adb687c23ca9cc032acfef`; contracts: `docs/reference/managed-workspaces.md`. On behavior changes, add the implementation commit, focused checks, screenshot paths and build identity. Scratch plans are not shipped behavior.
