# Explorer and file content

The Explorer header identifies the current tree root, which may be a worktree
branch rather than the project name. Its full path remains available separately
from workspace switching. Use the root control to collapse or expand the tree;
file and folder context menus retain their filesystem actions.

The compact header keeps file creation, search and refresh close to the tree.
Secondary actions and excluded-file visibility remain reachable through the
header controls. Showing excluded files uses the existing saved Workspace
preference. Ignored files remain visually subordinate and retain their Git state.
Selection scope is shown when selected entries are hidden by the current filter.
Review that scope before acting on multiple paths.

A successful filesystem change followed by a failed listing refresh leaves the
tree stale. Refresh recovery rereads the listing; it does not repeat an already
completed move, delete, paste or duplication. Clipboard failures remain local so
you can retry deliberately. Empty, loading and failed folders have distinct states.

Preview and Source keep their mounted document state when you switch modes.
Draft text, undo history, selection and scroll position keep their existing owners.
Closing Find returns keyboard focus to the preview's scroll region independently
of interface language. Code blocks and wide tables retain their own necessary
overflow; the file preview remains the document scroll owner.

Editor change ticks complement the document scrollbar. Inactive source editors
must not paint a competing ruler or receive input. PDF text layers keep their
glyphs transparent over the rendered page while selection uses the shared theme
roles. Native scrollbar, zoom, keyboard and selection behavior still depend on
the platform; this source change does not establish native acceptance.
