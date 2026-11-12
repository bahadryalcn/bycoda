---
name: feature-markdown-preview
description: "Use when changing Markdown Preview/Source modes and scrolling. Not for Notes editing; see feature-notes."
---

# Markdown preview and scroll changes

Use for file Markdown presentation and shared scroll/overview behavior. Notes owns its editable document and pane lifecycle; Git owns diff review controls. Editor retention/durability is a separate runtime contract.

## Source starts

- `src/features/sessions/ui/MarkdownDocumentPreview.tsx`, `MarkdownModeToggle.tsx`: document presentation and mode visibility.
- `src/features/files/ui/FileEditor.tsx`, `CodeMirrorEditor.tsx` and adjacent Markdown panes: mounted editor and save lifecycle.
- `src/features/source-control/ui/DiffOverviewRuler.tsx`, `src/styles/`: ruler and shared scroll roles.
- `src/features/notes/ui/`, `src/features/skills/ui/`: distinct editing/preview consumers.

## Preserve

- One document scroll owner per visible pane. Preserve necessary code/table overflow and genuine independent Split-pane scrolling.
- Inactive mounted source retains draft, undo, selection and scroll, but must not paint a competing ruler or receive pointer/keyboard input.
- Markdown source is canonical; mode switching cannot normalize or discard unsupported syntax. Formatting/save target the actual active editor.
- Do not confuse Notes own pane, plain session textareas, file preview and Git diff rulers; follow the real consumer before sharing a fix.
- Retain native selection, editor transparent glyphs, workspace-aware links/images, find focus return and draft recovery ownership.
- Markdown shell preview zoom scales inner document content, not its scroll owner or toolbar. Keep Ctrl+wheel non-passive and cancel page zoom at limits; source editors retain their separate code zoom. HTML/SVG consumers opt out of document zoom.
- Preview/Source icon choices retain translated names, tooltips, exclusive selection and keyboard navigation through the shared SegmentedControl.

## Workflow

1. Identify the actual visible pane, its scrolling element and all hidden editor/ruler descendants.
2. Trace shared CSS and caller-specific visibility/overflow; fix the owning layer without removing valid secondary scroll regions.
3. Exercise Preview/Source/Split return, keyboard/find/selection/undo and representative Notes/Skills/Git consumers.

## Focused checks

Run `pnpm exec vitest run src/features/sessions/ui/MarkdownModeToggle.test.ts src/features/sessions/ui/MarkdownDocumentPreview.test.ts` and the changed file-editor/Notes/Skills consumers.
Inspect long Markdown, code/tables, changed-source rulers, hidden-pane hit targets, native scrollbar/zoom and focus after Find.

## References

- [File presentation](../../../docs/guides/explorer-and-file-content.md) and [draft recovery](../../../docs/guides/editor-draft-recovery.md) for user-visible behavior.
- [Notes](../feature-notes/SKILL.md) for editable document scope; [Source control](../feature-source-control/SKILL.md) for diff toolbar and preferences.
