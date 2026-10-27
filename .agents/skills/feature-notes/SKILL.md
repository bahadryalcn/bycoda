---
name: feature-notes
description: Notes library and editing inventory for project grouping, full-body search, paging, selection, Markdown document/source/split, formatting, save/conflict/recovery, images, session notes, chat context and mobile entrypoints. Read before Notes redesign or workflow changes.
---

# Notes

## Purpose and scope

Find, read, write and reuse notes with clear ownership and reliable recovery.
Keywords: library, project groups, tags, Markdown, editable preview, Source,
Split, autosave, Save, images, session dock, Add to chat.

Baseline: dirty shared `main @ 0a42b1ab4fd891ccec5ca0fa238d7356b396b13c`,
2026-10-27. Recent feature history: `29d534f9`, `cf3944cf`, `3419af02`.
Search roots: `src/features/notes`, explicit sessions/app consumers,
`src-tauri/src/notes.rs`, Host Notes/dispatcher/tool files, browser Notes fixtures
and native mobile Notes routes. Two native reviews inspected all three owner
screenshots. This card is guidance, not a live reservation.

## Surface inventory

| Surface                       | Owners                                                                                                                                                                                                               | Current coverage                                                     |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Library/groups/counts         | `src/features/notes/ui/NotesView.tsx`; `src/features/notes/noteLibrary.ts`                                                                                                                                           | Screenshot/source audit; repair pending.                             |
| Search/filter/sort/paging     | `src/features/notes/notes.ts`, `noteLibrary.ts`, `noteLibraryWindow.ts`                                                                                                                                              | Source audit; deep-match/date/page acceptance pending.               |
| Bulk selection/delete         | `NotesView.tsx`, shared Checkbox/Modal                                                                                                                                                                               | Source audit; keyboard/partial failure/recovery pending.             |
| Title/project/tags/actions    | `NotesView.tsx`, `src/features/notes/ui/notes.css`                                                                                                                                                                   | Screenshot/source audit; new composition pending.                    |
| Document/Source/Split         | `src/features/notes/ui/NoteEditablePreview.tsx`, `NoteMarkdownEditor.tsx`, `NoteEditorPane.tsx`; `src/features/notes/previewBlocks.ts`                                                                               | Screenshot/source audit; default confirmed, implementation pending.  |
| Formatting/find/scroll/resize | Same editor owners; `src/features/notes/markdownCommands.ts`                                                                                                                                                         | Menu screenshot/source audit; active-editor risk needs reproduction. |
| Save/conflict/recovery        | `src/features/notes/noteDrafts.ts`, `useNoteDetail.ts`; `src/features/notes/ui/NoteDraftRecoveryNotice.tsx`; `src/main.tsx`                                                                                          | Source audit/inventory; failed drafts are app-session scoped.        |
| Images/rendering              | `src/features/notes/noteImages.ts`; `src/features/sessions/ui/AgentMarkdown.tsx`                                                                                                                                     | Contracts inventoried; rich-edit round trip pending.                 |
| Session dock/handoff          | `src/features/notes/ui/SessionNotesPanel.tsx`; `src/features/notes/notesPanel.ts`, `noteNavigation.ts`; `src/features/sessions/ui/SessionPane.tsx`                                                                   | Source inventory; shared-consumer migration pending.                 |
| Cards/chat context            | `src/features/notes/ui/NoteMiniCard.tsx`; `src/features/notes/noteContext.ts`; sessions `Composer.tsx`, `AgentTranscript.tsx`                                                                                        | Source inventory; exact context/read-only distinction preserved.     |
| Native/Host                   | `src-tauri/src/notes.rs`; `host/host-notes.ts`, `host/host-notes-async.ts`, `host/host-notes-worker.mjs`, `host/server.ts`, `host/conversation-tools.ts`, `host/conversation-workspace-tools.ts`, `host/mcp-http.ts` | Entrypoints inventoried; no backend migration/live operation.        |
| Native mobile                 | `mobile/src/features/management/notes-screen.tsx`, `notes/note-editor.tsx`, `notes/note-directory.ts`, `notes/note-summary-row.tsx`; `mobile/src/features/workspace/session-notes.tsx`, `session-notes-model.ts`     | Routes/source inventory only; separate native design/acceptance.     |

App wiring: `src/app/workspace/layout/WorkspaceToolPanels.tsx` hosts NotesView;
`src/app/App.tsx` owns tool navigation. Native commands: `notes_list`,
`notes_list_summaries`, `notes_search`, `notes_get`, `notes_upsert`,
`notes_link_session`, `notes_delete`, `notes_save_image`, `notes_image_path`,
`notes_discard_recovery_assets`. Host/mobile RPCs: `notes.list`, `notes.get`,
`notes.upsert`, `notes.delete`. Preserve existing scope/routing; native and remote
methods are not interchangeable.

Locale families: existing Notes, Note title, Edit preview, Source, Split, Save,
Unsaved changes, More below, Show more, Add to chat and validation/error strings
under `src/shared/i18n/` and mobile catalogs. Reuse shared Button, TextField,
TagInput, Popover, Modal, Checkbox and selection/overlay contracts.

## Owner decisions

2026-10-27, current T3 conversation `0567326f-aade-4baa-89f3-b44c6256ae9e`:

- Scope: "daha iyi daha güzel bir notes ekranıda olabilirdi bunlarıda düzenliyebiliriz buralarıda tekrar düşünelim ydaha iyi tasarlıyalım"
- Default: "Tek düzenlenebilir belge varsayılan olsun (önerim)".

The newer default supersedes earlier default Split for the fallback only. Keep
Source/Split, retained selections, project grouping and explicit Save. Current
mode retention is window-memory, not durable preferences.

## Behavior to preserve

Markdown remains canonical: exact source, unsupported syntax, fences/tables,
reference definitions, selection and undo. Current editable Preview replaces a
source range with raw Markdown; it is not a rich-text engine. Hidden source
currently preserves undo. Formatting must target the actual visible editor.
Direct rendered checklist toggling is a new capability, not existing behavior.

Keep note ID/slug, full-body search, filtered edited-note access, bounded lists,
grouping, honest counts/dates, keyboard navigation, cross-page selection,
resize/scroll and narrow fallback. Do not delete blanks, delay persistence or
create folders/pins without a separate selected change.

Keep explicit Save plus autosave queues, `expectedUpdatedAt`, in-flight edits,
failure retention, conflict/new-copy recovery and image ownership. Do not claim
restart-proof recovery from the current app-session draft map. Keep sanitization,
workspace-aware links/images, delete confirmation and queued-save cancellation.
Session-library navigation is not implicit relinking or project reassignment.
Add to chat prepares exact context; it does not itself send. Preserve local/Host
ownership and native conflict bases instead of replacing drafts during polling.

## Checks and visual scenarios

Existing focused tests under Notes: `NotesView.test.ts`,
`NoteEditablePreview.test.ts`, `SessionNotesPanel.test.ts`, `previewBlocks.test.ts`,
`markdownCommands.test.ts`, `noteLibrary.test.ts`, `noteLibraryWindow.test.ts`,
`noteImages.test.ts`, `noteContext.test.ts`, `notes.test.ts`. Use Host Notes tests
when contracts change and tsc-rs for TypeScript checks. Browser entrypoints:
`tests/browser/notes.tsx`, `notes.html`, `notes.spec.ts`,
`playwright.notes.config.ts`, `vite.notes.config.ts`, `serve-notes.mjs`.

Capture actual changed surfaces in light/dark at 1280/800 and narrow session
panes. Cover empty/long/complex Markdown, IME/selection/undo, mode return, all
formatting commands, deep search, thousands of notes, timestamps/group duplicates,
paging/selection, slow/failed/conflicted saves, navigation/deletion during save
and note-owned image recovery. Reproduce active preview block → Split to Edit
preview → Bold without refocusing before closing the source-backed targeting
risk. Fixture proof is not installed/Host/native mobile acceptance.

## Proposals, blockers and handoff

Direction: title-first library, one document, compact context/toolbar, honest
save/page/date language. Default confirmed; finer composition is an agent
proposal. A richer engine requires a lossless Markdown spike. The illustrative
HTML concept is not production serialization code.

Local register: `temp/local/2026-10-27-notes-redesign/AUDIT.md` (18 records:
13 visual/source, five source-only, 12 coverage families). Brief:
`temp/local/2026-10-27-notes-redesign/REDESIGN.md`; evidence:
`temp/verification/2026-10-27-notes-redesign/`.

Delivery: audit/design/card/prototype only, uncommitted at the baseline above.
No product source or note data changed. Capture/source inclusion UNKNOWN;
build/install/live Host/native mobile acceptance not claimed. Live feature-claim
API is unavailable; shared Git/session state was inspected without claiming a
cross-machine reservation. Preserve concurrent sidebar, ButtonGroup/footer,
updater and Host work. Update user guides when actual behavior changes.

## Workspace preference dependency, 2026-10-27

Workspace Settings layout audit:
`.agents/skills/feature-workspace-settings/SKILL.md` and
`temp/local/2026-10-27-settings-workspace-audit/`. Notes is not identical to four
navigation-only tool preferences: disabling closes Notes UI and removes composer
note-reference/save-note entrypoints. Generic help has a Notes exception but not
beside its row. No note deletion or draft loss established. Keep actual scope
and data/draft preservation when regrouping. Align its missing sibling-window
storage subscription while retaining same-window events and existing Notes
open/navigation gates. These dependencies do not recount the18 prior Notes
findings or implement changes.35 related Settings/editor tests pass; no new Notes
UI, preference, source/data/Host/build/install/release change delivered.

## Markdown scrollbar dependency, 2026-10-27

Register/brief `temp/local/2026-10-27-markdown-scroll-audit/`, card
feature-markdown-preview. Notes uses its own NoteEditorPane scroll owner and
growing source editor, not MarkdownViewShell/MarkdownDocumentPreview. Hidden
Notes Source already uses display-none while staying mounted; session dock is
a textarea. Do not remove valid Split-pane/code/table scrolling or canonical
draft/undo/selection to fix the file-preview ghost diff ruler. Include Notes as
a representative consumer when shared scrollbar theme/overscroll roles change.
111 related existing tests/15 suites pass; audit only, actual changed Notes
rendering/keyboard/native acceptance pending. This does not add to or close the
prior Notes repair records.

## Host/WS source integration (2026-10-27)

Four paired Notes RPCs now share host/domains/notes/service.ts and neutral notes.ts DTOs across HTTP/WS. Existing session/project/note scope, global paired get, outer CAS token, finalizeSlug and worker commit grant remain authoritative. TempSQLite worker and loopback composition passed; no note data/UI/installed acceptance changed.

Source only, uncommitted; no build/install/release stamp. Current full checklist and overlapping evidence: feature-host-runtime/SKILL.md and the local IMPLEMENTATION ledger.
