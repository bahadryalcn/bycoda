---
name: feature-workspace-settings
description: "Use when changing Workspace preferences, autosave, file tabs and tool visibility. Not for worktree policy; see feature-managed-workspaces."
---

# Workspace preferences development

Use for Settings Workspace controls and their direct editor/navigation consumers. Use [managed workspaces](../feature-managed-workspaces/SKILL.md) for execution cwd, worktree lifecycle/ownership or repository policy.

## Source starts

- `src/features/settings/ui/WorkspaceSettings.tsx`, `WorkspaceFeatureSettings.tsx` and `WorkspaceEditorSettings.tsx` own controls.
- `src/features/settings/model/settings.ts`, `workspaceFeatures.ts` and `exactGitRewind.ts` own relevant preferences.
- Read [surfaces](references/surfaces.md) for editor/runtime consumers, Host boundary and focused tests.

## Preserve

- Preserve File tabs, Autosave, Format on save, excluded-file visibility, Working agents and tool/Notes preferences with existing keys/defaults; screenshot choices are not new defaults.
- File-tab placement controls future ordinary opens; do not rewrite or close current tabs. Preserve active editor draft/selection/conflict state.
- Autosave may save already-dirty buffers and Format applies to manual and automatic saves; preserve generation/serialization/disk-conflict and retry/undo behavior.
- Hiding a tool does not stop its tasks, automation or active view; retain direct/active reachability. Notes visibility also affects composer/save-note UI, without deleting notes/drafts.
- Working agents visibility/retention preserves busy work and persisted detached-idle sessions; do not turn a presentation toggle into a lifecycle stop.
- Preference controls retain same-/sibling updates, fresh read/write outcomes and local recovery. Synchronous local writes do not need fabricated asynchronous state.
- Quick composer scope remains macOS/native and saved intent differs from successful shortcut registration.
- Exact Git rewind targets this computer's local Host, retains default-off and owner/running-turn gates, and has ordinary execution fallback; selected remote Host or per-turn capture is not implied.

## Workflow

1. Trace the preference through its direct consumer; distinguish page-only composition from editor save/lifecycle or Host behavior before editing.
2. Use shared Settings rows/reveal and keep consequence/dependency text local. Read the relevant [Explorer](../feature-explorer/SKILL.md), [Notes](../feature-notes/SKILL.md) or [Keybindings](../feature-keybindings/SKILL.md) entry only if its behavior changes.
3. Run focused settings/model/editor tests from the map and exercise dirty-editor Autosave, sibling updates, hidden active tools and failures. Native shortcut/local Host checks need their actual boundary.

## References

- Read [surfaces](references/surfaces.md) for source ownership and tests.
- For Settings shell/search changes read [Settings](../feature-settings/SKILL.md); for Git workspace policy read [source control](../feature-source-control/SKILL.md).

## Focused checks

Use the focused test owners in [the surface map](references/surfaces.md).
