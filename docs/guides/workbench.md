# Workbench navigation

## Custom chat backgrounds

Settings > Appearance > Backgrounds > Chat background accepts local PNG, JPEG,
GIF and WebP images, muted looping MP4/WebM videos, and self-contained UTF-8 HTML
scenes with inline CSS and JavaScript. Image limit: 25 MiB; video: 100 MiB; HTML:
2 MiB. Media codec support follows the desktop WebView. Files stay on this
device. Project menu > Background selects an override; removing it restores the
global choice. Empty/all conversation scope and opacity still apply. Image effects
apply only to images. Workspace procedural artwork remains a separate setting.

Previously selected designs remain in the Backgrounds picker after changing or
removing the active selection. Failed imports and saves keep the last selection.
Imported assets have immutable paths and a bounded 400 MiB asset store; when full,
new imports fail without deleting previous designs. The image library remains
separate and supports the new media types with type labels instead of thumbnails.

Ask the ordinary conversation model to create a background scene or revise an
existing one. `visuals.background` reads the current global/project choice and
bounded HTML source chunks; the returned path fences revision changes. This also
works in a new conversation and for imported HTML. It keeps a workspace HTML file, previews it with `visuals.preview`
and shows the same revision with `visuals.render`. Ask explicitly to apply that
design globally or to the current project; `visuals.applyBackground` applies only
that source through the authenticated desktop relay. No separate AI screen or
video-generation provider is needed. A connected updated desktop is required;
offline/error replies do not prove an apply. Generated code stays self-contained:
no network assets, local file reads, Host/native APIs, credentials, forms, popups
or navigation. The renderer uses the existing HTML preview token lifecycle with
an opaque nested sandbox and no local asset root. It never enables canvas workers.
Video and HTML unmount in hidden panes and background windows. Under reduced motion
and in unfocused split panes they show a still frame; only the focused pane plays.
The base workspace artwork remains available if media cannot run. Unreferenced
imported assets are reclaimed after a while; saved, selected and history designs are kept.

Ask explicitly to **save** a design for later: `visuals.saveBackground` stores its
name, source/media and background preferences in the same **Saved designs** library
used by Appearance, without applying it or adding selection history. Preview titles
and `visuals.render` snapshots alone do not save reusable backgrounds. Read
`visuals.background` to list saved names; pass a returned `designId` to reopen its
source even while another background is selected. Preserve the returned `runtime`.
Edits send `designId` and `expectedUpdatedAt`; stale edits fail without replacing a
newer save. Explicit application retains an existing saved media name and saves new
media under its title. Saved designs remain available for portable export/import
from Appearance. These operations need the original live coding session and unlocked
project; expired, mismatched or revoked desktop authority is rejected.

The offline Three.js runtime exposes a bounded set of real Three.js r180 exports,
including `CircleGeometry`, `PointLight` and `Reflector`. Tool descriptions and
background status report the exact shipped list; unavailable addons/loaders must not
be guessed or fetched from a CDN. Generated scenes render once under reduced motion,
pause while hidden, cap pixel ratio/frame rate and dispose GPU resources on pagehide.

### Create, save and reuse a design

Use **Create background**, **Create scene** beside Live background, or **Create
motion preset** in Motion. Describe the result in a short prompt, choose the
provider/model, then **Create**. Images use the selected image provider; scenes
use the ordinary conversation model to write HTML/CSS/JavaScript. Motion presets
change existing motion settings. This does not synthesize video. Cancel or retry
keeps the prompt, previous preview and active design.

The creation sheet shows a real preview before **Apply**. Give it a name and
**Save** to keep it in **Saved designs**; saving does not apply it. Open a saved
design to revise its prompt or source, save changes or save a copy, and explicitly
apply to the app or project. Motion presets apply to the app. Current and saved
draft badges describe separate states. Unsaved source edits must update the
preview before saving or applying.

**Saved designs** supports rename, deliberate delete, and **Export**. Export writes
a `.bycoda-design.json` file containing the media, prompt and relevant preferences,
with no machine-specific asset path. **Import design** validates size, format,
media signature and checksum, then adds a named design without applying it. Keep
an export outside the application data folder to restore after reinstallation.
Missing media, unsupported codecs, failed writes and conflicting sibling edits
leave the usable selection intact. Named records share the existing saved-theme
store and protected media library; the recent-selection history is not their
storage. Deleting a design does not delete its imported media or active selection.

Ordinary Background settings also provide **Save background** beside the current
selection and on every unnamed Library tile. Enter a name there, without opening
the creation sheet. Named tiles show the name and media type; **Rename** edits the
same saved-design record without applying or generating anything. Global/project
history and current-selection captions use that same name, with a translated
media-type fallback for unnamed files instead of internal hash filenames. When
multiple saved variants share identical media, the oldest background design is
the stable Library name; the variants keep their own names in Saved designs.
Legacy non-hashed selections use bounded label aliases in that record. Aliases
are not file authority and are excluded from portable exports. A failed name save
keeps the published name and edited form value; conflicting sibling edits require
reopening the name form.

**Try mountain lake** opens an offline Three.js landscape with layered mountains,
pine forest and reflective water. Save it through the same named-design flow.
Its bundled MIT-licensed Three.js runtime needs no CDN. The example caps rendering
at 30 FPS and pixel ratio 1.5, limits reflection resolution, pauses when hidden,
renders a still frame for reduced motion, and disposes GPU resources on removal.
All generated/imported code retains the existing isolated, offline HTML sandbox.
In ordinary chat, `runtime: "three"` on visual tools supplies this same offline
runtime; background reads return the authored source and runtime for revisions.

## Application menu and tabs

The title-bar application menu keeps session creation, search, Inbox and Notes
in the main list. Tab closing, view and zoom controls, and terminal actions have
their own submenus. Use Settings > General for updates, the guide and the tour,
or Settings > Workspace for Autosave. Inbox opens with Ctrl+Shift+I (⌘⇧I on
Mac) and Notes with Ctrl+Shift+L (⌘⇧L on Mac). The menu shows the active
shortcuts from Settings > Keybindings.

Select a conversation tab above Inbox to open it. Use the title-bar Back button
to return to your Inbox selection and filters. The open conversation tabs follow
the workspace project. The project picker next to **Send to agent** sets the
agent's destination for the current item.

After an app update, open What's new from the expanded sidebar footer. Hover or
focus the icon to see the installed version, or use the close button at its upper corner to
dismiss the notice.

## Session machine

A compact **Run on** picker sits below the new-session composer, to the left of
the workspace controls. It shows the saved name of the machine that will run the session. Choose
**This computer** or a connected Host. Offline machines stay listed but cannot be
chosen. A draft keeps its choice across tab switches and restarts.

- **No project** defaults to **This computer**. Its first run uses a private scratch
  folder on the chosen machine. Local and remote conversations without a project both
  appear under **No project**; remote rows show their owner.
- A project draft defaults to the machine that hosts the project's checkout. Choosing
  another machine switches to that machine's copy of the same repository when the rail
  has one. The picker lists machines that already have the project first and offers the
  others as "Add to <machine>". That opens a dialog that clones the repository there over
  SSH or HTTPS into the folder you name, optionally copying chosen files git ignores
  (text files; folders git ignores whole are left out), or **Locate folder** picks a folder
  that machine already has without cloning. A project without a hosted remote goes
  straight to the folder picker. The destination's checkout, branch, workspace policy, provider
  and account apply.
- The picker is read-only after the first accepted send or Host draft save; the
  session stays on its owning machine.
- If the chosen machine is unreachable, the draft keeps its text, references and
  attachments. Retry, or choose another machine when that is safe. A file that belongs
  to another machine blocks sending until you remove it or switch back.
- If a Host cannot start a session without a project, the picker explains that it must
  be updated before it can be used for **No project** sessions.
- Changing the machine while a request is uncertain does not move that request. It
  stays on its original machine and uses the existing reconciliation path.

Cancelling a folder choice keeps the current draft and view.

## Conversation history

Long conversations open at their recent messages. Scroll toward the top of the
conversation to load earlier messages. The message you were reading stays in place.

## Transient notifications

Information, success and progress notices appear at the top right. Warnings and
errors appear at the top center. Notices normally disappear after ten seconds of
focused window time; hovering or focusing them pauses the timer. Requests that need
an owner decision retain their existing actions and placement.

Open the bell next to Settings at the bottom of the left sidebar to revisit dismissed or
expired notices. When the sidebar is hidden, the bell moves to the left end of the
workspace footer. This device keeps the latest 100 entries across restarts. The log
keeps plain-text summaries, not interactive controls or secret inputs. Provider
update notices include the offered versions; closing a notice leaves an update
running. Completion or failure appears separately and enters the same log. Open
Settings > Providers to inspect progress or retry an update.

Closing the active conversation tab selects a neighboring tab in the same project
and worktree. Closing a background tab keeps the current selection.
Closing the last conversation tab in the current project keeps a blank conversation
in that project. Hidden tabs from other projects are not selected, including when
the closing tab has no project of its own and uses the project on screen.

Remote workspace headers show the project's saved name and icon, like local projects.
The machine icon beside the name shows the owning machine and data freshness on hover
or keyboard focus. Click it to refresh conversations. Loading and connection failures
keep their existing feedback; a healthy remote project has no success checkmark.

The workspace footer uses one compact spacing rhythm for conversation tools,
terminal, navigation, sound, view refresh and fullscreen.
Click a provider's quota summary to open its usage panel. Where the panel lists
accounts, browsing them leaves the conversation's selected account in place.
**Refresh usage** reloads the displayed provider and account. **Refresh current
view** is in the workspace controls.
If a quota refresh fails and a saved reading exists, the panel shows that reading
and its age.
Claude and Codex show available credits under the banked-reset icon. Each credit
shows its expiry next to **Use reset**. Select **Confirm** to spend that credit.

Tools navigation omits the standalone Terminal tab and picker option, including
the combined tools window. Open project terminals from the workspace terminal actions.
Conversation tools hides the session sidebar while open. Returning to conversations
restores the existing sidebar preference.

Settings search opens the matching page and focuses an available control. When a
setting is unavailable, search focuses its row so its label and disabled reason
remain accessible. Restore default stays disabled while its row is unavailable
or waiting for an operation; the current custom value is kept.
Search Phone or Sharing to open those Connections tabs; automatic reconnect
continues to open its Machines setting.

A setting that differs from its default shows a Restore default icon beside its
title; the icon disappears once the default is back. Rows without a meaningful
default have no icon: accounts and credentials, lists such as machines, profiles
or skills, chosen folders and devices, permission and data-sharing consent, network
exposure, agent access and protection settings whose default is less strict
(Start in privacy mode, Lock when idle, local-only personal data). New installs
follow the system light or dark mode and prevent idle sleep while agents work.

Pages with a reset action show it in the Settings toolbar and ask for confirmation.
General's Restore defaults restores Application language to System and the independent
Git and Technical languages to English. If a reset step fails, completed steps remain
applied and the confirmation offers retry. Folder rows refresh after a successful reset;
their path can be read in full by hovering or focusing clipped text. Choosing a folder
shows pending feedback and accepts one picker at a time.

Folder picker rows open folders on click without hover tooltips. Scrolling under
the pointer keeps the keyboard target unchanged; arrow keys move that target and
keep it visible. Enter opens it, and checkboxes select folders independently.

Application operation approvals mark their conversation as needing approval in
session lists and as waiting for input beside the composer. Inbox cards show
the operation and its target. Open **Details** to read the preview in place or
choose **Review** to open the approval in a dialog. **Exact request text** shows
the full request. If you are on another page, the dialog opens there with
**Cancel** and **Approve** in its footer. Waiting ends when the last pending
approval is answered, expires or is revoked.

Title-bar project and conversation actions stay icon-only on hover and focus.
Their tooltips show command names and configured shortcuts, with project details where available.
Window caption controls, including Close, use the same neutral tone.

Startup recovery shows a short failure title, Reload app and expandable error details.
Native file pickers use the application language for their titles; system controls
keep the OS language. Tray status labels stay compact inside their existing groups.

Transient toast messages, including errors, close automatically after ten seconds
while the Bycoda window is focused. Switching away or hiding the window pauses the
countdown; returning resumes the remaining time. Hovering over a toast or focusing
its controls also pauses it. Notices explicitly kept open for an action remain until
their owner dismisses them; closing a notification never answers an approval request.

Toasts in a corner form one stack: the newest sits in front and up to three show at once,
with older ones tucked behind it. Moving the pointer over the stack, or moving keyboard
focus into it, fans the stack out into a list and holds every countdown until you leave.
A toast waiting behind the visible three keeps its countdown and returns as the ones in
front close. Reminder and
approval cards stay fully visible beside the stack.

Press Ctrl+Shift+J (⌘⇧J on macOS) to move keyboard focus to a pending request popup,
also while a dialog is open; press it again to reach the next popup. Focus lands on the
card's conversation button, so nothing is allowed or denied until you press **Allow** or
**Deny** yourself. Tab moves through the popup controls, Escape returns focus to where you
were without closing the dialog, and Tab past the last control returns to the dialog. The
shortcut can be changed in **Settings > Keybindings** (App: Focus Approval Requests).

Dragging the project rail much narrower than its minimum width switches to the compact rail when the compact rail is enabled; reopening the full rail restores its previous width.
The compact rail keeps its width and uses standard-sized navigation targets and icons.
The footer places the voice companion first, followed by GitHub and available updates,
then Settings and Account. Development builds place a small blue wrench in this
same action group, horizontally in the expanded footer and vertically in the compact
rail. Hover it for the Development build label; production builds omit it.
Hover or focus the GitHub star to reveal its upper-right dismiss button. It stays
transparent on hover and press, with a focus ring for keyboard navigation.
Dismissal applies to both compact and expanded footers for the current version.
The docked voice companion and GitHub icon have transparent idle backgrounds like Settings
and Account; the floating voice companion keeps its raised surface.
In an expanded footer with enough room, hovering or focusing the update icon reveals
its label. Click it to compare your installed version with the available version
and read the release notes. Scroll the notes to read each section while the update
actions stay visible. Use the download button to start the update or choose
**Remind me tomorrow** to see the prompt later.

**Ctrl+B** on Windows and Linux or **Command+B** on macOS cycles through three layouts.
With both panes open, the first press collapses the project list while keeping the
Sessions, Explorer, or Changes pane fixed on the left. The next press closes that pane
for conversation focus. Press again to restore both panes. Collapsed project navigation
uses the compact icon rail when enabled. **Ctrl+Shift+B** or **Command+Shift+B** still
toggles the session sidebar independently.

Collapsed project navigation uses a 56px icon rail with a centered divider.
Expanded sections share label and count columns; Last
sessions keeps separate collapse and open actions. The workspace header emphasizes
the current location, including **No project** for projectless conversations,
and holds only the conversation tools, aligned to the right,
and the **New session** control on the right, with a label when the workspace
pane is wide and an icon when space is limited. Click the main button to start in
the current project or in **No project**. Click its joined arrow and select
**Choose project**, or right-click the main button to open the project picker
directly. Choosing another project opens its **Sessions** list with the new
conversation selected. The separate **More actions** menu contains conversation
search, selection and filters in **No project** and in narrow panes. Crews, Servers, Notes,
Automations, Social Media, Tasks and Room appear directly as stacked rail icons.
Hover or focus an icon for its name and shortcut. The rail scrolls in short windows
while Account and Settings remain at the bottom. A **Recovered work** icon appears
beside Settings when there is work to review or a recovery error to retry. Its
badge shows the number of items to review. Rail section headings share one icon and label grid;
hover or keyboard focus replaces a collapsible section's icon with its disclosure arrow.
Pinned also collapses and remembers that choice.
Library Sync keeps linked workspace headers under their parent groups on paired desktops.
Projects from another machine stay in their groups while waiting for that machine to connect.
Checkouts of one repository on different machines share one project row. Repositories match
by their `origin` remote, read on each machine once it is connected; two clones on the same
machine stay separate rows. The row is this computer's checkout when there is one, and shows
the other machine while that copy is open. Removing or archiving the row affects only the
copy it shows; the other machine's copy then takes the row. The project menu's "Show machines
separately" gives every copy its own row, and "Combine with other machines" folds them again.
Once the remote workspace is available, its header opens the workspace on its owning machine.
Activity sits below the project list and starts collapsed. Its header shows activity counts.
Expanding it leaves the project list scrollable. Last sessions rows in the rail open
conversations. The combined list has its own row actions.
Crew Start stays at the right edge, with options to its left.
Project Git totals occupy the right edge until hover or focus reveals options; opening
those options keeps the Git summary in the menu. Narrow group and workspace rows keep secondary
shortcuts in that menu: **Changes** opens the existing Git overview, and **Lock group**
retains the same lock action. Appearance exposes background controls
directly below the compact icon picker.

In Settings > Appearance > Interface > Chat messages, set the background opacity
of your messages and AI replies independently. Zero leaves the text on the chat
canvas. Both use the selected theme color or a neutral tone. The preview updates
as you move a slider.

In Settings > Appearance > Background > Image, the Library keeps previously used
images. A failed library read shows Retry instead of an empty library; any loaded
images remain visible. Image apply and delete controls wait while a background
change is pending. Saved-look name dialogs retain the name after a failed save,
and Enter confirms only after text composition finishes.
Saving a look while an image is generating captures the current applied appearance;
the name dialog explains that the pending image is excluded. Applying a saved look,
choosing or removing an image, and restoring Appearance defaults revoke older
generator image application without deleting its reusable library result.
Manual gradient edits also take precedence over an earlier gradient generation
request. A superseded image copy cannot replace the current background.

GitHub Inbox discovers repositories from local remembered projects. Its **Local
repositories** filter shows each `owner/repo` once, even when several checkouts
point to it. Forks and upstream repositories remain separate. Remote-machine
projects are not scanned by local GitHub commands. Saved checkout filters still
apply to their repository; clearing a selection also clears its old checkout aliases.
Non-Git folders and folders without remotes do not block loading. Operational
failures keep Retry and expandable details while available items remain visible.

To link a conversation to a GitHub item, right-click its sidebar row and choose
**Link GitHub issue or PR**. Search the conversation's repository by title or
number and select a result, or paste a full GitHub URL. Choose **Link** to save.

Searchable filters inside the Inbox filter menu open beside it. They prefer the
right edge and flip left when space is limited; constrained windows keep the
choices within the viewport. Escape closes the inner picker first.

The conversation follows the latest reply until you scroll up or navigate to an
earlier message. **Jump to latest** appears above the composer when you scroll up.
Click it, or focus it and press Enter or Space, to return to the end and resume
following new messages.
**Load newer messages** appears when there are newer turns outside the open page
that are still hidden. It loads the next page of conversation history.
With **Anchor prompts to top** enabled, the active prompt stays at the top while
the assistant works. When the turn finishes, the conversation ends at the latest
reply.

On Windows and Linux, scrollbar thumbs appear when you hover over or focus a
scrolling area. Touch-only devices and high-contrast mode keep them visible.
Appearance offers Extra thin (3px), Thin (6px), Medium (10px), Large (14px) and
XLarge (18px) scrollbar sizes. Existing Wide preferences retain their 14px width as
Large. macOS native scrollbars follow the system preference. The editor's custom thumb
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

Context-menu rows show a fill and inset border on hover. Keyboard focus uses the
selected fill and focus ring; an open submenu keeps its parent row marked.

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

Activity lists sessions by turn start time, newest first when known. Each row has
a status badge, and the header shows a count for each status.
Select a row to open its conversation or bring its existing window forward.
Unseen completions and sessions with a failed turn also appear in Activity.
Conversation history retains the results, and the Settled shelf shows conversations
that have been settled. A conversation whose own subagents
or background commands still run counts as running and shows **Working**; its tooltip
names what runs ("Subagents running: 4"). Conversations waiting only on delegated
tasks or a pull request watch show **Waiting**, keep their own group and do not count
as running. Last Sessions keeps the complete list.

Above the composer, **Background work** shows a labeled count for each status.
Open it to see subagents and commands. Scroll the notice area to reach every row
when the list is long. Subagent rows show the title first, the
reported model and provider below it, and step counts and elapsed time beside the
opening chevron. Animated bars mark running work, a green check marks completed
work, a red cross marks failure, and warning icons distinguish stopped and
interrupted runs. Select a row to inspect the run. When available, the action
to stop all work appears above the expanded list. **Stop all** stays quiet until pressed; the first press asks for confirmation in the danger color. Its tooltip explains whether it stops
background work only or interrupts the whole turn. Missing child-model metadata
stays unspecified.

The **Session subagents** button by the composer also opens past runs. Each row
shows the run title, a status icon, the reported model with its provider icon,
and the elapsed time when available. Hover over a row to read the full title and
status. Select a row to open the run.

Tooltip content is chosen by each control: readable labels stay quiet on hover,
while hints explain icons, missing shortcuts and additional context. Overflow
hints reveal full text when a label is clipped or hidden; narrow panes keep their
icon explanations. Explicit tooltip content is shown as supplied. Error reasons
and connection details remain available; accessible control names do not depend
on whether a tooltip is visible. Hover or Tab to an info icon to read a short
explanation. Open the details button when the information needs its own panel.

Project and conversation rows use the same detail card layout. Project cards show
the folder path, the machine for remote projects, and relevant status badges.

Conversation deletion keeps its confirmation and shows progress while work is
pending. Sidebar bulk deletion uses one compact row: a red spinner, clipped conversation
title, completed/total count and red trash icon. Completion replaces progress in the
same row, using the normal text color. Successful feedback closes
after ten seconds; its close button dismisses it immediately.
Failures, skipped conversations and incomplete cleanup remain visible for review.

While a queued message is being delivered, its queue header shows a compact progress indicator. A brief check means the provider accepted it; follow the conversation for execution and completion. Unconfirmed or rejected deliveries retain their explanation and recovery actions.

Shift+Tab adds the message to the active queue; it does not switch the composer
into a queue mode. The queue sends it when the conversation is free, including
when the previous turn finishes during submission or a provider handoff completes.
When only background commands (such as a dev server) keep the turn open, the queue
does not wait for them: it hands its next message to the running turn as a Steer,
whichever computer queued it. A message for another model, a plan, an orchestration
or a slash command still waits for its own turn.
An explicit Queue action retains that choice through preparation. Providers without
safe mid-turn delivery offer Queue while busy instead of Steer. Claude takes a
Steer at its next tool step, or right after the current reply; the turn stays open
until that message has run. An older Claude Code that cannot report message
progress keeps the Steer queued instead.
Each queued message keeps the provider and model it was queued with, so one queue
can mix providers; rows run in order and the queue switches provider between them
on its own. A row for the conversation's provider runs on the account the
conversation uses now, so switching accounts after a usage limit carries the
queue with it; a row that switches provider starts on the account it was queued
with. Steer with a different provider than the running turn
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

For a verified Claude workspace filename search on the Host, choose **Always allow
this session** to allow later searches of the same kind in that conversation.
Open **More actions > Session approvals** to see or revoke the grant. Grants
survive turns in the same conversation and expire when it is cleared, archived,
or deleted, when its execution settings change, or when the Host restarts.
Shell commands, file changes, credential access and native subagent requests
continue through the existing approval rules.

Saved local conversations support [session links and Markdown references](local-session-references.md),
including compact details and opening a cited conversation beside the current one.

Use the project rail to choose a project or workspace, the sessions list to
choose a conversation, and the top tabs to switch open work. These keep their
existing saved widths, layout and density settings. Standard and detailed session
rows show project identity above the conversation title. Within one project,
rows keep neutral backgrounds while showing the saved project mark. Pin, Settle,
Archive and Delete appear in the project header on hover or keyboard focus. Pin replaces
the project mark beside its name; pinned rows keep the pin visible. Settle, Archive
and Delete take the place of the idle timestamp. Touch keeps the actions available.
Status stays at the upper right; hover or keyboard focus hides its word while
keeping its icon and Working elapsed time. Plain branch text and larger
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

On Windows, **Close window**, **Alt+F4**, and the taskbar's close action close
the selected windows after the usual save and confirmation checks. Use
**File > Minimize to tray** to keep one workspace running in the background. To
make the Minimize button do the same, enable **Minimize to tray** under
**Settings > General > Application behavior**. The button minimizes to the
taskbar by default.

Left-click the Bycoda tray icon to reopen the most recently hidden workspace.
The tray tooltip shows **Working**, **Failed**, and **Needs input** counts.
Automatic retries count as working.
Right-click and choose **Hidden windows** to open or close a specific one.
Use **File > Quit** or **Quit Bycoda** in the tray to close the whole app,
including hidden windows.

When the WebView2 browser process exits on Windows, Bycoda tries to restore the
interface in the existing windows. Local Host, terminal, and agent processes
stay running during this recovery. If the interface cannot be restored, Bycoda
asks before restarting when it detects work that the restart would interrupt.

Reload asks for confirmation when this window has running local conversations or
unsaved file changes. It interrupts this window's local conversations; work on a
remote Host and work in other windows continue. Cancelling keeps the window open.
When quitting the app, file and terminal close dialogs remain open until answered.
Time spent answering those dialogs does not consume the timeout for saving the
workspace. A failed save keeps the app open and reports the failure.

Opening a conversation already held by another window focuses that window.
The sidebar shows **Opening…** when a selection takes longer than half a second.
When available, the last saved page of a local Host conversation can appear while
the Host confirms the transcript. You can keep typing a draft during this check.
Local conversations and remote Host conversations keep one window owner, including
idle tabs. If the owner cannot be verified, opening stops with an error so you can
retry. Moving tabs keeps the source until the destination confirms receipt;
running local turns wait until they finish before moving.

The primary window restores the saved workspace. If the active tab is unavailable,
it opens another tab in the saved project when possible. Otherwise it starts a blank
conversation under **No project**. Additional windows start blank unless they receive
an explicit tab transfer. Each window records its own running
conversations for recovery without replacing another window's records. A local
conversation enters recovery only after its original process has stopped; unknown
process state stays protected.

Detached tool windows, including **All tools in one window**, wait for session
owner storage before displaying their tools. They do not restore the main window's
tabs or consume its recovery state. If storage cannot load, the startup retry
screen remains available.

Click **Last sessions** in the project rail to open a combined workspace list. It
shows, by default, the project groups' conversations active during the last seven days,
newest first, with each project's saved icon, color and background. The time filter
widens this to 30 days or all time. Each project header shows its full count; an open
group loads its conversations page by page as you scroll to its end, so many projects and
long histories stay fast. The list follows changes made in other windows within seconds. Pinned conversations
come first whatever their age, then one folding group per project, then **No project**,
then the **Settled** shelf at the end with every settled conversation. Settling a conversation moves it to the shelf instead of
hiding it; a pinned conversation stays in **Pinned**. Pins and settle state are the same
ones each project's own list shows, and the shelf opens or closes for both. The sliders
menu groups conversations by project (the default) or state, or lists them flat, and
sorts by newest or oldest activity; the choice and folded groups are remembered.
Right-click a conversation to pin or rename it, including a conversation without a project,
regenerate its title, copy identifiers, link a GitHub issue or PR, or schedule a
reminder for a locally saved conversation. **Select** starts multi-selection across
projects while keeping the current conversation open. A refresh keeps the previous
complete list visible until the new history has loaded; an error leaves that list
available while retrying.
Explorer and Changes follow that conversation's real project and
execution worktree. **New session** in Last sessions asks which project should own the
new conversation. Search or choose a project, including the current one. Cancelling
creates nothing. The new conversation uses the chosen project's defaults and selected
checkout. Choosing the current project keeps Last sessions open. Choosing another
project opens its **Sessions** list. Choose **No project** to start a conversation
without a project. Bycoda gives it its own working directory under
`~/.bycoda-host/scratch` when it first runs. The files stay on disk when the
conversation is deleted. Choose **No project** next to **Last sessions** to browse these
conversations or start another one. Older projectless conversations keep the folder
configured under **Settings → General**. Choosing a project from the rail returns
to its own conversation list. The
combined list does not make unrelated repositories share Git operations. The time
filter can also narrow this window to Today. Clear restores Last 7 days. The list uses
current remote project results when available and shows a coverage note when a
remote project cannot supply current results. Right-click a row or press
**Shift+F10** to open its actions. **Archive** and **Delete** use the conversation's
owning project, including on a connected remote machine. **Settle** uses the
session's owning Host. Open the **Settled** filter to find those sessions and
bring them back with **Un-settle**. Use the project view to pin conversations or
act on several at once.

In **Settings > Archive**, project archive and restore keep the source entry until
the destination is saved. Storage errors leave the project reachable for retry;
failed deletion also retains an archived target. Restore and Delete recheck the
stored target and group lock immediately before acting. While a conversation is
being restored, this workspace blocks another archive, restore or delete for it.

The sessions filter menu can show only conversations managed by your named
assistant. It uses the Host's management record for local and remote projects and
combines with provider, time, archive and status filters. Clear filters restores the full list.

**Settle** (the check mark in a conversation's header, or on its sidebar row
when you hover it) uses the owning Host for both local and connected remote
projects. It moves a finished conversation to the collapsed **Settled**
group at the end of the project's list. The **Settled** filter lists only
settled conversations. It does not lock anything: the conversation stays writable, and its next
message moves it back to the active list. Settling while a turn runs waits for
the turn; a failed turn or a queued message leaves it active. **Un-settle**
brings it back and keeps it out of automatic settling until its next message.
Settle stays disabled in a new conversation until it has a submitted message; unsent drafts do not enable it.
In a project list, select several conversations and choose **Settle** from the
right-click menu or the check mark on a selected row. The same action works in
local and connected remote projects. It leaves already settled conversations in place.
Pin, Unpin, Settle and Un-settle update the list immediately. If the Host rejects a change, the list returns to its confirmed state and shows the error.
Conversations idle for three days settle on their own; change or turn this off
in Settings → Session list → **Auto-settle after**. Pinned, archived, running and
waiting conversations never settle automatically, and pinned, foldered or
reminder conversations stay where you placed them. Settling applies to
conversations on their owning Host. Archive and tasks are separate actions.

To keep the shelf short, Settings → Session list → **Archive settled after**
archives conversations that stayed settled for 7, 14, 30 or 90 days. It is off
by default; pinned, running and waiting conversations stay, and archived ones
can be restored from Archive. The **Settled** group's menu (right-click its
header or use its more button) offers **Archive all** and **Delete all** for the
conversations listed in it. Delete all asks for confirmation and cannot be
undone; nothing is deleted automatically.

The Workspace picker uses available header space for the project and branch names,
shortening them only when adjacent controls need the room. Conversation search opens in the
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

In **Move to group**, clicking the checked group again removes the project or workspace from that group.
Only ungrouped projects can be pinned. Groups and linked workspaces have no pin action. Projects inside a group cannot be pinned on their own,
and a project's earlier pin is dropped when it joins a group. Group members are
indented under the header on a guide line.

One title bar runs across the top of every main window, in the same order on
macOS, Windows and Linux: the bycoda mark, the sidebar toggle, Back, Forward,
Search, then the open tabs. The macOS window buttons sit before the mark.
Windows and Linux place the window buttons at the right end of the bar. The bycoda
wordmark shows beside the mark while the project rail is expanded. Search shrinks
to its icon in a narrow window. The project rail and the sidebars below the bar
hold no window controls, history buttons or Search of their own.

A single conversation shows its tabs and actions in that title bar; a
pane gets its own header only when the workspace is split. On Windows and Linux
the bycoda mark at the start of the title bar opens the application menus, and
Alt or F10 still opens them from the keyboard: the menu bar takes focus, Left and
Right move between menus, Down opens one, and Escape hides the bar and returns
focus to where you were. The Changes tab always shows how
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
turns, reminders, background work, assistant messages and account notices.
Successful subagent runs appear in the conversation's activity without a desktop
banner, completion sound or entry in **Recent**. Each notification history
row has a prominent title, a quieter two-line preview and a plain status icon.
For stale remote data, the expanded message includes the data name, the last
verification time when available, and the sanitized failure reason if one was reported.
The project, event label and relative time sit below the preview. Expand a row
to read its full title and message, inspect its path, open its destination or
remove it. Status icons use semantic colors: failed turns use red, finished turns
green, questions/approvals/reminders amber, assistant messages the accent color,
background work blue and account notices a neutral tone. An event is logged when its notification
setting allows it, even if no desktop banner was shown because bycoda was in the
foreground or banners are off; a muted project is not logged, and a locked group
is logged without its text. A pending approval is decided in place with Allow or
Deny, which show their progress and any error on the request itself; a pending
question opens its conversation with **Answer**. The expanded row's **Open** action
opens its conversation, or for background work, assistant and account notices,
the view they belong to. If that conversation no longer exists, the row says so
and the sheet stays open. Unanswered requests stay in the pending section.
Application approvals and secret requests that wait for you are listed there too,
with their title and the time left, and count toward the bell badge; click one to
open the conversation that answers it, or the shared confirmation when it has
none. Their message and any secret you type are never shown or stored. When one is
answered, denied or expires, the log records its title and outcome once.
Each recent row can be removed on its own. **Clear all** in the header asks for
confirmation before removing history. Removing and clearing happen only after the change is saved; if
saving fails, the list stays and says so.

Desktop banners appear only while bycoda is in the background. While any bycoda
window is focused, conversation updates, pending requests and reminders remain
inside the app, including updates from other conversations. Returning to bycoda
before a queued banner is sent cancels that banner; it is not replayed when you
leave. Sound preferences and in-app attention indicators remain independent.

Queued conversation banners recheck desktop alerts, event choices and project mute before
delivery. Turning those off cancels affected queued banners; resuming does not replay
them. Locking a project before delivery removes its project and conversation text,
including when several banners are combined.

Use **Sounds** in the bottom-right workspace controls to toggle application sounds,
including notification cues. The icon shows when sounds are muted. This shares
the saved **Settings > Notifications > Sounds** preference; desktop banners and
request popups keep their own settings. If saving fails, the previous state stays
active and the error offers **Retry**.

In **Settings > Notifications**, delivery time names the first setting to enable:
**Desktop notifications**, then **Daily summary**. Turning either off preserves
the saved time and event choices. If project notification preferences cannot be
read, category, mute and resume changes pause until the read succeeds. An open
custom mute form keeps its date and time draft through that pause.
Changing the selected projects closes an open mute menu or custom date form, so a
date chosen for one selection cannot mute a different selection.

In **Settings > Keybindings**, click a binding to record keys. Tab and Shift+Tab
cancel capture and move focus in their usual direction. Escape cancels capture;
switching away from the window also cancels it. Conflicts keep the previous
binding. Reset restores the default; Delete or Backspace alone disables a binding.
Save and conflict feedback appears beside the affected row, with the recorder
and Reset available for recovery once saving finishes.

Text-composition and repeated key events do not record shortcuts; composition also
does not run app commands. Shortcut conflicts ignore modifier order. If saved
bindings cannot be read, saving stops without replacing them. Clearing overrides
in another window refreshes shortcut labels and native shortcut synchronization.

The project menu groups remote machine reconnection and editing under Machine.
Recovery lists retain their open and clear actions, including local pending and
retry feedback. In compact navigation, open the recovery panel to use its full
list controls. Unsaved-file indicators remain visible independently of tab-close
controls.

Alerts, warnings and information appear in one place: a stack at the top centre
of the window, under the title bar. Remote workspace panels share one connection
notice per machine there. When automatic reconnection is enabled, short network
interruptions retry quietly while loaded conversations, files and Git data remain
available. A longer interruption shows the shared recovery controls in that notice;
panes, rows and fields do not repeat the same connection error or their own retry
while it is shown. Dismiss a transient outage notice for its current episode; it returns if the machine recovers and later disconnects again. Dismissal changes presentation only. Content that has never loaded remains unverified, not empty.
Authentication, identity and compatibility problems appear immediately; turning
automatic reconnection off also makes the recovery control available immediately.
Independent service, storage and operation errors retain their own feedback and
retry controls. Notification timing does not change sending permissions or replay
messages and commands.

When the owning Host reports that an open conversation was deleted, bycoda shows an
informational notice and disables sending in that conversation.

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

The context meter stays available while the provider's reading is pending or
unavailable. It shows the reported token count as soon as it arrives and adds a
percentage when the model's context limit is known.

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

## Notes

In Session Notes, click the title in the top bar to rename the note. A new note opens
with focus in its writing area, and tags are visible under the title. Session Notes
saves automatically. Use Save in the bottom bar or Ctrl/Cmd+S to save immediately.
Closing the panel flushes pending changes; reopening resumes the
last note and preserves a failed draft. Private edits that still need review appear in
a compact Review changes notice with Open note, Copy exact text and expandable recovery text.
The library keeps its keyboard Save command and shows failures and recovery messages.

Use the plus beside tags to assign an existing library tag or a ready-made tag. Type
and press Enter for a custom tag. The library shows tag shortcuts beneath search;
click a selected tag again, or All tags, to clear that filter. Filtering keeps the
current note and its draft open.

If a newer note version arrives during a body read, Notes refreshes that body
before treating it as current. A failed refresh remains retryable. Saving a
recovery copy from Session Notes selects the copy when no newer edits are pending;
otherwise the current draft stays open. If text changes while an image loads, the
image is appended at the end so the earlier selection cannot replace new text.

Document is the default editable view: click a paragraph to edit, then Read document
to return to reading. All formatting commands appear directly in the toolbar while
editing, including strikethrough, numbered list, quote, code block, table and divider.
The toolbar wraps in narrow panes. Source and Split remain available for exact Markdown work.

Add to chat prepares context in the note's project. Its adjacent menu selects another
project without moving or relinking the note. The message remains unsent.

## Models and providers

**Settings > Models** has three tabs: **Background work** (Who uses what, All models,
Groups and Work limits), **Defaults** (chat and subagent defaults) and **Providers** (provider list and
detail, with CLI versions in each header). Decision models have their own page. The Grok account row
reports the local Grok Build CLI sign-in. See [Models](models.md) for selection,
inheritance and running-session behavior.

### Adding project actions

Save action keeps the Add action dialog open and clears the form for another action.
Saved actions appear in the dialog and the Project actions menu. Detected scripts
stay in place and become disabled with a check mark once their command is saved.
Close dismisses the dialog; saving edits or deleting an action closes it.

### Development server controls

The start form places server name, command, working directory and expected port
side by side when space allows. Set the port in the command as well. No flags
are added automatically. Preview, browser, copy, process details, stop and restart
share one toolbar. Process controls retain their confirmation and identity checks.
The details footer groups confirmation and log actions together.
