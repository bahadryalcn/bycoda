---
name: feature-sessions-sidebar
description: Change conversation lists, sidebar/recent rows, filtering, pinning, rename, draft/status presentation or remote navigation. Preserve selection, history and project/execution identity; recovery and archive operations have separate contracts.
---

# Sessions list development

Use for conversation collection and row behavior. Projects owns the project rail;
session recovery owns recovery journals; Archive owns restore/unarchive/delete
semantics. Source paths below are repository-relative.

## Start and workflow

1. Trace `src/app/shell/Sidebar.tsx` and `LastSessionsSection.tsx` into the list
   selectors, persistence and remote navigation owners in
   [the source map](references/surfaces.md).
2. Find every affected full/sidebar/recent/compact row entry point, including
   context menus, keyboard actions, paging and search.
3. Separate row presentation from execution state and destructive operations.
   Preserve current controller ownership instead of rebuilding it in the row.
4. Exercise retained selection/filter, draft restoration, async failure and remote
   navigation. Verify narrow/long-label and keyboard states for changed layouts.

## Preserve

- Project identity, selected session and execution workspace are distinct. Use
  existing adoption/navigation routing for remote records; never fabricate IDs.
- Archive, delete, stop, close and dismiss recovery are different operations.
  Recheck locks/permissions and use existing confirmation and recovery owners.
- Keep pin/order/filter/search/paging persistence and sibling update behavior.
  A filtered subset is not the entire collection for bulk operations or counts.
- Preserve title drafts, focus, drag targets and native tree/menu semantics.
- Unsent text or attachments use the existing composer-draft subscription,
  including disk-restored drafts. Do not mark the session currently being typed
  in as an inactive draft; retain existing saved-draft/status precedence.
- Keep Draft presentation on shared warning roles, and running/Working presentation
  on existing shared status controls. Narrow rows may hide text without hiding
  accessible state, elapsed time or its activity mark.
- Keep update/footer state tied to the displayed version and confirmed package
  status. Dismissing an old notice must not clear a newer marker.
- Repository and update notices may coexist. Repository dismissal is app-version
  scoped; the next version reveals it again and an available-update action remains
  usable. Reading release notes does not dismiss the installed-update notice;
  only explicit dismissal removes the displayed version's marker.
- Pending/error row actions retain their initiating control and recovery path.
  Reading the list does not transfer execution or operation authority.
- Confirmed conversation deletion clears progress on clean success without a
  separate success banner. Preserve failures, skipped records and cleanup warnings.
- Session detail hints cancel both pending and open previews when an ancestor
  scrolls, the window resizes or loses focus; unrelated pane scrolling does not
  dismiss them. Dismissal must not restore focus to a row that moved out of view.

## Conditional references and checks

- Shell composition: [workbench](../feature-workbench-design/SKILL.md).
- Archive lifecycle: [archive](../feature-archive/SKILL.md).
- Recovered records: [recovery](../feature-session-recovery/SKILL.md).
- Workspace identity: [managed workspaces](../../../docs/reference/managed-workspaces.md).
- User behavior: [workbench guide](../../../docs/guides/workbench.md).
- Footer coexistence: [owner decision](references/decisions.md).

Use focused session display/draft-cache tests and the map's sidebar navigation
browser scenarios. UI changes follow current task theme/width/keyboard requirements;
fixture navigation does not prove live remote or installed updater acceptance.
