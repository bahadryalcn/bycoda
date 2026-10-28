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

Opening a recovered entry adds or focuses a conversation tab; it does not restart
agent work. Removal clears recovery references while preserving history and
running work. Restore concerns eligible chat panes and retains unrelated new
work; saved editor and terminal panes are not recreated.

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
