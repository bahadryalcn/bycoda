# Workbench navigation

Collapsed project navigation uses a 56px icon rail with a centered divider and a
small-size vector mark. Expanded sections share label and count columns; Last
sessions keeps separate collapse and open actions.

GitHub Inbox discovers repositories from local remembered projects. Its **Local
repositories** filter shows each `owner/repo` once, even when several checkouts
point to it. Forks and upstream repositories remain separate. Remote-machine
projects are not scanned by local GitHub commands. Saved checkout filters still
apply to their repository; clearing a selection also clears its old checkout aliases.
Non-Git folders and folders without remotes do not block loading. Operational
failures keep Retry and expandable details while available items remain visible.
Searchable filters inside the Inbox filter menu open beside it. They prefer the
right edge and flip left when space is limited; constrained windows keep the
choices within the viewport. Escape closes the inner picker first.

When you scroll up in a conversation, **Jump to latest** appears above the composer.
Click it, or focus it and press Enter or Space, to return to the end and resume
following new messages.

On Windows and Linux, scrollbar thumbs appear when you hover over or focus a
scrolling area. Touch-only devices and high-contrast mode keep them visible.
macOS native scrollbars follow the system preference. The editor's custom thumb
also appears on hover or focus; its diagnostic and cursor marks stay visible.
Scrolling and dragging remain available without changing the reserved space.

Collections scroll continuously instead of using numbered pages. Search, filters
and selection remain in place while more records load. Large loaded collections
keep only a bounded window of rows mounted. Where a provider requires a cursor or
offset request, use **Load more** at the end of the list. Loading, failed reads and
partial coverage appear there without replacing previously loaded records.

Ordinary panels, lists, detail panes and empty states share the canvas in both
Pure and Tinted appearance. Spacing and fine borders separate content. Floating
menus and dialogs, writing controls and code or log viewers keep their raised
surfaces; selection, hover, drag and status indicators retain their own roles.

Counters use compact, borderless accent labels. Counts above 99 show `99+` while
retaining the exact accessible count. Pending questions and approvals use warning
indicators. Running work uses an accent dot or activity icon beside its title;
cards and rows do not add colored edge stripes for activity.

Rename a conversation from its menu or with F2. The title edits inside the same
row; project and activity stay visible. Enter saves, Escape cancels, and a failed
save retains the draft for retry.

Choose **Regenerate title**, immediately below Rename, to create a title from the
saved conversation without sending a new turn. **Settings > Chat > Conversation
titles** selects its model and account. Automatic chooses an enabled lightweight
model from the conversation provider, preferring Haiku, Terra or Flash. If no
lightweight model is available, choose one explicitly. Failed generation keeps the
current title and offers Retry; a concurrent manual rename is preserved.

While a project is open, Working summarizes its running conversations in one compact
line and lists conversations from other projects. Its header still counts all running
conversations. Conversations needing attention and finished conversations remain
available as individual rows. Last Sessions keeps the complete Working list.

Above the composer, expanded background work shows the reported model and provider
icon above each subagent's title. Hover or focus the information icon to see status
counts in a card; click or tap to keep it open. The separate arrow toggles the list.
Steps, failed steps and elapsed time sit beside
the opening chevron. Animated bars mark running work; a green check marks completed
work, a red cross marks failure, and warning icons distinguish stopped and interrupted
runs. Hover or focus a row for its full identity and status. Missing child-model
metadata stays unspecified rather than borrowing the parent conversation's model.

Readable labels stay quiet on hover. Tooltips explain icons, missing shortcuts
and additional context, or reveal the full text when a label is clipped. Narrow
panes that hide tab labels keep their icon explanations. Error reasons and
connection details remain available; accessible control names do not depend on
whether a tooltip is visible.

Conversation deletion keeps its confirmation and shows progress while work is
pending. Successful deletion clears the progress without an extra success banner.
Failures, skipped conversations and incomplete cleanup remain visible for review.

While a queued message is being delivered, its queue header shows a compact progress indicator. A brief check means the provider accepted it; follow the conversation for execution and completion. Unconfirmed or rejected deliveries retain their explanation and recovery actions.

Shift+Tab adds the message to the active queue; it does not switch the composer
into a queue mode. The queue sends it when the conversation is free, including
when the previous turn finishes during submission or a provider handoff completes.
An explicit Queue action retains that choice through preparation. Providers without
safe mid-turn delivery offer Queue while busy instead of Steer. Claude takes a
Steer at its next tool step, or right after the current reply; the turn stays open
until that message has run. An older Claude Code that cannot report message
progress keeps the Steer queued instead.
Each queued message keeps the provider, model and account it was queued with, so
one queue can mix providers; rows run in order and the queue switches provider
between them on its own. Steer with a different provider than the running turn
stops that turn and starts the message on the selected provider; the rest of the
queue then continues in order. Only Stop, a failed turn, a usage limit or an
unconfirmed delivery pause the queue for Resume.
Long preparation keeps its reservation while the owning desktop renews its lease.

Changing the provider, account or model writes one row into the conversation:
the provider icon, account and model before and after the latest switch. Switches
made with no message between them share that row and show a count; open it for
each step and its time. A pick made while a turn runs reads **Next message** until
it applies, and a switch that could not move the conversation says a summary goes
with the next message. A finished provider handoff adds no divider of its own;
failed or cancelled handoffs still show one.

Queued messages keep their order when the running provider turn ends before a
follow-up can enter it. The message returns to the queue and an active queue
continues automatically when the conversation is free; no second Resume is needed.
Stop and an explicitly paused queue still require Resume. Rejected sends and
unconfirmed delivery remain held for review instead of being resent automatically.

Images in older saved queues are moved to ordinary local attachment files before
queue synchronization, keeping image bytes out of the limited browser storage.
If saving fails, the message and original image stay queued for recovery.

Question answers are retained locally while you switch conversations or hide a
form. The local question store has a shared limit of 64 question drafts and 4 MiB,
with at most 1 MiB per question. When full, a new question stays read-only and
explains how to free capacity; existing unfinished answers are kept. An answer
that exceeds the limit leaves the previous saved value intact. A changed question
has its own draft, so an answer is never silently applied to a different request.
These local records are not a guarantee of recovery after an application crash.

Approval controls show progress on the decision being sent. If delivery is
uncertain, they show “Waiting for confirmation” and retain the original decision
instead of offering an automatic resend. Switching views does not cancel the
original operation. A changed request or connection is refused before dispatch;
check its message and review the current request. A transport callback completing
does not by itself confirm that the provider applied the decision.

Each new approval carries the identity of the original execution request across
desktop, web control, Crews and mobile. An old decision cannot answer a later
request that reuses the same number. If the Host does not support this check,
update it before responding. Older saved requests without this identity remain
readable; refresh the conversation or update its execution client to obtain a
verifiable request. The app does not add an identity to an old queued decision.

Saved local conversations support [session links and Markdown references](local-session-references.md),
including compact details and opening a cited conversation beside the current one.

Use the project rail to choose a project or workspace, the sessions list to
choose a conversation, and the top tabs to switch open work. These keep their
existing saved widths, layout and density settings. Standard and detailed session
rows show project identity above the conversation title. Within one project,
rows keep neutral backgrounds while showing the saved project mark. Pin, archive
and delete appear in the project header on hover or keyboard focus. Pin replaces
the project mark beside its name; pinned rows keep the pin visible. Touch keeps
them available. Status stays at the upper right; hover or keyboard focus hides
its word while keeping its icon and Working elapsed time. Plain branch text and larger
provider icons sit below the title without shifting when actions appear.
Previous providers appear muted; the last provider used retains its color. Hover or focus the title for model, location and handoff
details. Compact density keeps one-line rows.

Interrupted conversations show a yellow warning with an Interrupted label or an
accessible warning icon in compact rows. Opening a conversation does not clear
the warning; continuing its turn does. Recording an interruption during quit or
recovery preserves its last activity time, so that maintenance alone does not
move it to the top of the recent list. Existing timestamps changed by older
versions cannot be reconstructed reliably.

Menu actions apply to the focused workspace. Tray session actions open their owning
window; terminal output, pinch zoom and reminder navigation stay with their target
window. Shared preferences and reminder lists still update across workspaces.

Reload asks for confirmation when this window has running local conversations or
unsaved file changes. It interrupts this window's local conversations; work on a
remote Host and work in other windows continue. Cancelling keeps the window open.
When quitting the app, file and terminal close dialogs remain open until answered.
Time spent answering those dialogs does not consume the timeout for saving the
workspace. A failed save keeps the app open and reports the failure.

Opening a conversation already held by another window focuses that window.
Local conversations and remote Host conversations keep one window owner, including
idle tabs. If the owner cannot be verified, opening stops with an error so you can
retry. Moving tabs keeps the source until the destination confirms receipt;
running local turns wait until they finish before moving.

The primary window restores the saved workspace. Additional windows start blank
unless they receive an explicit tab transfer. Each window records its own running
conversations for recovery without replacing another window's records. A local
conversation enters recovery only after its original process has stopped; unknown
process state stays protected.

Click **Last sessions** in the project rail to open a combined workspace list. It
shows conversations active during the last seven days, newest first, with each
project's saved icon, color and background. This view stays open when a conversation
is selected. A refresh keeps the previous complete list visible until the new
history has loaded; an error leaves that list available while retrying.
Explorer and Changes follow that conversation's real project and
execution worktree. The **+** action in Last Sessions first asks which project should own the new
conversation. Search or choose a project, including the current one; cancelling
creates nothing. The new conversation uses that project’s defaults and selected
checkout while Last Sessions stays open. Choose **No project** to start a conversation
that belongs to no project: it runs in the folder set under Settings → General →
**Folder for sessions without a project** (your home folder by default; the folder is
created when missing) and appears in Last Sessions with a folder icon. Choosing a project from the rail returns
to its own conversation list. The
combined list does not make unrelated repositories share Git operations. The time
filter can narrow this window to Today; Clear restores Last 7 days. Remote rows
come from available history and show a coverage note rather than claiming a full
remote archive. Local pinning remains available; project-scoped archive/delete
operations stay in the project view. Deleting several remote conversations at once
sends them together; the result appears on both computers.

The sessions filter menu can show only conversations managed by your named
assistant. It uses the Host's management record and combines with provider,
time, archive and status filters. Clear filters restores the full list.

**Settle** (the check mark in a conversation's header, or on its sidebar row
when you hover it) moves a finished conversation to the collapsed **Settled**
group at the end of the project's list. The **Settled** filter lists only
settled conversations. It does not lock anything: the conversation stays writable, and its next
message moves it back to the active list. Settling while a turn runs waits for
the turn; a failed turn or a queued message leaves it active. **Un-settle**
brings it back and keeps it out of automatic settling until its next message.
Conversations idle for three days settle on their own; change or turn this off
in Settings → Session list → **Auto-settle after**. Pinned, archived, running and
waiting conversations never settle automatically, and pinned, foldered or
reminder conversations stay where you placed them. Settling applies to
conversations on this computer's Host; archive and tasks are unchanged by it.

To keep the shelf short, Settings → Session list → **Archive settled after**
archives conversations that stayed settled for 7, 14, 30 or 90 days. It is off
by default; pinned, running and waiting conversations stay, and archived ones
can be restored from Archive. The **Settled** group's menu (right-click its
header or use its more button) offers **Archive all** and **Delete all** for the
conversations listed in it. Delete all asks for confirmation and cannot be
undone; nothing is deleted automatically.

The Workspace picker fits its label and arrows. Conversation search opens in the
remaining header space. While search is open, selection and filter buttons yield
their space to the query; they return when search closes, retaining their state.

Settings → Keybindings includes **Stop computer use**, with the default global
shortcut **Ctrl+Alt+Esc** (Control+Option+Esc on macOS). It stops computer control
on this computer even while another app has focus. You can change or disable
the binding; a rejected replacement retains the previous native binding.
This action does not resume control or stop coding jobs.

Project options, pinning and session row actions appear when you hover or focus
their row, while the row is selected, and on touch devices. Project change counts
and connection warnings remain visible. A wide project row shows added and removed
lines; a narrow row shows one changes icon with the number of changed files, and
the row's tooltip and accessible name keep the full counts. Projects with the same
name show their parent folder next to the name. Right-click retains the full contextual
menu; keyboard users can use the context-menu key or Shift+F10 on supported rows
and tabs. Tab close shortcuts and middle-click behavior remain available.

A linked workspace lists the folders declared in its `.code-workspace` file; it
does not discover subfolders automatically. The workspace name opens the containing
folder. A declared containing folder (`.`) also stays visible as a child project,
including after the workspace is moved into another group.

A workspace group is identified by its Workspace icon and tooltip. Its linked
file, Git and lock controls appear with row interaction; Git change counts and
link warnings stay visible. Narrow rail layouts retain their compact presentation.

Pin a group or workspace from its group menu; pinned groups list first and show
a pin in their header, which unpins them. Projects inside a group cannot be pinned on their own,
and a project's earlier pin is dropped when it joins a group. Group members are
indented under the header on a guide line.

A single conversation shows one compact title row with its tabs and actions; a
pane gets its own header only when the workspace is split. On Windows and Linux
the menu button at the start of the title row opens the application menus, and
Alt or F10 still opens them from the keyboard. The Changes tab always shows how
many files changed; the added and removed line totals appear when the tab has
room, and its tooltip names both counts. Keyboard focus on a session row opens
a small detail card with the title, model, branch or worktree, path, status and
the full date and time of its last activity.
The card closes when you scroll its list, resize the window or switch away from
the app. Focus the row again or hover it to reopen the details.

Hints and previews are consistent across the app. Hover an icon button for about half a
second, or focus it with the keyboard, to see its name, its shortcut as key caps and, for
a disabled action, the reason it is unavailable; hints never appear on touch. Rich previews
(session and link previews, graph commits, the context meter) open after a short rest
or on keyboard focus, can be entered with the pointer, and close with Escape. Background
notices, reminders and approval requests stack in one column per screen corner instead of
overlapping.

While you scroll up to read earlier messages, the message box shrinks to its text
(one line when empty) to give the conversation more room. Click or tab into it, or
open one of its menus, and it returns to full size; it shrinks again when you go
back to reading, and returns to full size at the end of the conversation. Your
draft, cursor and attachments stay as they are. Actions under an assistant reply
(copy, save as note, handoff, second opinion, turn details) are a compact icon row
with tooltips; a failed copy or save shows the reason and a retry icon in place.

The notifications sheet lists pending requests and **Recent**, the common log of
what the app announced (the last 100): questions, approvals, finished and failed
turns, reminders, background work, assistant messages and account notices. Each
row carries a kind label and icon. An event is logged when its notification
setting allows it, even if no desktop banner was shown because bycoda was in the
foreground or banners are off; a muted project is not logged, and a locked group
is logged without its text. A pending approval is decided in place with Allow or
Deny, which show their progress and any error on the request itself; a pending
question opens its conversation with **Answer**. Clicking a recent row opens its
conversation, or for background work, the assistant and account notices the view
they belong to; if that conversation no longer exists, the row says so and the
sheet stays open. A recent request that is still unanswered is marked **Waiting
for you**. Each row can be removed on its own, and **Clear all** above the list
removes them all. Removing and clearing happen only after the change is saved; if
saving fails, the list stays and says so.

Desktop banners appear only while bycoda is in the background. While any bycoda
window is focused, conversation updates, pending requests and reminders remain
inside the app, including updates from other conversations. Returning to bycoda
before a queued banner is sent cancels that banner; it is not replayed when you
leave. Sound preferences and in-app attention indicators remain independent.

Use **Sounds** in the bottom-right workspace controls to toggle application sounds,
including notification cues. The icon shows when sounds are muted. This shares
the saved **Settings > Notifications > Sounds** preference; desktop banners and
request popups keep their own settings. If saving fails, the previous state stays
active and the error offers **Retry**.

The project menu groups remote machine reconnection and editing under Machine.
Recovery lists retain their open and clear actions, including local pending and
retry feedback. In compact navigation, open the recovery panel to use its full
list controls. Unsaved-file indicators remain visible independently of tab-close
controls.

Remote workspace panels share one connection notice per machine. When automatic
reconnection is enabled, short network interruptions retry quietly for eight
seconds while loaded conversations, files and Git data remain available. A longer
interruption shows the shared recovery controls instead of repeating the same
warning in each pane. Dismiss a transient outage notice for its current episode; it returns if the machine recovers and later disconnects again. Dismissal changes presentation only. Content that has never loaded remains unverified, not empty.
Authentication, identity and compatibility problems appear immediately; turning
automatic reconnection off also makes the recovery control available immediately.
Independent service, storage and operation errors retain their own feedback and
retry controls. Notification timing does not change sending permissions or replay
messages and commands.

Before starting a local desktop turn, bycoda saves the conversation. If the save
fails, the send reports that the conversation could not be saved before starting.
Resolve the storage error before trying again. If the conversation changes while
the turn is being prepared, the send asks you to try again in the current
conversation.

Settings opens as a dialog over the workspace you were using, which stays visible
behind it and unchanged. Short pages use a bounded dialog; collections and
list/detail pages open wider. Use the maximize button in the Settings header to
fill the window and the same button to restore the size; this never reloads the
page, so unsaved fields and the selected category are kept. Escape or the Close
button closes Settings and returns focus to where you opened it. In narrow
windows the category list becomes a picker.

Contrast previews its thumb and percentage while dragging, then applies and saves
the final value on release. Cancelled adjustments leave the saved value intact;
reset and newer changes from another window take precedence over an older drag.

Maximizing a split panel changes its corner action to Restore panel layout and
shows inward arrows. Restoring returns the outward arrows and the previous split.

After successful context compaction, the context meter replaces its old reading
with the provider's new count when available. Otherwise the old fullness clears
until the provider reports a new reading; compaction does not imply zero tokens.
Failed compaction keeps the last valid reading.

Reopening an eligible local saved draft puts its text and attachments into the
normal composer while retaining the original saved turn until submission is
accepted. Opening never sends it. Newer composer input or a changed saved source
remains separate instead of being overwritten. Clearing an editable draft stays
cleared after reopening; held or uncertain deliveries keep their recovery actions.
If session ownership cannot be loaded, the saved source remains available with Retry.
