---
name: feature-markdown-preview
description: Markdown file Preview/Source and scrollbar inventory for retained editors, ghost diff overview rails, inline/split scroll ownership, Skills and Notes boundaries, find/selection, metadata/images/code overflow, semantic scrollbar themes and native input acceptance. Read before changing Markdown preview or shared scrollbars.
---

# Markdown preview and scroll ownership

## H4 file/editor implementation packet, 2026-10-28

File-local MD and SEL-02 work, source fingerprints and per-record boundaries:
`temp/local/2026-10-28-explorer-content-impl/handoff.json`. Baseline
`4de508deabfdae8fd9a8c4c35ab7c4032b5924e9`, shared `main`, uncommitted packet.
Preserve the existing retained MarkdownViewPane contract from H6 and native
draft-persistence changes in FileEditor/CodeMirrorEditor. Sessions Markdown
renderers/shell belong to H6, source-control diff consumers to H5, Skills to H3
and Notes to H7; file consumer delivery cannot close their records. Theme roles
remain owned under src/styles and no theme files are changed by this packet.
Test edilmedi under nightly RULES.md: real selection, active/inactive paint/hit
testing, screenshots, input/native acceptance and suites remain morning checks.
Only a final fast typecheck is permitted; see handoff for its actual result.
Guide: `docs/guides/explorer-and-file-content.md`.

## Purpose, identity and scope

Read/edit Markdown without ambiguous scroll controls or lost document state.
Keywords: MarkdownDocumentPreview, MarkdownViewShell, Preview Source, AGENTS.md,
Working Tree, ghost scrollbar, overview ruler, diff ticks, thumb, CodeMirror,
split, wheel, high contrast, find, Skills, Notes.

T2 audit/design on2026-10-27, dirty shared
`main @ d8bf868fae841b8b391ce148487cd7d373ea9762`, source package0.6.94.
One owner crop has UNKNOWN installed-source inclusion. History inspected:
`29d534f9f`, `cf3944cfb`, `07a34eff9`, `3419af022`, `0a6973a21`, `b28f82624`.
Live feature-claim API unavailable in session tool metadata; native agent state
and worktree/status inspected. This card is not a reservation. Preserve concurrent
Host/Voice/navigation/locales/shared Button work; one writer per file.

## Surface inventory

Search roots: src/features/files, sessions, source-control, skills, notes,
settings; src/shared/hooks, src/styles, tests/browser and mobile/src. Re-enumerate
all component callers, classes, labels and active/shown behavior before editing.

- File Preview/Source/drafts/save: `src/features/files/ui/FileEditor.tsx`,
  `CodeMirrorEditor.tsx`, `FilePane.tsx`, `FilePreviewSearch.tsx`,
  `PreviewSelection.tsx`; HTML/SVG use the same retained-source shell.
- Shared rendering/mode: `src/features/sessions/ui/MarkdownDocumentPreview.tsx`,
  `MarkdownModeToggle.tsx`, `AgentMarkdown.tsx`, `SurfaceSelection.tsx`;
  `src/shared/lib/markdownFrontmatter.ts`.
- Editor rails: `src/features/files/editor/editorScrollbar.ts`,
  `editorOverview.ts`, `overviewRulerView.ts`, `overviewRuler.ts`,
  `editorSplitDiff.ts`; `src/features/source-control/ui/DiffOverviewRuler.tsx`,
  `DiffLayoutToggle.tsx`, `WorkingTreeDiff.tsx`, `CommitDiff.tsx`,
  `ConflictLayout.tsx`. Inline and split have different real scroll owners.
- Skills: `src/features/skills/ui/SkillsPage.tsx`, `SkillsPage.module.css`,
  `SkillDocumentPreview.tsx`. Parent document overflow plus inner self-owned
  preview is an ambiguous contract, not proven rendered duplicate overflow.
- Notes: `src/features/notes/ui/NotesView.tsx`, `NoteEditorPane.tsx`,
  `NoteEditablePreview.tsx`, `NoteMarkdownEditor.tsx`, `notes.css`,
  `SessionNotesPanel.tsx`. Notes does not use the shared document shell; each
  visible pane owns scroll, hidden Source is display-none but mounted. Dock uses
  textarea. Preserve feature-notes canonical Markdown and editing decisions.
- Shared style/input: `src/styles/index.css`,
  `src/shared/hooks/useLockOverscroll.ts`. Policies is a bare AgentMarkdown
  consumer; no prompt-template document-preview consumer found. Broader bare
  Markdown consumers are theme regression representatives, not all alleged bugs.
- Mobile has no imports of desktop MarkdownPreview/MarkdownDocumentPreview/
  MarkdownViewShell/AgentMarkdown in searched mobile/src. Native Notes owners
  remain separate; no phone-scroll acceptance claimed.

Existing file read/write/Git entrypoints are imported from
`src/platform/tauri/fs.ts` by FileEditor. No new RPC/tool/Rust behavior is proposed.
Follow feature-source-control, feature-skills and feature-notes for the exact
operation/transport authority before touching those layers. Shared scroll/theme
work does not grant file writes, staging or clipboard operations.

Locale families: Preview, Source, Markdown view, Markdown preview, Markdown
source, Properties, Skill metadata, Find, selection and existing technical/Git
domain labels. Preserve translated names and use stable DOM refs for logic.

## Owner decisions

2026-10-27, conversation `0567326f-aade-4baa-89f3-b44c6256ae9e`, verbatim:

> md dosyalarında 1 tane daha scroll var mesela ama çalışmıyor yada anlamadım başka birşeyde olabilir

> 2 tane ok gösterdim sana zaten normal scroll bar da çok iyi gözükmüyor. Bunlarında düzeltilmesi gerekiyor.

Repair/audit request; no selected scrollbar dimensions, native behavior change,
default mode change or authorization for live content operations.

## Source findings and preservation

Inactive shell relies on inherited visibility:hidden/pointer-events:none
(`MarkdownModeToggle.tsx:103`), but OverviewRuler sets descendant visibility visible
when marks exist and explicit pointer auto for interactive split rulers
(`overviewRulerView.ts:83`, `:141`). Split draws a viewport band beside native
scrollbar and writes hidden split scrollTop through its callbacks
(`editorOverview.ts:239`, `:251`). This explains a ghost, apparently nonworking
Preview control at source level; owner screenshot reproduction remains unverified.
Inline already suppresses native scrollbar and has tick-only overview.

Preserve mounted source undo/draft/selection/top-line, Save from Preview, separate
review/ordinary mode keys, deferred shown reload, diff/diagnostic/hunk navigation,
metadata, relative images/links, active selection/search and cleanup. File find
reveal uses `.markdown-preview`; its close target currently uses an English
aria-label despite translation. Correct ownership/ref without losing focus.

Do not flatten legitimate code/table overflow, Notes Split pane owners or textarea
dock behavior. Code bodies are bounded/resizable and support selectable/copyable
content. Existing overscroll guards allow inner scrolling and Ctrl/Shift wheel.
Retain capture-failure/blur/observer/RAF cleanup. Split ruler lacks inline's
Ctrl/defaultPrevented guard; verify actual gestures before closing a fix.

## Proposals

One document thumb per visible pane, inactive subtree with no paint or hit targets,
clear change ticks, semantic shared thumb/status states and explicit Skills scroll
contract. Preserve macOS native overlay and ensure high-contrast recovery. Do not
mechanically install a ScrollArea or replace editor virtualization. Reuse existing
tabs/Button/focus/overlay owners; semantic colors live in owning src/styles theme.
No dimensions or new defaults are selected by this card.

## Checks, blockers and handoff

Local Native draft increment (2026-10-28): immutable source documents are admitted
through `FileEditor.tsx` into `files/data/editorDraftPersistence.ts`, including
hidden Source edits and Preview saves. Recovery text is a separate initial dirty
document against its original disk baseline; normal `value` remains a saved
baseline. Restored edits require manual save. Standard/inline/split editors share
the boundary; conflict result text is captured but merge-region choices remain
separate unfinished persistence work. Foreign-owner recovery/new-document opening
and remote/web contracts remain open. Native observations remain unqualified.
See Host runtime card, `docs/guides/editor-draft-recovery.md` and
`temp/verification/2026-10-28-editor-producer/README.md` for exact evidence/limits.

Register/brief: `temp/local/2026-10-27-markdown-scroll-audit/AUDIT.md` and
REDESIGN.md; 12 records (two V+S/ten S),18-family checklist. Evidence:
`temp/verification/2026-10-27-markdown-scroll-audit/EVIDENCE.md`.
111 existing tests/15 suites pass with expected mocked Save failure logs retained.
Focused existing checks include editorScrollbar/editorOverview/overviewRuler,
MarkdownModeToggle/MarkdownDocumentPreview, FileEditorSave/FileEditorShown,
CodeMirrorEditor.lifecycle, FilePreviewSearch/PreviewSelection,
SkillDocumentPreview, AgentMarkdownCodeSize and useLockOverscroll tests.
Browser references: `tests/browser/file-save.spec.ts`, `responsive-diff.spec.ts`,
`notes.spec.ts`, `settings-skills.e2e.ts`; inspect matching configs before running.

Implementation acceptance: actual1280/800 light/dark screenshots opened/reviewed,
long/no-overflow and late diff marks, active/inactive hidden-tab paint/hit tests,
Preview↔Source draft/undo/position/find, inline/split/conflict threshold changes,
Skills/Notes/code/table consumers; keyboard/reader, high contrast,200%zoom,
Ctrl+wheel/pinch/touch/OS always-show scrollbars and Windows/macOS/Linux webviews.

Concrete blocker for those checks: this delivery is audit/design only, no product
patch or application/native/device run. Schematic/source/mock results are not
repaired UI/installed/native acceptance. No committed repair SHA, package, install
or release exists from this task. Baseline is the immutable reference above;
source inclusion UNKNOWN. Ready for implementation review, not shipping.

## Related diff-toolbar extension, 2026-10-27

The owner's later remote.rs Working Tree screenshot adds a separate selector/
header issue: `temp/local/2026-10-27-diff-toolbar-audit/AUDIT.md`, six records,
two direct owners/eight routed families. Default Select's2.25rem minimum exceeds
the2rem diff row; icon trigger plus existing checked menu proposed. Preserve
Automatic/Inline/Split, effective-versus-saved truth, draft/undo/focus, hidden
source containment and valid scroll owners. Sibling storage sync and swallowed
save outcomes need explicit attention. This extension does not close or recount
the12 scrollbar records. Audit only; no product or real app/native acceptance.

### General local editor-copy recovery continuation, 2026-10-28

The new local recovery catalog prepares a separate Native row and permanent file
tab. `FileEditor` reads an exact prepared locator and checks current owner, pending,
error, disposal and acknowledged revision/hash on both sides of the disk await.
Changed/missing disk retains the historical baseline and explicit overwrite gate;
watcher reads cannot clear it merely by matching the initially observed new disk.
Recovered text starts dirty with autosave suppressed until a deliberate disk save.

`CodeMirrorEditor` retains current text across child replacement through parent
carry state. Dirty file moves capture current text/EOL/baseline without rewriting
the historical recovery locator. Layout contains no plaintext. `FilePane` routes a
recovered text copy to the editor even for image/media/document extensions.

Evidence: `temp/verification/2026-10-28-editor-recovery/README.md`:204 source
tests,21 browser scenarios and12 reviewed light/dark1280/800 captures. This local
increment does not close the separate scrollbar/diff-toolbar audits above. Rich
merge-region decisions, remote/web persistence, Native FS receipts and installed
Native/platform/screen-reader acceptance remain open. Save reports retain text;
all migration qualification remains false and no fence is retired.

### Earlier path-only reports, 2026-10-28

Recovered work now also inspects this local Native profile's earlier file
path/dirty reports. They contain no edited text. Matching file-name recovery
copies can be filtered in the existing catalog and opened through its unchanged
new-tab/manual-save flow; matching names never settle or delete an earlier hold.
The entry remains available when modern copies/conversations count0. All source
reads and copy-filter actions recheck live group privacy and its synchronous
invalidation identity, including a lock/unlock ABA before React renders.
Root14 service/controller tests and27 Chromium recovery/save fixtures pass;
light/dark1280/800 captures and independent privacy red/green proofs are retained
in `temp/verification/2026-10-28-legacy-recovery-ui/`. Native/disk IPC is fake in
the browser. This does not close rich merge/remote editor, Host-held recovery
dispositions, installed Native or screen-reader acceptance. Source is uncommitted
on main baseline4de508dea; no fence/default/floor or release is promoted.
