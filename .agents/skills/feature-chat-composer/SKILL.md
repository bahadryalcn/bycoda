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

## Workflow

1. Trace the changed action through normal, edited-send, queued and quick-composer producers. Search labels, shortcut commands, attachment producers and callers before choosing scope.
2. Follow the existing submit dispatcher, queue owner and session-owned draft store. For shortcut-only failures compare persisted keybinding, focus and suggestion-popover handling with the adjacent working action.
3. Change the initiating control and its pending/error/retry behavior together with the existing Host operation when needed. Use one accepted request identity across uncertain retries.
4. Exercise the affected send/queue/steer/stop paths, remount/account/model transitions, IME and attachment lifetime. Update the user guide when behavior changes.

## Preserve

- Drafts survive hibernation/remount and provider/model/account changes; preserve caret, selection, IME and configured shortcuts.
- Preserve queue order, edit/reorder/cancel, held messages and lease ownership. Unknown delivery is held, never automatically resent.
- Keep provider, model, reasoning, account and workspace choices independent, including custom IDs and first-send preparation errors.
- Handoff budgets may trim earlier history/recap and retain an archive reference; preserve the current request and do not reject send solely because optional handoff context does not fit.
- Retain attachment owning-Host identity, saved/recovered context, permission gates and resource cleanup. Failed/cancelled handoffs must settle visible preparation state without bypassing original-source cleanup.
- Stop/cancel remains usable during preparation. Question drafts retain exact input and separate semantic lineages; bounded admission must not evict pending/unknown data.

## Verification and references

- Choose focused Composer keys/IME/draftOwnership/queueHeld, composerDraftStore and QuickComposer command suites from the surface map; add submit/queue/attachment tests only for the changed behavior.
- Use the project UI matrix for changed surfaces. Send/lease/stop changes also need isolated Host/native execution; a layout fixture cannot establish real-provider delivery.
- Read the [surface map](references/surfaces.md) for the affected UI, state, transport and test owners. Re-search current callers before broad changes.
- [Handoff and attachment behavior](../../../docs/guides/chat-artifacts-and-connected-files.md)
- [Workspace authority](../../../docs/reference/managed-workspaces.md)
