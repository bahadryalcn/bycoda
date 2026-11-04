# Workbench navigation

While a project is open, Working summarizes its running conversations in one compact
line and lists conversations from other projects. Its header still counts all running
conversations. Conversations needing attention and finished conversations remain
available as individual rows. Last Sessions keeps the complete Working list.

Readable labels stay quiet on hover. Tooltips explain icons, missing shortcuts
and additional context, or reveal the full text when a label is clipped. Narrow
panes that hide tab labels keep their icon explanations. Error reasons and
connection details remain available; accessible control names do not depend on
whether a tooltip is visible.

Conversation deletion keeps its confirmation and shows progress while work is
pending. Successful deletion clears the progress without an extra success banner.
Failures, skipped conversations and incomplete cleanup remain visible for review.

Queued messages keep their order when the running provider turn ends before a
follow-up can enter it. The message returns to the queue and an active queue
continues automatically when the conversation is free; no second Resume is needed.
Stop and an explicitly paused queue still require Resume. Rejected sends and
unconfirmed delivery remain held for review instead of being resent automatically.

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
rows show project identity above the conversation title. Within one project, the
project mark stays neutral and rows do not apply its saved project color or ground.
Pin or unpin from the upper left; status stays at the upper right, with branch and
provider icons below the title. Previous providers appear muted; the last provider
used retains its color. Hover or focus the title for model, location and handoff
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
is selected. Explorer and Changes follow that conversation's real project and
execution worktree. The **+** action in Last Sessions first asks which project should own the new
conversation. Search or choose a project, including the current one; cancelling
creates nothing. The new conversation uses that project’s defaults and selected
checkout while Last Sessions stays open. Choosing a project from the rail returns
to its own conversation list. The
combined list does not make unrelated repositories share Git operations. The time
filter can narrow this window to Today; Clear restores Last 7 days. Remote rows
come from available history and show a coverage note rather than claiming a full
remote archive. Local pinning remains available; project-scoped archive/delete
operations stay in the project view.

The sessions filter menu can show only conversations managed by your named
assistant. It uses the Host's management record and combines with provider,
time, archive and status filters. Clear filters restores the full list.

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

A workspace group is identified by its Workspace icon and tooltip. Its linked
file, Git and lock controls appear with row interaction; Git change counts and
link warnings stay visible. Narrow rail layouts retain their compact presentation.

A single conversation shows one compact title row with its tabs and actions; a
pane gets its own header only when the workspace is split. On Windows and Linux
the menu button at the start of the title row opens the application menus, and
Alt or F10 still opens them from the keyboard. The Changes tab always shows how
many files changed; the added and removed line totals appear when the tab has
room, and its tooltip names both counts. Keyboard focus on a session row opens
a small detail card with the title, model, branch or worktree, path and status.
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

The notifications sheet lists pending requests and **Recent requests** (the last
100). A recent request opens its conversation when it is still available. Clearing
the list happens only after it is saved; if saving fails, the list stays and offers
Retry. Allow and Deny show their progress and any error on the request itself.

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
warning in each pane. Content that has never loaded remains unverified, not empty.
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
