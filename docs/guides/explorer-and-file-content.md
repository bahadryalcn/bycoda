# Explorer and file content

Files opened from a conversation appear beside the conversation, with the viewer
chosen for the format: rendered HTML, PDF and Markdown previews, or a source
editor for text and code. Image links retain their image dialog; video links
open a media dialog with playback controls. The conversation and its composer
draft remain available. Opening a file beside the conversation again reuses its
pane. File opens outside the conversation continue to follow the saved file-tab
preference.

HTML previews keep their live page while you read or switch to Source. Closing
the viewer releases its preview, including when the opening reply was lost.
Reloading or closing the desktop window retires its old preview capabilities;
another window cannot close a live preview it does not own. If opening fails,
the error and Reload preview action remain beside the original source.

The preview sandbox restricts external data requests and hidden files, including
secret configuration folders. Its information control explains these limits.
For a saved HTML file, **Open saved file in default app** explicitly opens that
file outside the app sandbox. It opens the saved bytes, not unsaved editor changes;
failure stays visible without closing the live preview. Inline-only content has
no external-file action. No network or file-access permission is relaxed.

When a reply names an output folder and then lists filenames, file links also
check that folder. A project-prefixed folder such as `ui-tests/investor-deck/`
works when the conversation already runs inside `ui-tests`. Existing direct
paths take precedence; fallback paths must exist on the conversation's owning
computer. This applies to HTML, PDF and Word links as well as other files.

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
Saving preserves the existing LF, CRLF or CR separators, including mixed files.
New line breaks use the file's most common separator; editing one line does not
normalize every other line. Draft recovery retains the same separator information.
If separators cannot be matched safely, saving stops and keeps the edited buffer
for review and retry instead of changing the rest of the file.

Saving a connected Host file checks that its contents, target and access permission
still match before replacing it. Unsupported text encodings, multiple hard links
or permissions that cannot be preserved stop the save and retain the editor text.
If replacement cannot be confirmed, the error names recovery candidates. Inspect
the saved file and those candidates before retrying; an uncertain result is not
a confirmed failed write.

Use the eye and code icons in the upper right to switch modes; their tooltips
show Preview and Source. In a Markdown preview, hold Ctrl and scroll the mouse
wheel to zoom between 50% and 200%, or use the minus and plus controls. Click
the percentage to reset to 100%. Preview zoom stays in that open viewer across
mode switches; source editors retain their separate code zoom.
Right-click source code (or press Shift+F10) to open editor actions: Undo, Redo,
Cut, Copy, Paste, Select All, Find, Format document and Save. Selected code also
offers Add to chat. The original side of a split diff retains reading actions;
editing actions are disabled for read-only documents. Format document uses the
same project formatter as Alt+Shift+F and changes the editor buffer; Save retains
the existing format-on-save preference. Clipboard errors appear in the editor,
and a delayed Cut or Paste does not overwrite newer edits or selections.

If formatting fails during Save, the editor still attempts to save your current
text. **Saved, but formatting failed** appears only after that save succeeds.
A failed save keeps its own error and unsaved edits; a format warning alone is
not proof that the file was saved. Editing again clears the saved claim.
Manual **Format document** changes the buffer without saving it.
Formatting uses whichever formatter the project installs (Oxfmt, Biome or
Prettier); bycoda does not bundle one. Projects without one, and files the
formatter reports unsupported, skip formatting; Save still writes the file.
Actual syntax and execution failures still appear as format errors.

Editors open on the same file, such as its own tab and its Working Tree review tab,
share one document, like a file and its diff view in VS Code. An edit appears in
every one of them at once, and Undo/Redo (Ctrl/Cmd+Z, Ctrl+Y or Cmd+Shift+Z) in
any of them steps through the same history. The editor you typed in saves the
change; the others take that save as their own and do not report it as a change on
disk. An editor still holding other text, such as a recovered draft, joins again
once it is reloaded; typing into it starts a new shared history from its text.

Draft text, undo history, selection and scroll position keep their existing owners.
Closing Find returns keyboard focus to the preview's scroll region independently
of interface language. Code blocks and wide tables retain their own necessary
overflow; the file preview remains the document scroll owner.

Editor change ticks complement the document scrollbar. Inactive source editors
must not paint a competing ruler or receive input. PDF text layers keep their
glyphs transparent over the rendered page while selection uses the shared theme
roles. Native scrollbar, zoom, keyboard and selection behavior still depend on
the platform; this source change does not establish native acceptance.
