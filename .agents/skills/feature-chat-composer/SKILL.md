---
name: feature-chat-composer
description: Chat composer inventory for send, queue, steer, stop, drafts, attachments, model/provider/workspace selection, quick composer and translation.
---

# Chat composer

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
