---
name: feature-notes
description: Notes library and editing inventory for project grouping, full-body search, paging, selection, Markdown document/source/split, formatting, save/conflict/recovery, images, session notes, chat context and mobile entrypoints. Read before Notes redesign or workflow changes.
---

# Notes

## Native image byte acknowledgement, 2026-10-30

The original admitted Native image job now validates the opened source file and
bounds the actual copy stream to20MiB plus one rejection sentinel. Each copy
creates a fresh UUID-named file with create_new (0600 on Unix), so concurrent
same-name saves cannot truncate an already returned asset. Real file sync
precedes the original produced-file grant and public Markdown path. Display
names, the note-assets/note-id path shape and legacy stored paths remain.

A copy, sync or grant failure preserves the original error and uncertain private
file rather than granting it, acknowledging success, retrying or deleting a
possible replacement by pathname. Existing actual Native admission covers this
whole worker even if its public waiter is dropped. File-byte sync alone does
not prove directory-entry/power-loss durability, Notes-row/image graph atomicity,
cross-device migration or a complete Native Buffers cut.

Current source/test scope is in
`temp/verification/2026-10-30-native-buffer-continuation/notes-assets/`.
Five new owned-file/barrier tests cover flush ordering, failure, source size and
growth, and concurrent immutable copies. Check execution remains pending until
Root records results; rustfmt parsing is not compilation or installed proof.
The external V2 owner retains Notes UI edits. This source continuation changes
no UI surface or renderer authority.

## Input-conservation continuation, 2026-10-29

Uncommitted shared main at761196a6, source0.6.94. Known renderer inputs now join
their distinct Notes closure family; this does not reserve the feature. The external
React refactor held Notes and shared InlineEdit/TagInput writes during this freeze.
Later VIS23 menu edits in `NotesView.tsx` and `noteLibraryMenu.ts` were preserved
after the original Notes writer reviewed input ownership, recovery, image memo
and deletion admission. New menu acceptance remains with that UI owner.

| Surface                                | Current implementation                                                                                                                                                  |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Library, session dock, retained drafts | `notesInputOwners.ts`, `useNoteInput.ts`, `noteDrafts.ts`: distinct logical owners and exact private text, tags, loaded baselines and pending work                      |
| Source, Preview, title and tags        | `ui/NoteMarkdownEditor.tsx`, `NoteEditablePreview.tsx`, `NotesView.tsx`, `SessionNotesPanel.tsx`: actual mounted input/IME state and private control observation        |
| Save/result/render                     | `useNoteDetail.ts`, `notes.ts`: actual original work, exact Native DTO provenance and explicitly derived summary/detail publications; unrelated refresh/ABA invalidates |
| Recovery and unmount                   | `ui/NoteDraftRecoveryNotice.tsx`, `noteDrafts.ts`: retained drafts wait for accepted picker/save work; retired views never write into replacements                      |
| Images and Markdown asset reads        | `noteImages.ts`, `ui/useNoteImageInsertion.ts`, sessions `AgentMarkdown.tsx`: original picker/Native continuation and centralized admitted path resolution              |
| Bulk deletion                          | `ui/NotesView.tsx`: one accepted batch per actual owner, frozen selected identities and individual authoritative outcomes; failed rows stay selected                    |
| Service-only Native requests           | `noteServiceIntents.ts`: bounded original six-command request data, true Promise/bookkeeping lifetime, unresolved errors and post-success application outcomes          |

The actual Native effect gate remains mandatory. Private work/publication proofs
are never raw data or transferable authority. Session-scoped retention is distinct
from Notes-row/image durability and cross-device migration. New typing remains
usable during passive capture; closure can temporarily make owned inputs readonly.
Preparation never sends, saves, normalizes or commits composition on the user's behalf.

Private retirement preserves exact raw/whitespace, IME, pending originals and
same-key older generations. Clean acknowledged input can prune normally.
The64-record/64MiB conservative data budget refuses new effects without evicting
unknown input. HMR retains originals and holds capture after implementation changes.
Recovery Copy/Open are explicit; they do not save, apply or replay retained input.
Image work preserves partial successes even when a later FileReader/conversion
fails. Original saved-asset lookup completes before Markdown publication, and
ambiguous outcomes retain exact asset/request diagnostics without replay.

The current explicit Notes manifest has18 paths (17 original plus the external
menu dependency): `notes/vis-current-dependencies/source-cohort.json` under
`temp/verification/2026-10-29-notes-input-closure/`. Historical248/18 author and
independent89/4 checks refer to their original sources. Current browser acceptance
passed40/40 cases with40 captures in both themes at1280/800. All40 exact raw
artifacts passed checked Native FULL, retained read and new-Store historical read;
this does not prove process-exit, installed GUI or physical durability.
Normal desktop/Host/mobile types and Native Clippy passed. Complete actor/alias
coverage, same-store Host Node writer admission, physical/native/installed/mobile
acceptance, coherent restore and both Native durability lanes remain open.

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

## H7 Notes implementation, 2026-10-28

This supersedes audit-only delivery for N-L01–08/N-E01–10 without claiming
runtime acceptance. Owner instruction in current session
`28955f17-306b-4eee-b0e0-99d148ba36c3`, exact quote:
"Notlar yeniden tasarımını uygula. Audit'i tekrarlama."
Package `2026-10-28-notes-impl`; shared dirty main baseline
`4de508deabfdae8fd9a8c4c35ab7c4032b5924e9`, uncommitted. No delivery commit,
build/install/release or installed-source inclusion is claimed.

- Library: title-first rows, project context outside project grouping, honest
  No preview and sort-corresponding Created/Updated date. One unique-note count,
  named New note/selection, shared search, explicit Previous/Next and actual
  grouped-row range. Full-body native search and stale guards remain. Deep
  matches are named, not fabricated excerpts. Explicit Find reveals source
  search and consumes its request; narrow Find preserves desktop Split.
- Editor: Document is the new fallback; existing window-retained Source/Split
  remain. Title leads; project and actual TagInput values share compact context.
  Save/status stay direct; Add to chat is subordinate; Delete/slug/exact dates
  use a named shared Popover. Delete confirmation, queued-save cancellation and
  pending visibility remain explicit. Changed/saving/saved/failed/title-invalid
  and recovery-copy states stay distinct.
- Existing exact Markdown source-range editing is flattened into a continuous
  page, not replaced by a rich-text/WYSIWYG engine. Read document ends editing
  without saving. Shared ActionHost/InlineAction owns block actions; grouped
  Text/Block/Insert retains every command. Both panes remain mounted hidden;
  toolbar/image insertion target the visible active editor. Independent note/
  pane scroll uses existing useRetainedScroll; Split retains its divider.
- Save/conflict: CAS base/saved tokens, expectedUpdatedAt, serialized queue,
  captured-field clearing and image ownership remain. Save as new note clears
  only submitted fields/project still unchanged after the request; newer edits
  survive. Global recovery retry stays visible/pending and guards duplicates.
  Recovery remains app-session scoped, not restart-proof.

H6 owns chat-only NoteMiniCard and SessionNotesPanel consumers; they were left
unchanged. No Host/native/mobile/remote/global-theme/shared-hook change or real
note operation was performed. Only missing English/Turkish keys were appended.

Every record: **test edilmedi**. RULES.md forbids suites, fixture/dev servers
and screenshots. One compiler stage ran: `pnpm exec tsc-rs --noEmit --fast`.
The check:web:fast alias includes Vitest and was not used. Three Find iterator
diagnostics were corrected afterward to read next()'s result. No rerun or clean
final compiler pass is claimed. New helper/range tests are unexecuted.

Morning acceptance: notes browser suite, focused NotesView/preview/library/
window/save/image/context checks, light/dark 1280/800/narrow, complex/empty/long
Markdown, keyboard/touch/IME/undo/caret, all commands/deep search, thousands of
notes/tag duplicate pages, mode/scroll return, slow/failed/conflicted saves,
copy recovery during editing and explicit chat attachment. Full 18-ID ledger,
fingerprints and H6 dependencies: `temp/local/2026-10-28-notes-impl/handoff.json`.
Live claims API unavailable; sessions and initially clean Notes sources inspected.
Native subagents used with exclusive file ownership; no other session awaited.

### Native admission continuation, 2026-10-29

This separate runtime slice changes `src-tauri/src/notes.rs`, not the prior
Notes visual composition. Actual injected-Window admission precedes Notes upsert,
link, delete, abandoned-recovery cleanup, image copy and image access grant.
The four SQL-only read commands retain their existing behavior. SQL guards drop
before completion. Image copy and post-copy grant remain owned by the actual
worker after a dropped waiter. A committed delete still returns success when
best-effort asset cleanup fails, while the failed observation cannot certify idle.
Original CAS conflicts, normalization, recovery ownership and permission checks
are preserved; sourceSessionId is data, not admission authority.

The new11 actual SQL/file/barrier regressions and24 existing Notes tests passed
within Root's final973-test scoped Native run;30 platform fixtures were ignored.
Normal desktop/Host tsc-rs, scoped Clippy with warnings denied, rustfmt and the
independent final source review passed. See exact scope/source identity in
`temp/verification/2026-10-29-buffer-actors-root/ROOT-REPORT.md`. These checks do
not renew the older Notes UI screenshots/browser/physical-device acceptance.

Notes UI closure is still incomplete: library and session-dock draft stores are
separate; detached queues, Source/preview, InlineEdit title and TagInput private
drafts require their actual input/operation ports. Host Notes can separately
write the same physical database and has no Native-window admission handoff.
Neither these Native tests nor a saved row proves complete Notes/Native Buffers
coverage, restart-safe dirty-draft recovery or cross-device migration.

## UI standards round 2026-11-01 (uncommitted)

Round reference: owner request "tamam düzeltmelere başla lütfen hepsini" (2026-11-01, owner chat); primitives and rules in `docs/reference/ui-component-catalog.md` and `ui-design-system.md`. Source only, uncommitted on `main`; nothing built or installed.

Notes (`src/features/notes/**`, `notifications/**`), from `HANDOFF-w2-work-notes.md`. Drift 19 -> 0.

- Done: mode tabs on `Tabs`; NotesView header on `PaneHeader` + chrome inset (one macOS inset; the old header stacked 16px + 78px for `compactRail && !besideRail`, so eyeball that combination); group headings on `SectionLabel`; `Spinner`/`LoadingText`, `InlineError`, inline `EmptyState`; NoteDraftRecoveryNotice on `ToastSlot`/`Toast` (no `createPortal`); "Close notes" now translated; `title=` to `tooltip`.
- Left: two `useDragResize` handles use `Sash` only as the separator shell.
- Unverified: no screenshots or native run.
