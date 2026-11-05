---
name: feature-chat-composer
description: "Change or debug message composition, send, queue, steer, stop, drafts, attachments, quick composer and provider handoff inputs."
---

# Chat composer

Own input preparation and its UI state. Provider/account policy belongs to feature-providers; process and delivery authority to feature-host-runtime; current/worktree policy to feature-managed-workspaces. Dictation inserts unsent text through the composer boundary; voice owns recognition.

## Source entry points

Code paths below are repository-root relative.

- `src/features/sessions/ui/Composer.tsx`
- `src/app/workspace/sessions/submit/`
- `src/features/sessions/data/composerDraftStore.ts`
- `src/features/sessions/model/chatCitation.ts`, `src/features/sessions/ui/ComposerCitations.tsx`
- `src/features/sessions/ui/InterruptedNotice.tsx`: manual interrupted-turn recovery above the composer; keep Continue beside the explanation without changing continuation admission or blocked reasons.

## Workflow

1. Trace the changed action through normal, edited-send, queued and quick-composer producers. Search labels, shortcut commands, attachment producers and callers before choosing scope.
2. Follow the existing submit dispatcher, queue owner and session-owned draft store. For shortcut-only failures compare persisted keybinding, focus and suggestion-popover handling with the adjacent working action.
3. Change the initiating control and its pending/error/retry behavior together with the existing Host operation when needed. Use one accepted request identity across uncertain retries.
4. Exercise the affected send/queue/steer/stop paths, remount/account/model transitions, IME and attachment lifetime. Update the user guide when behavior changes.

## Preserve

- The shared text-selection action menu sizes to its contents and keeps actions on one row across composer, transcript, preview and terminal consumers. Its bounded action rail scrolls on narrow viewports without dismissing the selection; scrolling the surrounding page still dismisses it.

- Drafts survive hibernation/remount and provider/model/account changes; preserve caret, selection, IME and configured shortcuts.
- A saved draft card offers Edit only for local chats: it removes the draft block and returns its text/files through the composer recall path, so the composer reappears. Host-bound drafts keep Send/Remove, because removing a host session's only draft discards that session.
- Preserve queue order, edit/reorder/cancel, held messages and lease ownership. Unknown delivery is held, never automatically resent.
- Before publishing legacy local queues, use `queuedAttachmentStorage.ts` to save inline attachments natively. Validate paths, retain bytes on failure, reuse writes and preserve concurrent edits. Pending storage never bypasses shared claims.
- A follow-up refused before any provider write because its original turn ended returns to the queue as a typed wait, not a rejection. Release its claim without pausing an active queue; retain explicit Stop/paused/restored state and let the existing dispatcher continue when free.
- Keep provider, model, reasoning, account and workspace choices independent, including custom IDs and first-send preparation errors.
- Handoff budgets may trim earlier history/recap and retain an archive reference; preserve the current request and do not reject send solely because optional handoff context does not fit.
- Retain attachment owning-Host identity, saved/recovered context, permission gates and resource cleanup. Failed/cancelled handoffs must settle visible preparation state without bypassing original-source cleanup.
- Image cards load persisted thumbnails near the viewport through the owning-Host reader or eligible local path. Loading a thumbnail must not open the lightbox. Retain loaded thumbnails when the lightbox closes; release owned URLs on source changes/unmount. Inline text tokens remain click-loaded; preserve preview budgets, missing states and retry.
- Pasted/dropped blob images must obtain a saved path before entering the composer or transcript. Vision bytes remain transient provider input; failed or empty-path writes reject attachment admission and release the preview URL. Metadata-only historical records cannot recreate discarded image bytes.
- Ordinary custom question answers accept files through the shared picker, paste and drop paths. Retain per-question attachment metadata with the question draft, persist blob bytes before dispatch and resolve remote uploads on the owning Host. Typed elicitation values retain their exact schema and whitespace; never append file references to those fields.
- Stop/cancel remains usable during preparation. Question drafts retain exact input and separate semantic lineages; bounded admission must not evict pending/unknown data.
- Citation snapshots/comments persist with the owning text draft but stay outside the editable textarea. Preserve them through remount, queue/send rejection and retained-input snapshots; removing a reference must not remove typed text. Provider preparation expands only the user's input, then appends literal citation data so quoted mentions cannot trigger file or skill expansion.
- Citation previews: six words/80 graphemes; data intact.

## Verification and references

- Choose focused Composer keys/IME/draftOwnership/queueHeld, composerDraftStore and QuickComposer command suites from the surface map; add submit/queue/attachment tests only for the changed behavior.
- Use the project UI matrix for changed surfaces. Send/lease/stop changes also need isolated Host/native execution; a layout fixture cannot establish real-provider delivery.
- [Surface map](references/surfaces.md) and [decision provenance](references/decisions.md) for affected owners; re-search callers before broad changes.
- [Handoff and attachment behavior](../../../docs/guides/chat-artifacts-and-connected-files.md)
- [Workspace authority](../../../docs/reference/managed-workspaces.md)
