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

The **Recovered work** control opens **Conversations**, **File drafts** and
**Earlier file reports** views. It remains available on desktop even when there
are no recovered conversations or new-format file copies. File copies from earlier window incarnations remain discoverable in the
same local desktop profile. The list starts with changed, unsaved copies; **All
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
Host or execution directory. Clearing the conversation recovery list does not
delete file copies.

In **Earlier file reports**, choose **This computer** for this desktop profile's
local reports or **Host reports** for reports retained by its Host. The Host source
belongs to this desktop profile; selecting another project or server does not
redirect it. Choose **Check reports** to inspect earlier path and edit-status
reports. The list is read on demand, one
page at a time; search and filters apply to that page. An unreadable report stays
listed with inspection disabled. A failed inspection can be retried without
changing the file or removing its protection.

A Host page can be empty while **Next** is available because unrelated reports
were concealed. Continue with **Next** to inspect the next page. A partial-result
message means some reports remain unavailable; available reports can still be
inspected. Refreshing or changing sources never removes their protection.

These older reports do not contain the edited text. **Find file recovery copies**
shows new-format copies matching their file names. Check those copies' contents;
a matching name or reported clean status does not resolve the earlier report.
**Show all file copies** removes this name filter. If no copy exists, check the
original window for the edited text. This view does not discard or settle reports.

Earlier reports have no reliable project origin, so inspection is concealed while
any project group is locked or hidden. A privacy change also rejects pending
list and inspection results, even if the groups were immediately unlocked again.
Check the reports again after unlocking.

This remains a local desktop source increment. Remote/web persistence, rich
merge-region decisions, reviewed legacy Host/native
buffer reconciliation, native
filesystem receipts and installed desktop acceptance remain separate work.
No migration fence or supported-client requirement is retired by an editor copy.
