---
name: feature-chat-composer
description: Use when changing message drafts, send, queue, steer and attachments. Not for chat preferences; see feature-chat-settings.
---

# Chat composer

Own input preparation and its UI state. Provider/account policy belongs to feature-providers; process and delivery authority to feature-host-runtime; current/worktree policy to feature-managed-workspaces. Dictation inserts unsent text through the composer boundary; voice owns recognition.

## Source starts

- `src/features/sessions/ui/Composer.tsx`
- `src/app/workspace/sessions/submit/`
- `src/features/sessions/data/composerDraftStore.ts`
- `src/features/sessions/model/chatCitation.ts`, `src/features/sessions/ui/ComposerCitations.tsx`
- `src/features/sessions/ui/InterruptedNotice.tsx`: manual interrupted-turn recovery above the composer; keep Continue beside the explanation without changing continuation admission or blocked reasons.

## Workflow

1. Trace the changed action through normal, edited-send, queued and quick-composer producers. Search labels, shortcut commands, attachment producers and callers before choosing scope.
2. Follow the existing submit dispatcher, queue owner and session-owned draft store. For shortcut-only failures compare persisted keybinding, focus and suggestion-popover handling with the adjacent working action.
3. Change the initiating control and its pending/error/retry behavior together with the existing Host operation when needed. Use one accepted request identity across uncertain retries.
4. Exercise the affected send/queue/steer/stop paths, remount/account/model transitions, IME and attachment lifetime.

## Preserve

- The shared text-selection action menu sizes to its contents and keeps actions on one row across composer, transcript, preview and terminal consumers. Its bounded action rail scrolls on narrow viewports without dismissing the selection; scrolling the surrounding page still dismisses it.

- Drafts survive hibernation/remount and provider/model/account changes; preserve caret, selection, IME and configured shortcuts.
- A saved draft card offers Edit only for local chats: it removes the draft block and returns its text/files through the composer recall path, so the composer reappears. Host-bound drafts keep Send/Remove, because removing a host session's only draft discards that session.
- Preserve queue order, edit/reorder/cancel, held messages and lease ownership. Unknown delivery is held, never automatically resent.
- Before publishing legacy local queues, use `queuedAttachmentStorage.ts` to save inline attachments natively. Validate paths, retain bytes on failure, reuse writes and preserve concurrent edits. Pending storage never bypasses shared claims.
- Queue write-through (`queuePersistenceSync.ts`) retries a failed write on a bounded backoff and shows one persistent notice after repeated failures. Only the newest queue is written; an edit, send or removal cancels the old retry so a stale queue never brings back a delivered message.
- A follow-up refused before any provider write because its original turn ended returns to the queue as a typed wait, not a rejection. Release its claim without pausing an active queue; retain explicit Stop/paused/restored state and let the existing dispatcher continue when free.
- Keep provider, model, reasoning, account and workspace choices independent, including custom IDs and first-send preparation errors.
- Handoff budgets may trim earlier history/recap and retain an archive reference; preserve the current request and do not reject send solely because optional handoff context does not fit.
- Retain attachment owning-Host identity, saved/recovered context, permission gates and resource cleanup. Failed/cancelled handoffs must settle visible preparation state without bypassing original-source cleanup.
- Image thumbnails, pasted/dropped blobs (saved path before admission, skipped-by-name notice via `attachmentsFromFiles({ onSkipped })`), the aggregate embed budget (`MAX_TOTAL_EMBED_BYTES`) and question-answer files follow [attachment contracts](references/attachments.md); never silently drop, reject or reorder a draft for them.
- Stop/cancel remains usable during preparation. Question drafts retain exact input and separate semantic lineages; bounded admission must not evict pending/unknown data.
- Citation snapshots persist with the draft outside the textarea, which holds only `[quoteN]` tokens (`citationTokens.ts`). Preserve them through remount, send rejection and retained input; removing one drops only its token and renumbers. Providers get the expanded input plus literal snapshots tagged with `ref`, so quotes never trigger file or skill expansion.
- Citation previews: six words/80 graphemes; data intact.
- A draft whose longest line reaches 16,000 characters leaves the inline CodeMirror editor for the native field (`composerInlineLongLine.ts`); CodeMirror re-measures one giant wrapped line without converging. Undo/redo history moves with it (`composerInlineHistory.ts`) and returns when every line is under 8,000; a composition in the editor finishes first.

## Focused checks

- Choose focused Composer keys/IME/draftOwnership/queueHeld, composerDraftStore and QuickComposer command suites from the surface map; add submit/queue/attachment tests only for the changed behavior.
- Use the project UI matrix for changed surfaces. Send/lease/stop changes also need isolated Host/native execution; a layout fixture cannot establish real-provider delivery.

## References

- [Surface map](references/surfaces.md) and [decision provenance](references/decisions.md) for affected owners; re-search callers before broad changes.
- [Handoff and attachment behavior](../../../docs/guides/chat-artifacts-and-connected-files.md)
- [Workspace authority](../../../docs/reference/managed-workspaces.md)
