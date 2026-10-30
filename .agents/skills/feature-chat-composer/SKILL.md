---
name: feature-chat-composer
description: Chat composer inventory for send, queue, steer, stop, drafts, attachments, model/provider/workspace selection, quick composer and translation.
---

# Chat composer

## Original follow-up and manual-operation context, 2026-10-30

Registry captures a steer submission, actual adapter and original operation
before queue waits. A failed/unentered source cannot forward the follow-up to
its predecessor or replacement. Epoch/source checks run again after async
preparation and the synchronous onReady callback, so reentrant Stop/replacement
cannot dispatch a stale steer. Compact/edit/steer copy caller identity before
deferral. Preparation-only Stop invalidates that submission without creating a
provider startup tombstone for the next fresh message.

Standalone compact/edit now receive their own Native control turn; the compact
hook and edited-send dispatcher forward persisted Operator/orchestration/account
context consistently with normal send. Existing drafts, storage keys, layouts,
keyboard/queue behavior and controls are preserved. This is functional adapter
work with no new visual surface. Local checks live under
`temp/verification/2026-10-30-warm-control/`; Native CLI/MCP/raw actor closure and
current GUI/device/installed acceptance remain separate OPEN work.

## Bounded question conservation, 2026-10-30

QuestionForm reserves a bounded questionDrafts lineage in layout before accepting
input. The shared store keeps at most64 lineages/4MiB total/1MiB per lineage, refuses
new/oversize writes without evicting unfinished data, and restores rejected live
DOM input to the previous retained value. Exact Unicode, whitespace, CRLF and
empty values are data. Semantic question changes retain separate drafts, including
behavior/header/dismiss-action and literal option metadata. Pending/unknown records
cannot be ordinarily discarded; only authoritative question resolution retires
them. Unscoped mounts have private bounded owners, no guessed cross-mount identity
or restoration. Explicit profile Parent scope is shared across logical closures;
undefined scope alone remains unassigned. Fixture and focused source evidence:
`temp/verification/2026-10-30-decision-inputs/`; no installed/crash-recovery proof.

## V2 2026-10-30: reading-mode composer and message actions (uncommitted)

Source delivered in the shared checkout; no commit. Fixture evidence only, no native or installed acceptance.

- V2-001 reading mode: the transcript follow owner reports reading-history intent
  (`useTranscriptFollow.ts` `onReadingChange`, latched from `stickToBottom`; content growth, resize and the
  compaction clamp do not clear it; 160 px entry gate in `composerReading.ts`). `useComposerEngagement.ts`
  treats focus, press, click, drag and IME inside the dock and its portalled menus as engagement; a departure
  parked in an outside overlay or another window is re-checked every 250 ms. `SessionPane.tsx` keeps full
  layout while a question, earlier-turn edit or Btw sheet is open. `Composer.tsx` gets `reading`
  (`data-composer-reading`, textarea `rows` 1, workspace row hidden unless error/pending/removed worktree);
  the same textarea and draft owner remain mounted. Height cap in `model/composerResize.ts`: 20% of window
  height clamped to 68–132 px, internal scroll beyond. Motion: `useComposerReadingMotion` (180 ms, none under
  reduced motion). Proposal awaiting owner confirmation: the workspace row (checkout/branch/project/tip) is
  hidden while reading; one-line change in `chat-controls.css` restores it.
- V2-002/010 message actions: `TranscriptMessageActions.tsx` renders Copy, Save, Handoff, Second opinion and
  Turn metrics as one icon-only shared `FloatingButtonGroup` ("Message actions" toolbar). `useCopyFeedback`
  per action: single flight, success only after the clipboard/Notes write resolves, failure keeps a
  "Retry copy"/"Retry save" danger icon plus an inline `role=alert` reason. `CopyTurnButton` sound now plays
  after the copy resolves. Adapter (`arc/floating-button-group`) gained typed `tone`, `tooltip` and
  `render(renderTrigger)` for popup triggers.
- Checks: browser suite `composer-compact` (registered in `tests/browser/suites.json`, chromium 30/30 and webkit 29 + 1 Chromium-only skip through
  `browser-tests.mjs`; includes density, Chromium IME, drag and touch tap cases); unit tests `composerReading`, `useComposerEngagement`, `useComposerDockMotion`,
  `composerResize`, `AgentTranscriptReading`, `TranscriptMessageActions`, `AgentTranscript.copy`.
  Screenshots: `temp/verification/v2-001/`, `temp/verification/v2-002/`.
- Not verified: real IME session, OS file drop, WebKit/native rendering, density variants.

## Owned Parent input admission, 2026-10-29

`beginParentInputClosure` gates the actual QuestionForm/cache, SessionPane,
Composer, queue-edit, Btw and skill-create owners before checkpoint draining.
Private tickets distinguish previously accepted continuations from new actions.
The Raw Composer per-attempt `whenSettled` signal includes the real persistence
acknowledgment; returning from a preparation callback does not finish its Parent
work. An explicit retry keeps the original intent rather than creating a resend.

Pending React or external model changes invalidate conservatively. IME is never
committed or blurred to obtain a capture. Native release acknowledgment controls
reopening after cancellation; observation timeout alone does not authorize it.
Known UI route closure does not establish provider decisions or complete actor
coverage. Current verification is recorded in
`temp/verification/2026-10-29-input-admission-root/`.

## Parent input checkpoint capture, 2026-10-29

The passive `parentInputClosure.ts` registry connects real QuestionForm/cache,
SessionPane, Composer, queue-edit, Btw and nested skill-create state to the
private checkpoint. Captures preserve unsent text/options, original queue,
question/child identities and accepted-unknown dispatch input through remounts.
Throws from a callback do not prove rejection. Normal drafts, question discard,
editing, send callbacks and provider/permission authority remain unchanged.

Question cache remains renderer-local in its normal path. A separate private
checkpoint may retain earlier state; no public raw-body read, automatic question
restore or decision grant is added. Passive capture alone does not close input;
the owned gates above are separate. Actual decision conservation and auxiliary
actors outside this phase remain missing coverage.

`nativeProjectionCheckpoint.ts` captures Parent/editor leases after the existing
strict drain, checks both at prepare/verify/status, and carries identical v2 bytes
into the original Native FULL artifact. Cancellation keeps actual late capture
work charged and releases its eventual lease. Unknown verification stays unknown.
Evidence: `temp/verification/2026-10-29-parent-buffers-root/` and the Parent packet.

## Exact raw checkpoint data, 2026-10-29

The Host migration checkpoint path retains actual mounted Composer captures
instead of dropping their snapshots. Exact text, including empty/whitespace,
opaque attachment/MCP JSON and own undefined object members are represented in
the bounded `nativeRawCapture.ts` codec. The ordinary saved-draft serializer and
its empty-clear semantics stay separate. IME, revision, retirement and prepare
lease checks still control acceptance.

`nativeProjectionCheckpoint.ts` sends the same immutable raw bytes at prepare and
verification. After a rejected verification IPC, it may issue one bounded
read-only query for the original retained raw artifact; this diagnostic never
converts the failed verification to success or resends the operation. Native
stores raw data with the actual parent in one FULL transaction. Unassigned
mounts remain explicitly unsupported coverage, including Quick composer cases.

No frame, action, draft-default or provider authority change is introduced.
Parent/Buffers coverage and automatic historical migration remain unqualified.
Current evidence: `temp/verification/2026-10-29-raw-composer-renderer/` and
`temp/verification/2026-10-29-raw-composer-full-root/`. Uncommitted source; native,
installed and physical durability acceptance must be reported separately.

## Composer frame correction, 2026-10-28

Owner, session `0567326f-aade-4baa-89f3-b44c6256ae9e`:

> böyle border filan geldi fokus olunca bunları istemiyorum mesela solda sağda altta üstte şerit çizgiler istemiyorum mesela bunlarıda toparlamak gerekiyor.

Normal `[data-composer-box]` no longer receives a visible surrounding field
focus frame; `src/styles/bycoda.css` uses the owning surface and caret instead.
The workspace toolbar in `Composer.tsx` no longer paints a second attached
outlined box. Toolbar keyboard focus remains local; explicit earlier-turn edit
and attachment-drop borders retain their operation meaning through the existing
editing marker and the new `data-composer-dragging` marker. System forced-colors
rules remain authoritative. Draft, send/queue/steer and workspace logic unchanged.

Source-only T1 change on shared dirty `main@4de508dea`; no application tests,
captures, build or install were run under the owner's deferred-test instruction.
`git diff --check` passed. Light/dark, narrow, keyboard, high-contrast and actual
native rendering remain unverified; see
`temp/local/2026-10-28-composer-focus/README.md`. This does not close C01 or the
whole Composer redesign.

## Host migration persistence foundation (2026-10-28)

`sessions/data/persistenceDrain.ts`, `sessionStore.ts`, `composerDraftStore.ts`
and `sessions/model/draftCache.ts` now retain actual accepted persistence work,
sticky failures and target-aware observation. Scheduled draft work is admitted
before its debounce and owns its lifetime through attachment spill and native
row acknowledgement. Accepted clear/delete lineage crosses cache listeners;
genuinely later edits still invalidate observation while preserving local data.
Native void-null success is distinct from a transcript CAS that did not apply.

New strict data flush APIs supplement legacy flushes. Legacy return/error/timing,
empty clears, retries and separate workspace/in-flight chains remain preserved.
HMR module reuse retains accepted jobs, failures and prior pending hooks in order;
no forced reload, composer unmount or automatic profile-wide flush is introduced.

Current evidence:296/296 source/fixture tests across22 files, normal Host/web
tsc-rs, scoped formatting/diff; three unchanged lint warnings. Independent review
found two lineage/timer issues, now fixed with red/green regressions under
`temp/verification/2026-10-28-renderer-persistence-drain/`.

This is not complete composer drain. Observations explicitly remain unqualified.
Actual mounted DOM text/attachment refs/tags, pending paste/picker preparation,
quick-composer producers, final provider-output application, native challenges and
editor-buffer checkpoint receipts remain separate integrations. Cache mutation or
a flush promise cannot certify unpublished component state. No UI, provider,
permission, native execution default, live session or installation was changed
by this source slice.

## V94 Edit from here integration (2026-10-27)

T2 integration on `release/0.6.94`, starting at `c81d06971`. The owner's V94
stream brief requires "W1's OFF setting must not disable W3's per-message file
history". Live feature-claim APIs are unavailable in this session; the owner's
W1/W2/W3 handoffs and explicit V94-I assignment establish the coordination scope.

Delivered surface checklist:

- Done: `AgentTranscript.tsx`, `EditFromHereDialog.tsx`, `SessionPane.tsx` and
  `Composer.tsx` under `src/features/sessions/ui/`: keyboard-reachable action,
  shared confirmation, clicked-action pending/error state, unsent prompt and
  attachment restoration, and skipped-file notices.
- Done: `src/features/sessions/model/editFromHere.ts` routes native
  `session_files_revert_plan` / `session_files_revert` and owner-authenticated
  Host `sessions.files.revertPlan` / `sessions.files.revert`, preserving plan
  tokens, conflict reasons and old-Host capability fallback.
- Done: `src/app/workspace/sessions/submit/submitTurnDispatch.ts` begins bounded
  history under the accepted user message ID for Current and lightweight
  Worktree turns; the experimental managed lifecycle remains separate.
  `src/features/sessions/model/checkpoint.ts` carries that ID and explicit
  experimental flag to native `session_checkpoint_begin_turn`.
- Done: `src/app/workspace/sessions/useCompactAndRewind.ts` replays retained
  conversation without opaque provider file rewinds, persists the replacement
  before retiring removed history with `session_files_forget_from_message`.
- Done: `src/features/connections/ui/RemoteSession.tsx`, `host/engine.ts`,
  `host/checkpoints.ts`, `host/session-file-revert.ts`, `host/server.ts` and
  `src-tauri/src/checkpoint/file_revert.rs` own remote/native routing, bounded
  history, conflict rechecks and successful-rewind history retirement.
- Done: Codex file-change notifications retain authoritative `fileChanges`
  evidence in `src/integrations/harness/providers/codex/codexProtocol.ts`.
  `src/app/workspace/helpers/workspaceNotify.ts` routes successful post-write
  notifications to native `session_checkpoint_file_changes`; Host uses the same
  proof path. Silently taking a pre-edit snapshot after the edit is forbidden.
  Delete/add chains retain their actual initial contents; update hunks are
  reversed only when their evidence validates. Missing or unsupported proof
  makes history unavailable. Protocol and dispatch delivery: `d6cb4db10`,
  `ab4c20ffb`; live native acceptance discovered this integration requirement.
- Done: eight catalogs under `src/shared/i18n/locales/`; browser fixtures
  `tests/browser/edit-from-here.spec.ts` and `transcript-rewind.spec.ts` cover
  dialog choices, unavailable history, failures and attachment drafts.

Preserve exact selected-message boundaries, earlier steers, drafts, attachment
identity, permissions, partial-success retry and foreign filesystem edits.
No mobile sources are changed in this integration. Native acceptance uses
`scripts/build/acceptance-native.mjs --suite v94` with real Codex and fake
repositories in an isolated dev profile. Results and build inclusion are recorded
in `temp/verification/v94i/`; fixture evidence and source checks do not establish
installed or released acceptance. See `docs/guides/managed-workspaces.md` for the
user workflow. Existing W2 delivery commits: `9ba9a6a9`, `d01bc825`.
The maintained dev runner can continue only a stopped, validated run's isolated
profile with `--reuse-profile-run`, keeping completed acceptance turns and drafts
while using a new immutable executable and newly allocated ports (`18d5159f7`).

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

- 2026-10-27, owner D1 stream brief in the `fix/default-current-checkout` session:
  "current checkout ile başlasın yeni bi session; kendi worktree aç diye zorluyor muyuz biz?"
  New sessions default to **Current checkout**; **Worktree** remains an explicit
  session choice or stored project policy. This supersedes the C1 unset-choice
  restriction below; a resolved worktree still must never silently fall back.

## Proposals

No additional product changes are proposed by this inventory.

## Known blockers and evidence limits

Contextual handoffs and second opinions still use forced managed creation in the
concurrently owned `host/engine.ts` handoff block and
`host/managed-workspace-runtime.ts:prepareContextualWorkspace`. They require the
handoff owner's coordinated policy/current update; D1 does not establish current
default acceptance for those paths.

This frozen checkout has no mobile source directory. Mobile screen enumeration and physical-device acceptance require the mobile source checkout; the shared Host/native paths above do not establish mobile proof. This inventory checks source paths, not installed behavior. Live feature claims and build status depend on serving Host capabilities.

## Committed handoff references

### H1 provider/model handoff capacity (2026-10-27)

Owner decision, H1 stream brief in this session: "Never block a send because of
the handoff budget" and "The provider still reports a genuine \"request too
large\" error itself."

- `1b9ec43a`: Codex and Claude discovery retain finite positive context capacity.
- `a1a75b67`: `handoffBudget.ts` drops history, recap, then the saved-history
  reference as capacity shrinks. Empty handoffs yield a persistent `info` notice
  with the archive path. The request stays intact. Capacity uses discovered
  identity, bundled identity, then a budget fallback of 128,000 for Codex/Claude
  or 32,000 for other harnesses. These defaults are estimates, not provider limits.
- `1836c4c8`: desktop budgets the prepared request after runtime/skill policy
  guidance, including separate Codex runtime instructions. The newly submitted
  user block is excluded from earlier history to prevent replaying it twice.
- `9192d03e`: Host budgets prepared skills/runtime/replay context once and resets
  the outgoing provider thread even when optional handoff text is empty.
- `bdeaa630`: once the recap cannot fit, only the readback reference remains;
  smaller history entries cannot reappear ahead of the dropped recap.
- `dd0d42d6`: Host budgets the machine-owned disabled-skill restrictions through
  the production provider wrapper. This send uses the accepted policy snapshot
  for accounting and dispatch; subsequent sends refresh the snapshot. Unprepared
  inputs still receive machine policy, and serialized overrides cannot bypass it.
- `8f9f8d7f`: capacity identity matching preserves custom native colon prefixes and
  URLs; one provider's `provider:model` capacity cannot leak to another provider.
- Checks: `check:web:fast` passed 12,411 tests with 15 skipped across 1,282 files,
  followed by fast web/Host TypeScript compilation. After the final native-ID fix,
  focused handoff/model/desktop regressions passed 94 cases and fast web/Host
  TypeScript checks passed again. Host engine/provider checks passed all 133 cases;
  archive storage passed its focused case. Repository hygiene passed. Evidence stays in
  `temp/verification/h1/`. No existing browser fixture covers handoff notices;
  this is a text-only change using the existing transcript notice row. Native,
  installed-app and provider acceptance are unverified; no installer was built.
- User guidance: `docs/guides/chat-artifacts-and-connected-files.md` describes
  saved history and the non-blocking notice. Live claim APIs were unavailable;
  the owner assigned this stream `fix/handoff-budget` / `wtm-handoff`, excluding
  the parallel native managed-turn files.

Contracts baseline: `f26ac112404e326478adb687c23ca9cc032acfef`; contracts: `docs/reference/managed-workspaces.md`. On behavior changes, add the implementation commit, focused checks, screenshot paths and build identity. Scratch plans are not shipped behavior.

Inventory delivery: `4454ce32` on `bycoda/wt-model/s7` commits this code-backed
card and the worktree-first documentation. This reference establishes inventory
delivery only; product/runtime acceptance remains as described above.

## C1 older-Host creation compatibility (2026-10-27)

Historical implementation evidence: D1's later decision above supersedes the
unset-choice admission restriction below. Resolved worktree admission remains.

Owner decision, C1 stream brief in this session: "When the owner explicitly chose
`current` ("Current checkout"), an older Host must not block" and "Never silently
fall back when the mode is unset/worktree."

- `386450ff`: `src/features/workspaces/model/workspaceCreation.ts` skips managed
  capability/policy loads for explicit current, drops stale results and reloads
  on Host recovery/capability notifications. Remote recovery is environment
  filtered; local recovery and capability notifications use the existing global
  subscription because it provides no synchronous local-machine identity.
- `0179bfc6`: `src/features/connections/ui/RemoteSession.tsx` admits explicit
  current on a known older Host in send, draft-save and shell-command creation.
  Legacy creation omits the reserved session ID and retains the command ID.
  Missing descriptors and unset/worktree choices remain gated.
- `59ee0007`: `Composer.tsx`, shared `WorkspaceCreationStatus.tsx` and
  `src/features/connections/model/bundledHostStatus.ts` show the active-session
  update explanation only for the native busy deferral reason. The shared Button
  action sets this draft's explicit current choice and preserves its contents.
  Unknown activity, failed installation and remote Hosts retain update-required
  feedback. All eight catalogs and the Turkish editorial override contain both new
  messages; `17927873` keeps English identity messages in the source-key fallback.
  `LocalHostUpdateNotice.tsx` reuses the same read-only status hook.
- `67857091`: `tests/browser/composer-host-compatibility.*` exercises old-Host
  explicit current, deferred update/action, ordinary update-required feedback and
  reconnect recovery using the real Composer/hook and a fake native boundary.
  With compact follow-up `72c9927c`, Chromium passed 10 cases; 12 captures were
  opened in light/dark at 1280, with the changed error/action row additionally
  checked at 800. Evidence:
  `temp/verification/c1/BROWSER.md`. RemoteSession passed 120 cases; focused
  preserved-interaction/workspace checks passed 66 cases. Final focused
  client/hook/Composer checks passed 29 cases.
- `496688b4`: the compact composer error row uses the same action and pending
  local update explanation when the workspace footer is hidden. The owner choice
  still preserves the draft and releases Send only after explicit selection.
- `7509f4ca` (test constructor correction `54952faa`):
  `src/features/workspaces/model/workspaceClient.ts` returns a stable
  `WorkspaceCapabilityError`; the hook keeps an `updateRequired` flag so changing
  language cannot hide the recovery action. An English-to-Turkish transition is
  exercised with a preserved draft. The unchanged 10-case browser suite also
  passed on this final product source.

Final full `pnpm check:web:fast` passed: 1,277 files, 12,398 tests, four skipped
files/15 skipped tests, plus fast tsc-rs. `pnpm check:types:rust:fast`, formatting
and repository hygiene passed. The locale checker retains exactly the baseline's
5,359 catalog issues; C1 introduces no additional catalog diagnostics. Final logs
and command ledger: `temp/verification/c1/CHECKS.md`.

Source baseline: `745f4644` (0.6.91), branch `fix/composer-current-checkout`.
No installer, installed-app, actual old/upgraded Host or provider acceptance is
established by these source/fixture checks. Live feature-claim tooling was not
available in the worker session; ownership came from the explicit C1 brief.

## Click-only tips (2026-10-27)

- `ComposerTips.tsx`, shared by both Composer footer variants: hovering/focusing
  does not open tips. The closed action is **Tip**; activation opens the current
  hint and changes the action to **Next tip**. Later activations advance the hint.
  Outside click/Escape dismisses it; pointer leave/blur does not dismiss it.
- Existing translations, focus/inactive/hidden cycling pauses and Fold Text motion
  remain. Trigger `aria-expanded` and `aria-describedby` reflect actual visibility.
- Source delivery is uncommitted on `main`, baseline `0a42b1ab4`; no delivery
  commit exists yet. Focused unit/browser checks and opened light/dark captures
  are recorded in `temp/verification/2026-10-27-click-tip/README.md`.
  Installed source identity is unknown because build-status inspection timed out;
  fixture checks do not establish installed-app acceptance.

## Chat Settings and prompt-library audit dependency

2026-10-27 owner requests simpler Settings > Chat and suggests template-menu
placement. T2 inventory/quote/12 records/18 families are maintained in
`.agents/skills/feature-chat-settings/SKILL.md`; repair register/brief:
`temp/local/2026-10-27-settings-chat-audit/`.
This extension does not redesign the whole composer or supersede click-tip work.
Preserve main Composer slash/;trigger+Space/ {{cursor}} insertion without send,
draft/attachment/IME ownership and template IDs shared with SSH reviewed snippets.
Quick Composer and phone templates do not have established desktop-library parity.
New menu must retain actual editor/explicit Save/conflict/draft handling and
Settings search focus.315 baseline tests pass, no product source/manager change
or send/voice/template/preference mutation delivered by this audit.
||||||| temp/local/2026-10-27-sync-main/.agents_skills_feature-chat-composer_SKILL.md.base

## D1 new-session default (2026-10-27)

Branch `fix/default-current-checkout`, source baseline `0a42b1ab` (0.6.92):

- `ce2d915b`: `Composer.tsx`, `workspaceCreation.ts`, `sessionWorkspace.ts` and
  `RemoteSession.tsx` show **Current checkout** by default. Explicit worktree and
  project-policy worktree still require managed admission; preparation failures
  remain retryable without changing mode or losing drafts. Known older Hosts use
  compatible current creation for send, draft and shell-command paths.
- Host creation/policy resolution: `0f9d0f15`; scheduled writer policy:
  `65910028`; optional native automation JSON mode: `22a550bf`. Desktop automation
  defaults and task controls: `c0ecb0a0`; selected goal checkout preservation:
  `841298dd`.
- `df1d62d0`: quick composer distinguishes an inherited default from explicit
  Current checkout, displays the resolved project policy, and keeps Worktree
  capability errors/draft recovery. Explicit selection of the project checkout
  survives launch and overrides a worktree project policy.
- Focused UI passed 192/192 (`temp/verification/d1/ui-fast-tests.log`), and
  RemoteSession passed 120/120 (`remote-tests.log`). Automation checks passed 54/54
  (`automation-final-tests.log`); Worktrees Playwright passed 37/37
  (`playwright-worktrees.log`). Native automation serde/SQLite checks passed 20/20
  (`native-automation-tests.log`).
- New-session browser fixture captures: `temp/verification/d1/creation-light-1280.png`
  and `creation-dark-1280.png`, plus 800 variants. They establish fixture behavior;
  installed app, actual Host/provider and release inclusion remain unverified.

Full web passed 1,277 files/12,412 tests (four files/15 tests skipped), plus fast
tsc-rs. Final Tasks browser checks passed 186/186 in Chromium/WebKit, followed by
14/14 final helper/capture cases. Quick composer passed 50/50 focused checks and
8/8 browser cases, with light/dark 1280/800 captures under `temp/verification/d1/`.
The broad web run preceded the last quick/task follow-ups; focused follow-ups and
final web/Host fast type checks establish their source verification. Exact ledger:
`temp/verification/d1/CHECKS.md`.
HOT1 `c40bf96b` removes the contextual exception: handoffs and second opinions
accept authoritative Current policy, including plain folders. Nine protected
native turn/rewind fixture cases still need
explicit worktree choices; the diagnostic failures and exact fixture requests are
recorded in the managed-workspaces card and `remaining-managed-fixtures.log`.

## HOT1 retry preparation (2026-10-27)

Owner HOT1 stream brief: "A failed first send turns Automatic into explicit
Worktree"; requested "Retry follows the policy (Current by default)".
Implemented in `263ce591` on `hotfix/0.6.93`:

- `submitTurnSetup.ts` preserves the selected workspace mode and marks the saved
  user block with `workspacePreparationPending` while policy is unresolved.
- `sessionStore.ts` preserves the marker through JSON persistence;
  `sessionWorkspace.ts` recognizes unresolved preparation after saved user turns.
- `submitTurnRun.ts` clears markers only after authoritative preparation succeeds.
  Existing explicit choices and already-established sessions retain their intent.
- Regression in `submitModelSwitch.integration.test.ts` exercises transient failure,
  persistence reload, actual Retry text, one provider dispatch in Current and no
  managed workspace creation. Focused checks passed 86/86 across three files.

`scripts/build/acceptance-native.mjs --suite hot1` provides the seven owner
acceptance scenarios with real Codex and isolated profiles, plus light/dark
1280/800 captures. Native outcomes and exact logs belong in
`temp/verification/hot1/`; source checks alone do not establish those outcomes.

HOT1 native development evidence at product source `2c25cbed`, runner `6e66c921`:
Current completed three real Codex turns; a 34,483-byte Turkish message survived
Luna-to-Sol selection; a labelled history/capacity seed produced the reduced
handoff notice and a verified native history archive while real Codex replied.
An actual outage of only the isolated test Host saved the unresolved user block;
after Host restart, Retry completed in Current. Real Host contextual Current and
task/automation/Settings defaults also passed. Light/dark 1280/800 captures were
opened; `temp/verification/hot1/acceptance-final.json` aggregates the seven cases.

One initial switch attempt was explicitly marked stopped and timed out without a
reply; the cause was not established. The traced repeat passed without product
changes, and the failed attempt is retained. Explicit Worktree native first-turn
admission still failed; see the managed-workspaces card. These findings prevent
claiming full HOT1 native acceptance or release readiness.

## Selection actions and accent consumer audit, 2026-10-27

Owner's two menu crops and accent concern: register/brief
`temp/local/2026-10-27-selection-accent-audit/`,10 records/14 families. Appearance
promises accent for Send/bubbles, but normal Composer Send/steer branches use
neutral primary; Quick composer explicitly uses accent. Repair intended consumer
tones without recoloring every primary or changing send/queue/stop behavior.
Keep current custom colors, normalized picker/sibling state and transparent
composer highlight-layer selection. General DOM selection/menu hover use separate
roles, so their blue/gray appearance alone is not proof of a failed preference.

TranscriptSelectionMenu also needs pending-result ownership across direct A→B
selection changes, action-specific errors and reachable short-height content.
Preserve original-draft/range guard on translation apply, offline target detection,
quote preparation, Notes scope, IME/native range/focus/reduced-motion and shared
overlay/control owners. No real preference/AI/send/draft/Notes/clipboard action
or app fix is delivered here. Actual new computed theme/menu/native/installed
acceptance remains pending; earlier HOT1 evidence above is a separate scope.

135 related existing tests/13 suites pass with fixture native/remote/skill-policy
and act diagnostics retained. No actual accent/menu/reader acceptance inferred.

## Mounted Composer closure foundation, 2026-10-28

Delivered source increment in the shared dirty `main` checkout; no commit,
package, install or release is implied. `sessions/data/composerClosure.ts` and
`hooks/useMountedComposerClosure.ts` register the actual mounted Composer,
close explicit target admission, retain full immutable text/whitespace, tags,
attachments and draft mode, and await accepted attachment preparation plus
strict draft-row acknowledgement. `Composer.tsx` starts picker/clipboard/drop
factories only after admission, preserves accepted work across view retirement,
and blocks new target input/send while keeping Stop available. Unexpected late
changes invalidate the observation and keep their data. IME is never forced to
commit to obtain closure. Exact in-memory owner identity is required to reopen;
it is not a native authority grant.

Atomic `draftCache.setComposerDraftSnapshot` plus
`composerDraftStore.persistMountedComposerDraft` preserve legacy serialization,
including its whitespace-only/empty representation. The separately retained
mounted snapshot includes the original whitespace/tags/mode; the legacy row is
not claimed to store that whole representation. Cache-clear/version checks
prevent an old retired callback from resurrecting a cleared or newer draft.
An applied preparation whose native ACK fails retries persistence without
reopening the picker. Failed operations and differing retired snapshots remain
retained; bounds reject further capture instead of silently evicting them.
Renderer-local limits are 256 retained mounts, 16 preparation jobs per mount,
64 actual preparation/checkpoint operations, 16 closures and 64 MiB of charged
snapshot data. These are logical source-state limits, not a heap/RSS claim.
HMR retains state/jobs and invalidates old implementations' new admissions.

This API is internal and explicitly invoked only; there is no migration UI or
native challenge activation. Every result remains `qualified:false`.
QuickComposer's sessionless prompt/attachments are **not covered**. Parent
SessionPane selector/pending-session persistence, provider/output callbacks,
native challenge/checkpoint receipt and full-snapshot native retention are
also **not covered**. Native `write_attachment` now holds its Buffers admission
through actual file write/access-grant settlement and flushes file bytes, but
its temporary path is not a profile blob, parent-directory/power-loss durability
receipt or native drain proof. Do not promote any of these surfaces to Complete.

Initial renderer checkpoint: 18 suites/177 tests, including 22 new pure/mounted closure
cases; normal web `tsc-rs`, scoped general lint and new registry/hook lint pass.
Composer hooks lint still reports eight existing `set-state-in-effect` warnings.
The attempted normal Host typecheck hit concurrent native-buffer catalog/report
edits; its transient failure is recorded separately for Root's final check.
Tests use fixture Native IPC, not an installed app, real picker/provider or
multiwindow native acceptance. No new active visual flow was introduced.
Exact source hashes and logs:
`temp/verification/2026-10-28-renderer-persistence-drain/composer-closure.README.md`
and `composer-closure-source-identity.json`. Remaining composition sequence:
`temp/local/2026-10-27-host-architecture-plan/ws/COMPOSER-CLOSURE-NEXT.md`.

Independent review found two P2 defects in that initial snapshot; both were
reproduced red and fixed before the superseding source freeze. Previously open
slash/mention/MCP/folder/plus and translation completions now check admission
before changing the draft. Accepted asynchronous skill completion owns its
draft mutation/ACK lifetime; a later draft ACK failure does not repeat its
successful file creation.

`attachments.retainAttachmentPickerSelection` holds the original successful
native chooser paths separately from inspection. Composer retries inspection
or persistence from those exact paths without reopening the chooser. A genuine
later clear/send/reset rejects stale retry before more work, while another
failed attachment does not falsely change that retained selection's identity.
Each retained selection is bounded to 4,096 paths/1 MiB of charged path text;
over-capacity selection fails explicitly without truncation or chooser replay.
The ordinary no-argument `pickAttachments()` behavior remains independent.

Superseding renderer verification: **22 suites/216 tests** (13 pure closure,
17 mounted Composer and seven selection-stage new cases included), normal web
types and scoped general lint pass; hooks retain the same eight existing
Composer warnings. Exact ten-file manifest replaces the prior eight-file
snapshot, preserved as `composer-closure-source-identity.frozen8.json`. New logs
use `composer-closure-review-*`; prior 177 evidence is historical, not evidence
for the follow-up bytes. Root owns the final Host check. All coverage limits
and qualified:false status above remain unchanged.

## QuickComposer sessionless renderer closure, 2026-10-28

This supersedes only the earlier **renderer** QuickComposer gap; it does not
promote Quick/native migration qualification. `quick-composer/model/quickComposerClosure.ts`
retains raw prompt, attachments, selected project/model/settings/permissions and
workspace plus effective defaults under renderer window/intent UUID hints.
Those hints are not Native Window/reload identities or actor grants. The actual
QuickComposer uses the standard sessionless producer admission and a separate
full immutable capture; it never manufactures a session or writes a fake draft row.

Actual textarea/completion handlers gate new target effects. Options/default
changes participate in revision/invalidation even when basic prompt/files did
not change. Hide/dismiss preserves the draft. View unmount/HMR retains the window
state, accepted async work and owned captures; late results remain with their
original intent and replacement views receive them. Source admission occurs
before picker/paste/drop/clipboard/screenshot reads and spill. Successful stages
are retained for retry; mutable external capture outcomes are single-use `once`
stages, including unknown/rejected outcomes, so closure retry cannot capture
different clipboard contents or reopen/retake an uncertain selection. All spill
siblings settle before failure returns. Real queued clipboard capture has its
own work admission before its first read and retains its later spill/application.

Launch owns workspace resolution and Native submit through actual settlement.
Closure retry never replays an uncertain submit. Known successful handoff clears
covered data/rotates the renderer intent, preserving newer prompt edits. The
ordinary explicit Start retry and void remove/clear APIs remain available;
Native acceptance/idempotent reconciliation is still a dependency. A successful
later operation does not clear a failed prior intent's ledger. Native Git popup
open uses a live gate and an owned memoized Promise; its separate physical
window/cancel-completion proof remains missing.

The renderer capture is always `qualified:false`. Native physical challenge and
durable full raw snapshot/blob receipts are not installed; the generic typed
Native capture adapter is a contract only. At this writer's read, Native
quick_composer_capture still needed its own Buffers lease before spawn_blocking;
renderer IPC ownership does not supply it. Parent/provider-output and Native
qualification remain separate. No Complete/actor/default-floor/source retirement
or coordinator activation is introduced.

Final focused verification: **21 suites/168 tests**, including 30 new registry,
real mounted, Native-popup guard and sibling-settlement cases; normal web
tsc-rs, scoped general lint and new producer hooks lint pass. The popup retains
one existing set-state-in-effect warning. Exact 11 owned hashes and 21 test paths,
limits, historical logs and Native/installed acceptance exclusions:
`temp/verification/2026-10-28-quick-composer-closure/README.md` and
`source-identity.json`. No active migration UI or visual redesign was added.

Independent read-only Quick review closed with zero remaining concrete findings
on those final 11 hashes after fixing its HMR shown-listener owner dependency.
The real replacement case verifies fresh project/model defaults on the next show
while retaining the prompt. Capacity notices are also preserved after bounded
File admission. See `INDEPENDENT-REVIEW.md` beside the Quick evidence; review of
source/fixture logs does not establish installed or Native durability proof.

### Quick Native lifetimes and in-memory launch receipts (2026-10-28)

This delivery supersedes the preceding Quick Native source gaps only within this
scope. Actual macOS screenshot scheduling captures a Native Buffers admission
before work and moves its non-Clone owner into the blocking worker through
capture/file-byte sync, ownership registration, access grant and restore
scheduling. A detached IPC waiter or shortcut-off does not release accepted
work. File-byte sync is not a profile blob, directory/power-loss or checkpoint
receipt. Original owned screenshots survive session-copy promotion until explicit
renderer release, including lost ACK and newer unsent draft cases.

The separate Git popup now captures both actual physical Window resources and
both Buffers admissions. Its pending request retains those exact handles through
Native completion/dismissal; old destruction/blur callbacks cannot retarget a
replacement by label. Unexpected unfinished retirement stays unknown. This is a
Native popup lifetime foundation, not full popup child Git/provider closure or a
physical-window challenge/full raw capture receipt.

The additive local-only launch scope/submit-intent/status commands preserve the
legacy void submit API. First admission atomically publishes Pending and advances
the exact Native-issued sequence before effects. Duplicate tuples join one
delivery; terminal Failed never rearms, ambiguous outcomes never replay, and
compaction retains the sequence fence and reports old missing history as unknown.
Only actual existing workspace delivery ACKs or observed verified no-effect
failures can make records eligible for bounded compaction. Captured source Store
construction/physical resource identity is checked around scheduled effects;
new deliveries cannot be claimed/ACKed in another Store construction. UUIDs,
renderer window IDs and intent IDs remain matching hints, not actor authority.

QuickComposer uses these commands and retains an immutable original request
across HMR/unmount and uncertain responses. Explicit Start reconciles that tuple;
closure retry only observes. A fresh Native Failed status permits an explicit
corrected request with a new intent UUID/current next sequence. A failed read-only
scope discovery with no tuple or attempted send does not freeze stale text for a
later Start. Known handoff checks actual live mounted DOM/IME state before clearing
covered text/attachments, preserving newer unsent raw data after remount.

Automatic age/visibility-based Quick window destruction is disabled until a real
Native raw/empty receipt can authorize retirement. Hidden webviews consume memory
until explicit app shutdown. Sessionless full raw options/attachments still lack
durable Native capture; crash/app-exit recovery and durable launch reconciliation,
popup child/provider closure and challenge binding remain unimplemented here.
All captures/receipts stay `qualified:false`; no Complete, actor enrollment,
default floor, coordinator activation or source retirement is introduced.

Evidence: `temp/verification/2026-10-28-quick-native/README.md` and
`source-identity.json`. Windows verification exercised **18 actual portable Native
owner/ledger/filesystem tests** and **22 renderer suites/189 tests**, normal web
tsc-rs, scoped general/hooks lint and formatting. The macOS AppKit command branches
and OS screenshot/popup behavior were not compiled or exercised on this Windows
host; portable tests do not establish installed macOS or crash/durability
acceptance. Source manifest separates the seven Native and nine renderer owned
files from Root's separate lib registration/combined checks.
