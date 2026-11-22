# Editor draft copies

The desktop source implementation keeps a bounded local recovery copy of text
edited in a local file. This is separate from saving the file. A failed recovery
copy does not repeat a filesystem write, and retrying the copy does not save the
file. Keep the editor open when it says that the copy could not be confirmed.

Recovery copies retain mixed line endings along with the text. Restoring a copy
keeps those separators for the next manual save instead of converting the entire
file to one convention. A copy whose exact bytes cannot be verified remains an
error rather than being treated as a confirmed save.

During Native checkpoint preparation, affected file editors can temporarily
become read-only. An already accepted format or save can finish. Preparation does
not force-save your edits or commit unfinished IME input; external file changes
still arrive and can prevent that preparation from completing. Cancelling waits
for Native to release the preparation before input reopens.

If a saved copy already belongs to the current native window incarnation and
document, choose **Restore draft** or **Use current document**. Restoring opens
the recovered text as unsaved edits and retains the disk baseline from the copy.
Review it and save manually; restoring does not trigger autosave. If the disk
changed meanwhile, the normal reload or overwrite choice still applies.
Using the current document replaces that document's recovery copy with the open
text. Neither choice automatically sends chat messages or runs commands.

Edits made while a save is in progress remain unsaved after the older write
finishes. A late report for the older write cannot mark a newer recovery copy as
saved. The native save report retains the text; it is not a filesystem receipt.

The **Recovered work** control opens **Conversations** and **File drafts** views.
When the sidebar entry is hidden, use **Recovered work** in the desktop command
palette. File copies from
earlier window incarnations remain discoverable in the same local desktop profile.
The list starts with changed, unsaved copies. **All
copies** also includes reported saves and copies that match their captured disk
baseline. Copies are ordered by their latest recorded update. Refresh the list
when another window has edited the source.

**Open copy in new tab** first prepares a separate Native recovery row and then
opens a permanent, unsaved editor tab. Existing tabs at the same path keep their
edits. The source copy stays intact, including when its original window is still
working. An uncertain acknowledgment or failed tab opening retries the same
prepared target. Recovery itself never writes the file or submits a chat turn.

A changed or unreadable disk file keeps the explicit reload/overwrite choice.
Background watcher reads cannot silently clear that decision. A pending or newer
editor snapshot cannot be replaced by replaying an older prepared locator after
remount. Use Recovery to select the latest copy if an old locator is no longer
current. Renaming a dirty file captures its current text at the new path while
retaining its historical locator without rewriting its digest proof.

Locked/hidden project copies are concealed. When origins cannot be mapped to a
known visible project while groups are locked, those copies are concealed too.
Standalone files use their own parent folder rather than the selected project's
Host or execution directory. Clearing the session recovery list does not
delete file copies.

Unsaved edits are tracked only in memory by the open desktop. When a worktree
removal reaches a desktop that has unsaved files under it, the removal is refused
until they are saved or closed; when no desktop is connected, these draft copies
are the safety net. The Host keeps no record of editor buffers.
