# Workbench navigation

Readable labels stay quiet on hover. Tooltips explain icons, missing shortcuts
and additional context, or reveal the full text when a label is clipped. Narrow
panes that hide tab labels keep their icon explanations. Error reasons and
connection details remain available; accessible control names do not depend on
whether a tooltip is visible.

Conversation deletion keeps its confirmation and shows progress while work is
pending. Successful deletion clears the progress without an extra success banner.
Failures, skipped conversations and incomplete cleanup remain visible for review.

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
existing saved widths, layout and density settings. Detailed session rows show
the conversation title before model and status information.

The sessions filter menu can show only conversations managed by your named
assistant. It uses the Host's management record and combines with provider,
time, archive and status filters. Clear filters restores the full list.

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

The project menu groups remote machine reconnection and editing under Machine.
Recovery lists retain their open and clear actions, including local pending and
retry feedback. In compact navigation, open the recovery panel to use its full
list controls. Unsaved-file indicators remain visible independently of tab-close
controls.

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
