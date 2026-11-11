---
name: feature-explorer
description: "Change the Explorer tree, root header, selection, inline create/rename and filesystem actions while preserving local/remote routing and recovery."
---

# Explorer changes

## When and scope

Use for the workspace file tree and its actions. File content, Markdown presentation, project management and managed-workspace policy have separate owners.

## Source starts

Full paths are repository-root relative; adjacent abbreviated names share the preceding
directory. Follow current imports and callers; this map is not a completeness claim.

- `src/features/files/ui/FileTree.tsx` and `useFileTreeOperations.ts`: rendered tree and action admission.
- `src/features/files/model/`: selection, names, listing/cache state.
- `src/app/shell/Sidebar.tsx`: root identity, keyed lifecycle and mounted tabs.
- `src/platform/tauri/fs.ts`, `src/features/connections/model/remoteCommands.ts`, `host/workspaces/workspace-commands.ts`, `src-tauri/src/fs.rs`: operation routing and permission owners.

## Preserve

- Host rename canonicalizes the target parent while preserving requested leaf spelling. Case-insensitive aliases require exact filesystem identity; distinct existing entries, hard links and cross-workspace moves retain collision gates.
- Keep project identity, displayed tree root and execution cwd distinct. Retain root event/hit-test ownership when moving header DOM.
- Header, root/empty-area and item menus share create/rename admission; preserve the selected-file parent versus selected-folder target, name drafts, validation and duplicate-submit guard.
- Retain range/multiple selection, keyboard/typeahead, context menus, drag/drop, clipboard, root exclusions and hidden-selection scope.
- A successful mutation followed by refresh failure means stale listing; retry listing without repeating the mutation. Keep remaining-only cut recovery.
- Preserve chunked large-folder access, cache freshness, retained offline listing, excluded-files preference and authoritative local/remote filesystem gates.

## Workflow

1. Trace the changed action from header/menu/keyboard/drop through the owning operation and platform dispatcher.
2. Check all entry points sharing that action, including root and selected/hidden items; keep one operation owner.
3. Use shared tree/menu/field controls, then exercise rejection, cancellation, partial success and refresh recovery.

## Focused checks

For tree/action changes, run `pnpm exec vitest run src/features/files/ui/FileTree.test.ts src/features/files/ui/FileTree.create.test.ts` plus the affected model/platform tests.
For layout or event changes, exercise root keyboard/context/drop targets, long names, excluded selections and large folders; use the current `tests/browser/files/file-tree.spec.ts` fixture where applicable. Follow the project tier for visual evidence.

## Read when needed

- [File-content and tree behavior](../../../docs/guides/explorer-and-file-content.md) for user-visible action scope.
- [Editor recovery](../../../docs/guides/editor-draft-recovery.md) when touching draft/save lifecycles.
- [Markdown](../feature-markdown-preview/SKILL.md) for Preview/Source or scroll ownership; [Workspace settings](../feature-workspace-settings/SKILL.md) for excluded-files persistence.
