---
name: feature-notes
description: "Use when changing Notes library, editing, saves and images. Not for shared Markdown rendering; see feature-markdown-preview."
---

# Notes changes

Use for Notes library and session-note surfaces. Markdown rendering is shared selectively; session and library draft stores must be traced independently. Native admission and Host transport changes also require their runtime owner.

## Source starts

- `src/features/notes/ui/NotesView.tsx`, `src/features/notes/ui/NoteEditablePreview.tsx`, `src/features/notes/ui/SessionNotesPanel.tsx`: library, editor and session dock.
- `src/features/notes/`: library paging/search, Markdown commands, save queues, images and context.
- `src/app/workspace/layout/WorkspaceToolPanels.tsx`: workspace mounting/navigation.
- `src-tauri/src/notes.rs`, `host/domains/notes/`, `mobile/`: follow actual storage/RPC/mobile consumers when changing shared operations.

## Preserve

- Keep exact Markdown, unsupported syntax, selections and undo. Editable document is the fallback; retained Source/Split choices and explicit Save (Ctrl/Cmd+S) remain available; the library editor shows no Save button or routine save status, only errors. Deletion lives in the library menu, not the editor's Details popover.
- Library grouping/search/paging and selected-note identity must survive filtering and asynchronous results; displayed counts describe their real scope.
- Keep serialized autosave/explicit-save queues, CAS/expectedUpdatedAt bases, in-flight edits and conflict/new-copy recovery. Clear only submitted fields still unchanged after completion.
- Images remain note-owned with partial-success and ambiguous-result recovery. Do not replay an uncertain image write or treat a published Markdown path as durability proof.
- Add to chat prepares exact context without sending or implicit relinking. Navigation, polling and deletion must not overwrite independent drafts.
- A saved row, session-local draft map or Native acknowledgement alone does not prove complete actor coverage, crash recovery or cross-device migration.

## Workflow

1. Identify library/session scope, actual visible editor and save/image operation owners before changing layout or callbacks.
2. Trace toolbar, block actions, Source/Split and session-dock callers; preserve separate queues, native permission gates and conflict bases.
3. Exercise editing during saves, navigation/deletion, conflicts/new-copy and partial image failure; update the user guide only for actual behavior changes.

## Focused checks

Run `pnpm exec vitest run src/features/notes/ui/NotesView.test.ts src/features/notes/ui/NoteEditablePreview.test.ts src/features/notes/ui/SessionNotesPanel.test.ts` plus affected library/Markdown/save/image/context tests.
For storage contracts, include actual Host/Native consumers. Inspect complex Markdown, toolbar targeting after mode changes, IME/undo, deep search, large paged libraries and failed/conflicted saves. Distinguish fixture from native/installed acceptance.

## References

- [Markdown](../feature-markdown-preview/SKILL.md) for shared visibility/scroll changes; [Host runtime](../feature-host-runtime/SKILL.md) for admission/transport work.
- [Editor recovery](../../../docs/guides/editor-draft-recovery.md) when changing retained file-copy behavior.
- [Document default decision](references/decisions.md) before changing the fallback editor mode.
