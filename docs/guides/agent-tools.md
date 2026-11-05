# Working with bycoda tools

## Capability status

Computer use, voice, devices, providers, skills and MCP keep three observations
separate: owner permission, verified readiness and current activity. Enabled does
not imply ready or running. Unknown means that the current read cannot prove the
fact, including after a failed refresh. Inventory, installation and saved sign-in
alone are not runtime verification. Opening settings or the device panel never
enables a capability or starts its helper; use the explicit setup, start or refresh
action when needed. Device control leases remain separate from saved permission.

## Devices

An installed Device Host starts only after **Connect devices**. Opening the panel
reads its status. Failed status or discovery refreshes invalidate the previous
readiness and activity observation; retained device drafts and frames stay intact.

Devices opens in view-only mode. Claim control explicitly before sending input;
release it when finished. Another controller's claim, an expired lease or an older
Host without control ownership support prevents input. Switching conversations or
computers does not transfer control. App and text drafts remain with their device.

Inspect device screen captures a fresh native accessibility tree and screen frame.
Hover or select an element to review its label and bounds; selection sends no
device input. Use Press selected node to activate it. A changed tree invalidates
that selection. Tree and screenshot capture is sequential; moving UI can differ
between them. Preview bounds appear only when device coordinates match the image;
unsupported coordinate scaling retains the searchable list.

Android supports pointer gestures, arrow-key swipes on the focused preview and
coordinate controls. Windows Android text input supports printable ASCII with the
displayed platform restrictions; unsupported text stays in its input for editing
or entry on the device. A failed capture retains the last frame and identifies it
as stale. Refresh successfully before sending more input.

Marking freezes the exact captured frame. Notes and marks remain tied to that
device and conversation. If adding the screenshot has an unknown result, use
Check attachment to reconcile the original receipt before retrying or discarding.
An uncertain transfer never silently attaches another copy; an edited draft stays
available while the original result is checked.

## Conversation tools

The assistant can search bycoda's tools by purpose and inspect the full contract
only for the tools it needs. Existing tool names remain available. Finding a tool
does not mean its machine, device or provider is connected or ready.

For schema reads with `tools.describe`, omit `maxChars` to use the default
10000-character chunk, or supply an integer from 256 to 12000. Follow `nextCursor`
until it is null. Invalid numeric arguments identify the field and allowed bounds;
correct that argument before retrying the read.

When you ask for a web application to be checked in the browser, the assistant
uses the integrated preview first when available. The preview opens in the
originating conversation's Browser panel by default. A responsive check can resize
the browser viewport; this does not simulate a physical phone.

The assistant reports page verification and panel visibility separately. If the
desktop is unavailable, it may verify the page without claiming that you saw it.
Another conversation's browser control is never taken over automatically.

Tool panels belong to their conversation. Switching conversations shows that
conversation's tools. A conversation without open tools does not inherit another
browser. Returning restores the selected tool, computer and drafts. Hidden panels
pause preview polling without stopping the underlying server or device.

The separate Conversation tools window follows the active conversation by default,
including selection from the main session list. Its project and conversation
selector opens other tool conversations; hover or keyboard focus shows details.
Use the link/pin control to follow the main window or keep one conversation visible.
Return to conversation moves the view back after its destination is ready. Closing
the tools window does not close the browser or discard the original conversation.

The eye icon means view only; the cursor icon means control is active. Open this
control for explicit take/release actions. Changing the displayed conversation never
grants browser control. During refresh the last valid frame remains visible; a
connection failure does not imply that frame is current. Direct pointer, wheel and
keyboard input requires active control.
After an uncertain input or failed frame read, refresh successfully before sending
more input. Refresh reads the page; it does not replay the previous action.

Element selection highlights the target and its box model, with a compact label.
Navigate to its parent, child, siblings or an ancestor without activating page
buttons or links. Supported flex/grid containers show their child outlines;
transformed or unsupported layouts show their limitation instead of precise guides.
Review captured selections and comments before adding them to their originating
conversation. Capture metadata is page content, not instructions or authorization.

Moving between the conversation and tools window preserves tool drafts, including
device annotations, log filters and unfinished server commands. An oversized or
unacknowledged transfer keeps the original workspace available with recovery.
Window movement never transfers control permission or starts a server command.

Background work does not need to open panels. A created task is not necessarily
running; a completed task may still need review; a saved schedule has not yet run.
The assistant should state the observed stage and any remaining blocker.

Approval rules are unchanged. Drafts do not authorize sending, tool discovery does
not enable disabled skills, and a timeout does not authorize repeating a mutation.
For uncertain operations the assistant checks the original result before retrying.

Application management tools can review sessions, workspaces, sprints, project
organization, Git changes, preferences and provider state. Read the target first;
mutation tools retain a request ID and show the exact operation in native owner
review. Changing the input requires a new review. A lost reply is reconciled with
the same request ID; it never authorizes another effect.

`sessions.list` supports state filtering and cursor pagination. Other collection
tools expose bounded pages. Use the returned cursor or offset and retain coverage
and truncation markers. `events.subscribe` waits for committed project changes
within a bounded interval; it is not durable replay or an external notification
subscription. Provider configuration does not establish authentication or quota.

Global voice can manage tasks, goals and automations with a real assistant-thread
identity and explicit execution settings. Starting work still needs its existing
review; creating a goal does not approve its plan. Desktop preferences, provider
management and project organization need a focused desktop session. Git mutations
recheck reviewed status inside the checkout lock. Publishing, credentials, pairing,
destructive recovery and operations absent from the catalog retain their owner
workflows. See [Voice companion](voice.md#global-voice-management) for controls.

Saved Servers can be edited through `servers.*`. To run a command, ask the
assistant to use `servers.ssh.execute` with the saved server's ID. The connected
desktop asks you to approve the exact target and command before starting it.
Execution uses the saved SSH settings, separate from any terminal you opened
yourself. Existing SSH tabs stay private.

The assistant reads command output and exit status with `servers.ssh.status`.
Starting is not success. `servers.ssh.cancel` stops local SSH; the remote command
may still be running. A timeout or lost reply must be checked with the original
request ID before another command is considered. Results are held in memory;
after a desktop restart, verify remote state before rerunning anything. Host keys
and key/agent authentication must already work without an interactive prompt.
This command route cannot approve proxy credential use.
Commands use the saved remote shell setting (POSIX by default, PowerShell when
configured). Timeout defaults to 60 seconds and can be set up to 300 seconds.


## Terminal log capture

Terminal logs continue in the background by default. To capture only while a
Logs panel is actively monitoring, set `BYCODA_TERMINAL_LOG_BACKGROUND=0` in
the Host environment before starting it. Output outside that interval cannot
be recovered; retained logs remain available.
