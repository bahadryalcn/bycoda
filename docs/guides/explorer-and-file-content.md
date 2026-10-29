# Explorer and file content

The Explorer header identifies the current tree root, which may be a worktree
branch rather than the project name. Its full path remains available separately
from workspace switching. Use the root control to collapse or expand the tree;
file and folder context menus retain their filesystem actions.

The compact header keeps New File, New Folder, Collapse All, search and refresh
as icon actions next to the root name; each has a name and a tooltip. In a narrow
pane Collapse All and search fold into the Explorer actions menu, whose first group
is New File and New Folder; reveal in the file manager and the excluded-files
preference follow in a separate group. The header creates beside the selected file
or inside the selected folder (the root when nothing is selected); the context
menus of the root, an empty area, a folder and a file name the folder they create
in. All of them open the same inline name field, which sits on the tree row grid
at the target folder's depth and shows what it creates and where. Collapse All keeps
the selection, the open editor and any name being typed. Creating is disabled, with
the reason, while another file operation runs; a rejected name stays editable on
its row. Showing excluded files uses the existing saved Workspace
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
