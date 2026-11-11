# Working with bycoda tools

## Capability status

Computer use, voice, providers and MCP keep three observations
separate: owner permission, verified readiness and current activity. Enabled does
not imply ready or running. Unknown means that the current read cannot prove the
fact, including after a failed refresh. Inventory, installation and saved sign-in
alone are not runtime verification. Opening settings or the device panel never
enables a capability or starts its helper; use the explicit setup, start or refresh
action when needed. Device control leases remain separate from saved permission.

Skills show only the saved owner preference: the switch on a skill's page, and **Off**
in the list. Bycoda does not observe skill readiness or activity, so the Skills
screen does not display them.

## Devices

An installed Device Host starts only after **Connect devices**. Opening the panel
reads its status. Failed status or discovery refreshes invalidate the previous
readiness and activity observation; retained device drafts and frames stay intact.

The device bar holds the device picker and refresh. Each device carries its platform
icon (Android or iOS), green while the device is running; its version, kind and state
are in the picker list and tooltip. The screen fills the panel with its controls on a
vertical rail beside it; **Device options** at the end of the rail holds the
accessibility snapshot, coordinate controls, setup and zoom. **Setup and access**
shows the device host state, what each platform's SDK check found, and the setup and
start or stop actions. Without a selected device, the panel lists devices to open.

Live view follows an Android device as video when the Host is on Windows or macOS,
so the screen moves as it does on the phone and input shows its result at once.
iOS simulators, older Hosts and any stream failure use still captures instead,
about one per second. Pausing keeps the picture that was on screen.

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

Before a page is open, the Browser panel lists recently opened addresses on this
computer; choose one to open it, or remove it from the list. Addresses with a user
name or password are never stored. A thin bar under the address field shows host work.

The assistant reports page verification and panel visibility separately. If the
desktop is unavailable, it may verify the page without claiming that you saw it.
Another conversation's browser control is never taken over automatically.

Reading the current conversation's browser frame needs no control lease and does
not acquire or renew control. A frame remains readable after the 30-second control
lease expires or another controller takes control of the same conversation's page.
Input, navigation, viewport changes and closing still require an active lease;
the assistant checks status and explicitly claims control again when needed.

The assistant can record the conversation's browser as a short WebM video. Starting a
recording needs the active control lease. After that, recording continues while the
browser is open, even if the lease lapses or another controller takes over, and stops
only when the recording is stopped, the maximum duration (up to 5 minutes) is reached,
or the browser closes; frames captured so far are kept. The file is saved on this
computer. Encoding uses Playwright's ffmpeg, which the Host downloads for its pinned
Playwright version the first time it is needed. If that download fails (for example
offline or a full disk), the recording keeps its frames and stopping it again retries
the encode.

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
desktop asks you to approve the exact target and command inside bycoda before starting it,
unless the original coding session has **Full access** verified by the Host.
Other modes and Assistant Room still ask; reducing access before execution stops
a command that skipped approval.
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

## Generated images

Any conversation, task worker or crew member can create image assets. Choose which
image models a conversation may use in the model picker under **Agents and images**
→ **Image models**. With nothing picked the row reads **Automatic** and every
available model may be used; picking models restricts the conversation to them.
Codex ImageGen appears when Codex is connected and Nano Banana when Antigravity is
connected. The choice is saved with the conversation's model settings, carries into
tasks created from it, can be set as a provider default in Settings, and is never
sent to the model provider as a setting.

The assistant is told which image models are selected and what each can produce.
`images.status` lists the image models this Host can reach, each with live
availability, whether it is selected, output formats, strengths and limits:

| Model                     | Picker id     | Output | Notes                                                                                                                 |
| ------------------------- | ------------- | ------ | --------------------------------------------------------------------------------------------------------------------- |
| Codex ImageGen            | `codex`       | PNG    | Highest quality; Codex members also write SVG, animated GIF and sprite sheets as code.                                |
| Nano Banana (Antigravity) | `antigravity` | PNG    | Simpler quality for quick or simple images. Raster only: no SVG, GIF or animation. Needs a signed-in Antigravity CLI. |
| Gemini / OpenAI image API | —             | PNG    | Needs the Host API key and model; used only while the picker is Automatic.                                            |
| Local ComfyUI             | —             | PNG    | Runs the owner's saved local workflow; used only while Automatic.                                                     |

`images.generate` saves one image as a new `.png` or `.jpg` file inside the
workspace and never overwrites an existing file. Automatic tries Codex, then
Gemini, then ComfyUI, then Nano Banana. Nano Banana runs in a child Antigravity
session shown under the conversation; with supervised access it may ask for
approval there before saving. Images need no per-image approval and are limited
to 12 per conversation. In crews, `image-generation` counts as available for every
member when a Host provider works, and for Antigravity members through Nano Banana.

## Cross-provider advisor and subagents

Provider Settings also sets advisor and subagent defaults for new conversations.
The **Apply to** picker lists workspaces and groups before projects. Use its
category filters or search by project name, group name or project path. While
searching, PageUp and PageDown switch categories. Project rows show their group;
empty groups cannot be selected. Selecting a target does not save changes.
Saving defaults confirms with **Saved** on the save button. Hover or focus the
button for the saved target; unsaved counts and save errors remain beside it.
Project defaults can override the global choices, including turning delegation off;
reset a project field to follow the global setting again. Existing conversations
keep their own settings.

When no choice has been saved, every account starts with product defaults:

- Claude: Opus 5.5, Sonnet 5.5 subagents, Opus 5.5 advisor.
- Codex: GPT-6.1 Sol, GPT-6.1 Terra subagents, GPT-6.1 Sol advisor.
- Grok: Grok 4.7 for all three roles.
- Cursor: Composer 2.5 for all three roles.
- OpenCode: GLM-5.3, GLM-5.3-Flash subagents, GLM-5.3 advisor.
- Antigravity: Gemini 3.8 Flash High, Flash Medium subagents, Flash High advisor.
- Pi, OMP, Hermes and FX: their configured catalog model for all three roles.

Defaults use enabled models from the connected provider's catalog and the same
account as the conversation. If a preferred model is unavailable, bycoda uses an
enabled model from that provider; an empty catalog does not invent a model.
Saved provider, account and project choices, including explicit Off, override
these defaults. Resetting an override restores inheritance. Advisors may use the
same model as the main conversation in an independent run.

A provider with several accounts shows an **Account** picker above its defaults.
**All accounts** edits the provider's defaults; picking an account edits that
account's own model, effort, permissions, subagents and advisor. Fields an account
leaves unset follow the provider's defaults, and project defaults still win. New
conversations use the default account's values. Switching a conversation that has
not sent anything yet to another account applies that account's defaults.

The model panel opens from the model button. It lists providers on the left, the
provider's models in the middle and the selected model's options on the right, with
a short explanation of the option under the pointer at the bottom. This help area
keeps its height as the pointer moves, so the options stay in place. The account
control beside the provider name depends on how many accounts it has: one is shown
by name, two switch with one click, three or more open a list with each account's
usage and reset time, and six or more can be searched. Picking an account on the
current provider switches the conversation to it; on another provider it applies to
the model picked there.

The panel's **Agents** tab has two settings: **Subagents** and **Advisor**. Both list
enabled models and accounts from available providers, so a Claude conversation can
hand work to a Codex model, or the reverse. Panel choices apply to the current
conversation.
Account labels include sign-in status when known; a saved choice does not itself
verify that the account can run.

Select up to eight subagent models; the advisor takes exactly one model. bycoda does
not route work to a particular model or tool. The main model decides whether
delegating helps and picks whichever selected model fits the task best, usefulness
first and cost second. A run with no model named uses the only selected one.

A saved subagent selection bounds each provider's own subagents too. Claude's native
subagent tool stays only when exactly one Claude model from the main model's own account
is selected, and it is fixed to that model; otherwise it is removed. Codex, Grok and
OpenCode inherit the main model or their own agent definitions, so their native
subagents are off while a selection is set. Selected models run as Host child sessions,
which accept only selected models. Antigravity, Cursor, Fx, Hermes, Pi, OMP and other
ACP agents have no verified switch yet; their native subagents are not held to the
selection.

A Host advisor is read-only, works in plan mode and sees only the question and context
the main model sends it. Claude's native advisor receives its native
conversation context.

Each run uses the quota of its own provider account. A subagent on a Codex model
consumes Codex usage, not the main model's allowance.

Older Claude and Codex delegation selections without an account refer to the fixed
Default account. The picker recognizes these selections without changing their
stored account or switching them to the conversation's current account.

Host advisors and subagents appear in their parent's activity dock, including finished
runs. They do not appear in conversation lists, search results or workspace tabs.
Opening an old child link returns to its parent and opens that child's panel.
The panel keeps the Advisor role distinct and shows the child's questions and approvals
through its original Host connection. Hidden children can still request attention.
Open a child in the dock to read its
steps, stop it, or message it directly. While it runs, your message steers it; once
it has finished, the message starts a new turn in that child session. Cancelling
the parent turn stops its running children. A stopped child keeps the work it has
already done, so check its files before continuing.

Each child uses its model's own settings, with the reasoning level matched to the
main model's (for example Low), or the closest level the child's model offers.

Limits: eight subagents can run at once, and one advisor at a time. A subagent
cannot start its own subagents or advisor, so delegation does not nest.

## Terminal log capture

Terminal logs continue in the background by default. To capture only while a
Logs panel is actively monitoring, set `BYCODA_TERMINAL_LOG_BACKGROUND=0` in
the Host environment before starting it. Output outside that interval cannot
be recovered; retained logs remain available.

Agents can wait for a background process instead of polling it. `logs.wait` takes a
`terminalId` (or a `sourceId` from `logs.sources`), an optional `contains` text, an
`idleSeconds` quiet period and a `timeoutSeconds` limit (default 30). The limit is at
most 240 seconds for Claude Code, Codex and Grok, and 50 for other providers. Bycoda sets the
`bycoda-conversation` tool deadline to 300 seconds for Claude Code and Codex (see below).
The other ACP providers get no deadline from bycoda, so their waits stay inside the common
60-second default. It returns when a new line contains the text (plain, case-insensitive;
not a regular expression), the process exits or closes, the output stays quiet for the
idle period, or the
timeout passes. The result carries the matching line or the exit code when one is
known, the last 40 new lines and a cursor for the next `logs.read` or `logs.wait`.
Only output produced after the call counts unless `after` is given. A session can run
four waits at a time and the Host runs sixteen.

The exit code comes from the PTY child exit status. Terminals report it with the closed
packet, so `logs.wait` returns `exitCode` (and `signal` where the platform reports one) instead of
only `exited`.

Deadlines per provider (bycoda-conversation MCP server):

| Provider path                                          | Setting bycoda writes                                                   | Deadline         | `logs.wait` max |
| ------------------------------------------------------ | ----------------------------------------------------------------------- | ---------------- | --------------- |
| Claude Code, HTTP or stdio                             | `mcpServers.bycoda-conversation.timeout` in `--mcp-config` (ms)         | 300 s            | 240 s           |
| Codex app-server                                       | `-c mcp_servers.bycoda-conversation.tool_timeout_sec=300`               | 300 s            | 240 s           |
| Grok (ACP)                                             | none needed: Grok documents `tool_timeout_sec` with a 6000 s default    | 6000 s default   | 240 s           |
| Cursor, Hermes, fx, Antigravity, OpenCode, generic ACP | none (ACP `mcpServers` entries have no deadline field; no verified key) | provider default | 50 s            |

The Claude Code 2.1.319 binary describes the per-server `timeout` as overriding `MCP_TOOL_TIMEOUT`. Bycoda does not set that global variable because it would change the deadline of the user's
other MCP servers. Codex 0.135.0 accepts `tool_timeout_sec` in the MCP server config. The
Host relay for a waiting call is 245 s, inside the 250 s Rust relay and stdio proxy limit.

## Pull request watch

An agent can watch a GitHub pull request instead of polling it. Call
`pullRequests.watch` with a pull request `number` or `url`, or with neither to watch
the pull request for the session's current branch. Then end the turn. The Host checks
each watched pull request with `gh` about once a minute and sends one message into
the same session when:

- checks finish passing or failing, or a failing check starts or stops failing;
- the review decision changes, or a new review or comment arrives;
- a new commit's checks finish;
- the pull request is merged or closed. The watch then ends.

A session can watch up to 10 pull requests. Watching the same pull request again
returns the existing watch. `pullRequests.watches` lists the session's watches with
the last observed state, and `pullRequests.unwatch` removes one. A message waits while
the session is running and is delivered once it is idle. Sessions that exist only on
the desktop, without a Host row, cannot be woken, so `pullRequests.watch` refuses them.
If `gh` fails, for example because it is not signed in, the watch keeps its last
error and sends nothing.

While a watch is active and the session is idle, the session list and the live agents
rail show the session as **Waiting** ("Waiting on pull request: owner/repo#12") instead
of Done, on this computer and on remote clients. Needs input, failures and an
interrupted turn still take precedence. Waiting ends as soon as the watch ends: the
pull request is merged or closed and its message is delivered, the watch is removed,
or the session is deleted.

## Secret requests

An agent that needs a credential calls `secrets.request` with a `requestId`, a `name`
such as `NPM_TOKEN`, and a `purpose`. bycoda shows a masked dialog in the source
conversation, or in the application confirmation when that conversation is not visible.
The owner types the value there. Secrets persist per project until the owner removes
them in Settings > Secrets. If a secret with the same name already exists in the project,
`secrets.request` reuses it without asking; pass `replace: true` to ask the owner for a new
value. The agent receives only a `secretRef` and its name. If the owner cancels, or does
not answer within about four minutes, the result is `cancelled`.

`secrets.run` runs a command in the project with the secrets injected as environment
variables and returns output with the secret values redacted. Use it first. When a command
must run in the agent's own shell, `secrets.materialize` writes the value to an owner-only
file and returns its path; the file is deleted after 10 minutes. Values are stored in the
operating system's credential vault, not in the chat or the transcript. Tool results
returned to agents show saved values as `[secret:<name>]`. Repeating the same `requestId`
returns the earlier result without asking again.

## Where approvals appear

Required approvals appear inside the source conversation when it is visible, or in an application confirmation when it is not. SSH, desktop actions, management, Inbox, Room delegation, file access, privacy recovery and quit confirmations use this flow. The exact target and operation remain visible. Expired requests, closed source windows and changed privacy scope cannot authorize work. Application-owned approvals never fall back to an operating-system or browser confirmation dialog; system permission prompts and file pickers remain platform-owned.

Full access reuses execution permission for saved SSH commands in the original coding session. It does not grant publication, credentials, clipboard or physical input, persistent file access, privacy changes or delegation. Those decisions keep their existing approval boundaries.
