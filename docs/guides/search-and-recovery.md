# Search and recovered sessions

Search opens in its existing dialog and can be expanded explicitly into the
workspace. Query, result type and conversation filters retain their existing
workspace context. All combines different scopes: files/content use the current
execution directory, conversations use their existing search scope, and projects
come from the supplied recent-project list. Read the scope description before
opening a result.

Result groups retain their category order. Shown counts describe loaded results;
display limits and native search limits are separate. Application-wide indexing
may still be in progress when a query has no indexed match yet. Narrow the result
type or retry a failed source without treating the list as a complete inventory.

Keep typing in the search field and use arrows to move between results; Enter
opens the active destination. As asynchronous sources arrive, selection follows
the result identity rather than its old position. Query/scope changes choose a
new starting result deliberately. Selected rows expose their full identity so
long names and paths can be checked before opening.

Only work that was interrupted enters recovery: a chat that was running when the
app closed or crashed. Open chats that were idle or finished are not recovered
work, and neither are remote chats, which keep running on their Host. Entries
whose conversation is confirmed Done or Idle are resolved automatically (the
list reference only; history is never touched), so the Recovered work count is
the interrupted work that still needs a look. Unknown, unavailable and unverified
entries stay listed. After launch the dialog opens by itself only when such work
remains.

The dialog is one compact list. Tabs for File drafts and Earlier file reports
appear only when there are file copies to show; with conversations alone there is
no tab strip. The Needs attention / All filter appears only while it separates
something, the search field only for a longer list, and the list menu only for
more than one entry. The Help button beside the actions explains what Open all
and Restore chat layout do.

Opening a recovered entry adds or focuses a conversation tab; it does not restart
agent work. Removal clears recovery references while preserving history and
running work. Restore concerns eligible chat panes and retains unrelated new
work; saved editor and terminal panes are not recreated.

Closing a new local chat that still holds unsent text or attachments keeps it in
the project's conversation list. The unsent input becomes the chat's saved draft;
open the chat to send it, or remove the draft to discard the chat. A new chat
closed without any input is still discarded.

Open all and restore target the eligible population, including records hidden by
search/status filters. Selected actions target selected entries currently shown;
hidden selections remain stored and are counted separately. Project aliases can
be used to find entries.

Checking status, a failed verification read and a confirmed unavailable record
are separate states. Retry failed reads deliberately. Partial opens keep
successful tabs open and remaining failures actionable. If tabs open but saving
the recovery update fails, the save failure is reported separately; retry must
not blindly open another copy. Failed saves when closing the panel also remain
visible at the recovery entry point.
