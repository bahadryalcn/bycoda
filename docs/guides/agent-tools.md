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

## bykit

When the `bykit` command-line tool is installed and on the Host's PATH, every agent
session is told not to write throwaway scripts and to use `bykit` for large files,
diffs, long command output, broad searches and bulk edits. Without it nothing changes.
Installing it takes effect within about a minute for sessions started afterward.
**Settings > Tools > bykit** turns the instructions off or on for this computer's
Host; the change applies from the next agent turn.

## Tool defaults

**Settings > Tools** has Browser, Devices, Logs, Development Servers and bykit tabs
on one page. It saves local application defaults. New tool views use these defaults;
retained views, explicit choices and restored drafts keep their own state. Reset
applies to the active tab.

Browser's initial address prefills a new view without navigating; open it when
ready. Address-bar search is disabled by default. When enabled, search terms use
the selected engine. A custom HTTP or HTTPS search URL uses one `{query}`
placeholder for encoded search terms and cannot contain credentials. Browser
viewport offers presets or custom integer dimensions: width 240–2560 and height
240–2160 pixels. The viewport applies on the first explicit open of a fresh
Browser session; an active session keeps its viewport.

Live view does not claim device control or start the Host. Log and server
refreshes pause while hidden and retain their existing backoff behavior.

## Delegation readiness

Host delegation checks the exact provider process's scoped bridge route. A missing,
revoked or unreachable spawn grant uses the existing fallback guidance. Automatic
may use built-in subagents without an effort ceiling; explicit model selections and
ceilings stay enforced. A provider started without a grant receives no conversation
MCP server configuration. Before a fresh or parked session starts, preflight prepares
the upcoming spawn's grant and checks that scoped route. Spawn reuses that grant and
endpoint. Checks of an existing process never issue replacement grants.

## Devices

An installed Device Host starts only after **Connect devices**. Opening the panel
reads its status. Failed status or discovery refreshes invalidate the previous
readiness and activity observation; retained device drafts and frames stay intact.

The device header holds the device picker, refresh and control state. Each device carries its platform
icon (Android or iOS), green while the device is running; its version, kind and state
are in the picker list and tooltip. The screen fills the panel with its controls on a
vertical rail beside it; **Device options** at the end of the rail holds the
accessibility snapshot, coordinate controls, setup and zoom. **Setup and access**
lets you choose the machine that runs Devices. For iOS simulators, select the paired
Mac even when the conversation belongs to a Windows project. The runtime status,
platform checks, and setup and start or stop actions follow that selection. Without a
selected device, the panel lists devices to open.

Live view follows an Android device as video on Windows or macOS Hosts. The panel
receives frames on its Host connection and can display the first decoded picture
while the still capture is pending. On a Host that supports live touch, Android
tracks your pointer while you drag. Other Hosts send a swipe when you release.
Older Hosts can use the previous video transport. iOS simulators and devices without
working video use still captures about once per second. Pausing keeps the current picture.

On a Mac with Xcode 27.1 or later, an available iPhone Duo simulator also exposes
**Fold device**, **Half-open device** and **Unfold device** in **Device options**.
The panel obtains control automatically. Agents use `devices.action` with
`action: { type: "fold", posture: "closed" | "half-open" | "open" }` under the same
device lease. Folding clears inspection targets and refreshes the still frame;
capture each pose to check layouts. Physical phones and ordinary simulators do not
offer these controls. The selected Xcode must include the Duo simulator runtime.

Devices obtains control automatically for the selected running device while the panel
is open. If another controller holds the device, the panel waits until it becomes
available. Input requires a valid Host lease.
Closing the panel or switching targets releases its lease after pending input finishes.
App and text drafts remain with their device.

Text, app and accessibility search panels focus their input when opened. Close or
Escape returns focus to the action that opened the panel. Hidden tool panels keep
their drafts without leaving a dialog over another tool.

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
as stale. Refresh successfully before sending more input. Input controls explain when
control, a selected device or a fresh frame is missing; viewing never claims control.

Marking freezes the exact captured frame. Notes and marks remain tied to that
device and conversation. If adding the screenshot has an unknown result, use
Check attachment to reconcile the original receipt before retrying or discarding.
An uncertain transfer never silently attaches another copy; an edited draft stays
available while the original result is checked.

## Conversation tools

The tool machine picker lists **This computer** once for local projects. For
remote projects, it lists the project Host and **This computer** separately.

Before a turn disables native subagents, bycoda checks whether Conversation Tools can initialize for that session. If this bounded check fails, Automatic without an effort ceiling uses the provider's built-in subagents for that turn. Explicit model selections and effort ceilings remain enforced; bycoda tells the model and shows a non-blocking conversation status when delegation is unavailable. Off stays Off. A successful check cannot guarantee that a provider's later MCP connection will succeed. A provider reads its tools only when it starts, so one that started while the Host did not answer, or that outlived a Host restart, starts again before the next message once the Host answers; the conversation and its context continue. If that start does not restore the tools, bycoda waits ten minutes before trying again.

For Codex, bycoda sets `agents.enabled=false` in thread start/resume config to
disable native agent tools (Codex 0.167.2). Legacy `features.multi_agent` and
`features.multi_agent_v2` overrides remain for 0.166.x compatibility; those flags
alone do not remove tools in 0.167.2. Native fallback sets all three overrides to
`true`. A changed native-agent policy restarts the conversation's CLI process and
resumes its thread so a warm process cannot retain the previous tool policy.
Resumed Codex histories can contain old tool declarations followed by namespace
removal updates; an old declaration alone does not prove current tool access.

The assistant can search bycoda's tools by purpose and inspect the full contract
only for the tools it needs. Existing tool names remain available. Finding a tool
does not mean its machine, device or provider is connected or ready.

For schema reads with `tools.describe`, omit `maxChars` to use the default
10000-character chunk, or supply an integer of at least 256; larger values are capped
at 12000 instead of failing. Follow `nextCursor`
until it is null. Invalid numeric arguments identify the field and allowed bounds;
correct that argument before retrying the read.

When you ask for a web application to be checked in the browser, the assistant
uses the integrated preview first when available. The preview opens in the
originating conversation's Browser panel by default. A responsive check can resize
the browser viewport; this does not simulate a physical phone. The dimensions control
in the Browser toolbar opens presets for desktop, tablet and phone, custom dimensions,
and rotation. Width must be
240–2560 pixels and height 240–2160 pixels. Resizing requires browser control and
invalidates the previous element selection and frame geometry.

On desktop, click a remote conversation's HTTP development link to open it in
your system browser. For a matching project server, bycoda creates a private
address on this computer and forwards requests to the remote Host. HTTPS links,
unmatched servers and unavailable forwarding use the project's Host Browser.

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

The visible desktop Browser panel acquires available control automatically. Click
the preview to type, paste, use shortcuts or drag. Scroll directly over the fitted
preview. The panel resumes input when another controller releases the page. If
Chromium needs installation, the Browser panel shows the setup action.

Pausing live view in the visible Browser panel keeps the page active through
periodic status reads. If the Host loses the page, the panel clears the old
image and keeps the address available so you can reopen it.

The desktop panel uses a binary frame stream when supported by the selected
Host. It displays the most recent frame available and falls back to the
regular frame request when the stream is unavailable.

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

Coding conversations and project-scoped Assistant conversations can request
**sessions.message** to queue a message to another conversation, or
**sessions.cancel** to stop its exact running turn. Both require in-app owner
approval of the exact target and operation. First read **sessions.configuration**
for the current revision (message) or run ID (stop). This approves one operation; it does not
grant ongoing control or enroll a session in Assistant supervision.

Messages retain their sender, existing drafts, paused queues and drain leases.
Queued means accepted into the queue, not read by the model. Managed task,
reviewer, Crew and supervised conversations retain their existing work owners.
A changed revision or run requires reading the target again and a new review.
Keep the same request ID when inspecting an uncertain result; do not resend it.

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

For chat message appearance, `preferences.read` returns `application.chatMessages`.
Use `preferences.patch` with `kind: "chatMessages"`, the read revision, and at
least one field in `value`. `userMessageOpacity` and `assistantMessageOpacity`
are integer percentages from 0 to 100. `messageColor` accepts `theme` or `neutral`.
The change goes through the existing desktop owner review.

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

When Work concurrency is one, an active Work turn cannot start a delegated child while it holds the only slot. The child returns a failed result immediately; the caller can do the work itself or the owner can increase Work concurrency. An advisor requested after the parent turn has retired can still run.

**Settings > Models > Subagents** sets advisor and subagent defaults for new
conversations. **Chats** holds provider, model, effort, permissions and
Fast / Service Tier choices. Codex shows Ultrafast when the provider catalog offers it for the model.
Main-model effort uses a stepped scale; Subagent max
effort uses a select.
The apply bar separates provider scope from save destinations. **Apply to** chooses
the current provider or **All providers**. All providers copies only supported,
portable changes; model and account choices are never copied between providers.
Skipped fields are counted, with details available beside the pending changes.
**Save in** selects several destinations at once: Global, workspaces, groups and
projects. Use category filters, search by name or project path, or quick picks for
Global only, all projects or everything. Empty groups cannot be selected.
Selecting destinations does not save changes. Saving confirms with **Saved** on
the button; partial failures name the destinations that failed and retain the
draft. **Retry** attempts the failed destinations again. Workspace and group
destinations save into their current member projects, including nested workspaces;
projects added later follow Global. Account overrides remain machine-wide.
Project defaults can override the global choices, including turning delegation off;
reset a project field to follow the global setting again. Existing conversations
keep their own settings.

When no choice has been saved, every account starts with product defaults:

- Claude: Opus 5.5 main and advisor.
- Codex: GPT-6.1 Sol main and advisor.
- Grok: Grok 4.7 main and advisor.
- Cursor: Composer 2.5 main and advisor.
- OpenCode: GLM-5.3 main and advisor.
- Antigravity: Gemini 3.8 Flash High main and advisor.
- Pi, OMP, Hermes and FX: their configured catalog model for main and advisor.
- Every provider: **Automatic** subagents.

Automatic resolves enabled models from connected providers at use time, up to 24
references, ranked as Best, Strong, Medium, Light and Unranked for the agent; the
settings use an Automatic / Custom / Off segmented control. Custom opens the
model list picker; unset defaults follow inherited choices, then Automatic.
Subagent max effort sets a
separate ceiling without changing the main effort. Unknown families remain available. Claude Fable/Mythos, Opus, Sonnet and Haiku are
ordered in those four tiers. Other known families use the shared family anchors;
these tiers are guidance, not measured capability scores. The agent picks the
lowest tier that can do the part well, using higher tiers for hard parts:
usefulness first, then cost. Provider and tier representation survives trimming.
The conversation's provider uses its own account; other providers use their default
account. Known signed-out accounts are excluded. `agents.options` is authoritative.
Runtime model lists are catalog previews; the agent checks `agents.options` before
delegating. If Automatic returns no models, its `automatic.reason` distinguishes
an empty catalog, no enabled models, no connected providers, and signed-out accounts.

**Automatic**, **Off** and explicit model lists are separate choices. Adding a model
switches to an explicit list; Automatic restores live resolution without saving a
catalog snapshot. Saved lists and Off, including existing conversations, retain
their values. Advisors keep their independent selection and may use the main model.

**Subagent max effort** is independent of main-model effort. Automatic means no
ceiling. A selected level caps both requested effort and an omitted model default,
including later replies to that child. For example the main model may use Low while
subagents may use Max. The control appears beside Subagents in the Defaults tab; defaults remain drafts until saved, inherit through the existing
scopes, and the ceiling is portable across providers.

A provider with several accounts shows an **Account** picker above its defaults.
**All accounts** edits the provider's defaults; picking an account edits that
account's own model, effort, permissions, subagents and advisor. Fields an account
leaves unset follow the provider's defaults, and project defaults still win. New
conversations use the default account's values. Switching a conversation that has
not sent anything yet to another account applies that account's defaults.

The model panel opens from the model button (click, Enter or Space), **Switch Model**
in the app menu, or **Ctrl+Shift+.** on Windows / **Command+Shift+.** on macOS.
Change or disable this binding in Settings > Keybindings. The shortcut toggles the
panel; right-click the model button, or focus it and press **Alt+Down**
(**Option+Down** on macOS), the context-menu key or **Shift+F10**, for recent
models; the button's tooltip says so. Search receives focus on
open: type to filter, use Up/Down and Enter to select. Pointing at a provider on
the rail previews it only while the search is empty; once you type, click the
provider (or use the arrow keys on the rail) to switch, so a drifting pointer
never clears your search. Escape closes and returns
focus to the composer or model button. Tab / Shift+Tab move through the provider
rail, search, model actions and settings; arrow keys move within provider tabs,
Settings/Agents tabs, effort bars and Automatic/Custom/Off. Custom opens a searchable
picker; Enter toggles its active choice, Done returns to the setting, and chip
remove buttons and Add are reachable with Tab. It lists providers on the left, the
provider's models in the middle and the selected model's options on the right, with
a short explanation of the focused or pointed-at option at the bottom. This help area
keeps its height as the pointer moves, so the options stay in place. The account
control beside the provider name depends on how many accounts it has: one is shown
by name, two switch with one click, three or more open a list with each account's
usage and reset time, and six or more can be searched. Picking an account on the
current provider switches the conversation to it; on another provider it applies to
the model picked there.

The panel's **Agents** tab includes **Subagents**, **Subagent max effort** and **Advisor**. Both list
enabled models and accounts from available providers, so a Claude conversation can
hand work to a Codex model, or the reverse. Panel choices apply to the current
conversation.
Account labels include sign-in status when known; a saved choice does not itself
verify that the account can run.

Select up to 24 subagent models; the advisor takes exactly one model. bycoda does
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

In a Claude conversation, a Claude advisor (for example Fable with an Opus main agent) is
Claude Code's own advisor tool: it answers inside the main agent's turn, sees the native
conversation context and starts no separate session. It runs on the conversation's account
whichever account label you picked, so the Advisor menu lists each Claude model once. Its
advice shows in the transcript as an Advisor row with the provider icon, model and state.
While it works, the Thinking label uses the shared working shimmer and respects motion
preferences. Returned advice is collapsed by default; click the row to expand or collapse
its Markdown content, without a line limit. Codex and the other providers have no built-in advisor, so their advisor is a
Host advisor: read-only, in plan mode, seeing only the question and context the main model
sends it, writing only to the main agent. Its answer arrives as an Advisor completion. When
the Host does not respond for a turn, the conversation says the advisor is off for
that message instead of failing silently.

A delegated child starts only bycoda's own tools (Claude with strict MCP config, Codex with
the owner's other MCP servers disabled for that thread; no config file is changed) and gets
a short bycoda hint without the owner's persona. Normal subagents use the parent project's
folder or worktree and its runtime permissions. Omit `files` or set `files: true` for a
normal session. When tools are unnecessary or unavailable, give the child enough context
to answer from the brief.

New Codex and Claude Code delegates keep their saved conversation in Bycoda. If their
provider process restarts, Bycoda restores a bounded excerpt of saved conversation context,
including available tool results. Provider-native state and previous attachment contents are
not restored from this excerpt. New Pi and OMP delegates use a private native session directory
and can resume from that directory. OpenCode keeps new tool-enabled delegates archived in its
own history and can resume them by ID. Existing delegates keep their original storage.

Use `files: false` only when the owner asks for scratch mode and the selected
model's `filesFalse.available` in `agents.options` is true. Claude and Codex run read-only in
an empty scratch folder under
the Host's state directory, with reduced context. Stock Pi uses a tool-free scratch session
when its installed CLI supports the required isolation flags; older versions are rejected.
OpenCode 2 uses tool-free generation with the selected OpenCode model and prior messages
from the Host conversation. A reply keeps the conversation history. Active generation can
be stopped, and another message can be sent after it ends.

Grok and Gemini use tool-free requests to their respective APIs. Enable them in the Host
environment with `BYCODA_GROK_CHAT_ONLY_API=1` and `XAI_API_KEY` or
`BYCODA_GEMINI_CHAT_ONLY_API=1` and `GEMINI_API_KEY`. Select the default account and a
supported model in the provider catalog. Gemini 3.8 Flash selections in the Antigravity
catalog keep their Low, Medium or High thinking level. Named accounts are unavailable on
these API paths. Requests use
the supplied API key's quota, and replies keep the Host conversation history.
File attachments are unavailable on these three generation paths.

These modes do not provide OS file-read isolation. Claude and Codex tools may still read
paths outside scratch. `repositoryReadIsolation` reports that limit.
The folder is removed with the run's record. Unsupported models are rejected; they never
fall back to a normal project run.

Each run uses the quota of its own provider account. A subagent on a Codex model
consumes Codex usage, not the main model's allowance.

Older Claude and Codex delegation selections without an account refer to the fixed
Default account. The picker recognizes these selections without changing their
stored account or switching them to the conversation's current account.

Host advisors and subagents appear in their parent's activity dock, including finished
runs. Each dock row places a larger status mark beside its title: working bars,
a success check, a failure cross, a stop square or an interruption alert.
They do not appear in conversation lists, search results or workspace tabs.
Existing desktop conversations can delegate without moving the parent conversation
to Host execution. Child runs keep their own Host history; the parent's drafts and
execution owner stay with the desktop.
Opening an old child link returns to its parent and opens that child's panel.
While the parent is open or running, completed children remain available in its
transcript cards and subagent history menu. Finishing a child does not close its
open panel. Reopening the parent loads its children from the Host again.
The panel keeps the Advisor role distinct and shows the child's questions and approvals
through its original Host connection. Hidden children can still request attention.
The Host stores child transcripts. Opening a child's panel streams its tool steps and
assistant replies into the parent view, including the final reply after it finishes.
Open a child in the dock to read its
steps, stop it, or message it directly. While it runs, your message steers it; once
it has finished, the message starts a new turn in that child session. Cancelling
the parent turn stops its running children. A stopped child keeps the work it has
already done, so check its files before continuing.

The assistant chooses each subagent's effort by the difficulty of its part, up to the
highest level the model offers; a run with no effort named uses the model's default. Advisors match the main model's reasoning level, or the closest offered
level. The assistant answers a finished child's question with `agents.reply`, keeping
the same conversation context. Follow-ups can update earlier task instructions;
advisor read-only access and child authority limits still apply. Approvals still
need your answer in the child panel.
The assistant can wait for up to 16 runs together: up to 240 seconds for Claude,
Codex and Grok, or 50 seconds for other providers.

Child cards and the activity dock follow each child's own execution status after
the parent turn ends. A finished parent can still have running background children.

A subagent may split its own task: it starts its own subagents with
`agents.delegate`, using only your selected models and effort ceiling, up to four at
once. Those grandchildren cannot start more agents, and their built-in subagents are
off. Subagents never consult an advisor, and advisors start no agents. Grandchildren
report to the subagent that started them. Its dock row counts them ("Subagents: 2") and
says Needs input while one waits on you; its panel lists them at the top, answers their
approvals and questions, and opens each one in the same panel (Back returns).

Subagents can discover their parent and siblings with `agents.list` and contact
them directly with `agents.send`. Messages keep the same child conversation and
context. `auto` steers a running Host turn when the provider supports it; otherwise
it waits for an idle turn. `queue` waits; `steer` requires an active Host turn.
Open the subagent from its conversation card or Background work to see messages,
delivery status and replies across rounds. Queued messages stay visible while they
wait for the active turn. Provider acceptance confirms delivery to the provider;
the conversation shows any answer the subagent produces.
Drag the panel edge to resize it, or use Expand and Restore in its header. Open a
nested subagent from the list at the top and use Back to return to its parent.
The conversation composer sends to the open subagent. While an active turn supports
Steer, choose Steer to reach that turn or Queue to wait. Use the attachment and
skill controls supported by the conversation's owner. Provider-native agents that
use the main agent as a relay show that path in the composer.
Parent messages can use the existing shared queue, including for desktop Native
conversations. Existing owner pauses, approvals, drafts and queue leases remain in
force. Queued or steered means accepted, not that the model has read the message.

For background work, the assistant sets `notifyOnCompletion: true` on delegation
or consultation and can end its turn. The result is queued to the original parent
once that child turn finishes, waking the parent when its queue can run. The
default remains explicit `agents.wait`. A stopped group cannot send queued wakes;
an uncertain delivery after a disconnect is retained for inspection, never replayed.
Background parent wake is for interactive conversations. Task, goal and automation
Work parents keep waiting for child results: only their Work owner can resume them,
and a child cannot create an unbudgeted parent turn through the generic queue.
Peers cannot change one another's assigned scope or permissions, contact other
groups, or target a conversation with broader execution permissions. Advisors can
message their parent only. Useful questions/results are encouraged; acknowledgement
loops are not.

Limits: 16 Host subagents can run at once, and one advisor at a time. Host delegation
is one level: a delegated child's session catalog, discovery and MCP tool list omit
all `agents.*` tools. Execution also rejects Host delegation. A child may use its
provider's built-in subagents. Its panel lists running and past native runs with
their names, models and status; expand a run to read its steps during execution or
after it finishes. These runs stay under the child, outside the parent's composer menu.

Claude Workflow subagents appear under their Workflow phase in the activity dock
and session subagent menu. On mobile, phases appear in the Agents sheet. Open an
agent to read the captured transcript steps. The Workflow owns its child tasks,
so stop the Workflow to interrupt them together. Workflow is available when the
session permits Claude's automatic native model selection and has write access.

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

## MCP servers on demand

The owner's other MCP servers are not wired into each session. An agent lists them with
`mcp.servers.list`, reads one with `mcp.servers.describe` (its tools and instructions,
both treated as untrusted data) and runs a tool with `mcp.tools.call`. Nothing starts
until a tool is called. Delegated children can use the same three tools; a crew member
sees only the servers and tools its crew profile allows.

Tools the server marks read-only run directly. Any other tool needs approval in the
conversation, showing the server, the tool and its arguments with secrets removed.
An approval holds for that tool for the rest of the conversation, and is dropped on
restart. A session with Host-verified full access skips the prompt; a headless session
with no desktop to ask is denied. A revoked session cannot use an approval given
earlier. Results are cut at 32,000 characters and a call times out after 60 seconds
unless `timeoutSeconds` (at most 110) says otherwise. A repeated `requestId` with the
same input returns the earlier result.

## Secret requests

Secret tools work in both Host-managed and local desktop conversations of the project;
the desktop conversation does not need to be adopted into the Host store.

An agent that needs a credential calls `secrets.request` with a `requestId`, a `name`
such as `NPM_TOKEN`, and a `purpose`. bycoda shows a masked dialog in the source
conversation, or in the application confirmation when that conversation is not visible.
The source Host rechecks the original request before opening the input and before saving
the value; another device or a revoked request cannot authorize it.
The owner types the value there. Secrets persist per project until the owner removes
them in Settings > Secrets. If a secret with the same name already exists in the project,
`secrets.request` reuses it without asking; pass `replace: true` to ask the owner for a new
value. The agent receives only a `secretRef` and its name. If the owner cancels, or does
not answer within about four minutes, the result is `cancelled`.

Settings > Secrets lists metadata from this computer's local Host, grouped by
project. It never displays saved values or edits them. An unknown project stays
listed under its ID. **Retry** reloads a failed inventory or rediscovers an unavailable
local Host; a remote computer is not substituted. **Remove** asks for confirmation,
and a failed removal keeps the entry available for another attempt.

The masked request form accepts up to 8192 characters. An oversized entry stays in
the open form with a length error until corrected; it is not truncated or submitted.
The draft exists only in memory. Cancelling or closing the request discards it.

`secrets.run` runs a command in the project with the secrets injected as environment
variables and returns output with the secret values redacted. Use it first. When a command
must run in the agent's own shell, `secrets.materialize` writes the value to an owner-only
file and returns its path; the file is deleted after 10 minutes. Values are stored in the
operating system's credential vault, not in the chat or the transcript. Tool results
returned to agents show saved values as `[secret:<name>]`. Repeating the same `requestId`
returns the earlier result without asking again.

## Where approvals appear

Required approvals appear inside the source conversation when it is visible, or in an application confirmation when it is not. SSH, MCP tool calls, desktop actions, management, Inbox, Room delegation, file access, privacy recovery and quit confirmations use this flow. The exact target and operation remain visible. Expired requests, closed source windows and changed privacy scope cannot authorize work. Application-owned approvals never fall back to an operating-system or browser confirmation dialog; system permission prompts and file pickers remain platform-owned.

Full access reuses execution permission for saved SSH commands and non-read-only MCP tool calls in the original coding session. It does not grant publication, credentials, clipboard or physical input, persistent file access, privacy changes or delegation. Those decisions keep their existing approval boundaries.
