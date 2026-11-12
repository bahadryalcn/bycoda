# Personal assistant

The Room's **Conversations** starts in **Global** scope. Its management history
and draft belong to the Assistant, even when no project or coding session is
open. Name the target project in requests about project work; the global
conversation keeps its identity. Project-scoped conversation history remains
separately selectable, but managing a project does not require switching to it.

When the Assistant is enabled and setup is complete, the main application window
keeps that global Room registered in the background. Registration does not start
a model turn, open a microphone or select a project. An open interactive Room
takes precedence over its background registration. Closing the application or
losing the native Host connection makes that source unavailable.

Application preferences, provider metadata and visible project discovery can use
the registered Room conversation directly. Native review, revision checks and
operation receipts still apply to changes. Closing voice does not stop already
accepted Host work. A disconnected Host or unavailable native owner remains
unavailable; the Assistant does not borrow another session to continue.

Typed Conversations can discover and call the supported application tools through
the same Room identity. Project work still names an explicit visible target;
native approvals and account policies remain in force. Each turn has a bounded
step and token allowance. If a tool times out or its acknowledgement is lost,
inspect the reported original operation before requesting it again. The Host
retains that operation's identity and does not automatically replay the effect.

For canonical Host conversations, the Room can create an unsent session with
explicit provider, model and execution settings, submit reviewed work to an idle
session without a draft, and stop an exact run. Read the current revision before
submitting. A sent message records its real Room author; it does not invent a job
or manual-supervision grant. After an uncertain acknowledgement, use the original
submission ID to read its receipt. A missing receipt means unknown, never safe to
send again. Accepted work belongs to its Host run and can continue after voice
closes. Native desktop sessions retain a separate execution-owner path.

Global scope does not grant every account or remote Host. In a social account's
settings, **Assistant account access** separately permits reading and preparing
drafts without choosing a project. Access starts off and can be revoked there.
Sending still requires the account's policy and exact owner approval. Revoking or
changing access invalidates earlier grant versions, including retained results.

The personal notebook uses existing Notes storage without choosing a project.
Typed or voice requests can list, read, create, update and delete Assistant
notebook entries. Changes retain native review, revisions and operation receipts;
deletion retains recovery. **Save personal note** remains available directly.
Project notes and ordinary notes outside the Assistant notebook retain their
existing scope.

In **Conversations**, **Remote access** shows the Room registration state and
lets you choose a paired Host, target project ID, scope and duration. **Connect**
opens Native review of that exact request. The target must have a qualified Native
Room, visible project and trusted installation identity. The grant retains the
original project directory; moving the project requires a new review. Inspect
the original request after an uncertain reply before starting another connection.
**Show native identity for owner enrollment** displays
the public installation identity; it does not enroll it or grant access. Headless
access needs a separate owner decision.

Task observation has separate, default-off completion and needs-input settings
under **Settings > Work > Presence and hours > Notifications**. They apply only to explicitly supervised projects.
Preferences can be saved while the source is unavailable; notifications wait
until this Host can verify the source and transfer an exact notification to its
native owner. Native acceptance and actual notification display are separate.
Unknown delivery is never automatically retried. These settings do not request
operating-system notification permission; saved preferences do not imply an
active subscription.
The observation journal stores bounded change metadata rather than task text.
Retention gaps require an authorized resnapshot before the cursor can advance.
Personal Native Notes and saved Servers use their original installation scope,
separate from project and Social account events. Their initial state and any
source gap require a verified, fully delivered metadata baseline. Pending or
uncertain completion remains incomplete. Observation never opens the microphone
or approves a new action.

**Room > Sessions** separates job-created sessions from manual conversation
supervision. Search narrows both lists; the status filter applies to job sessions.
Clear filters when no sessions match, or choose **View jobs** when no job sessions
exist yet. The supervision panel keeps its current state, project settings and
refresh action together. An unavailable policy shows **Unknown** until refreshed;
only a confirmed disabled policy shows **Off**. Supervision still requires explicit
project selection and individual conversation enrollment.

The Room's **History** tab groups activity by day, newest first. Each entry keeps
its time, event type and available job/session links together. Search and the
type filter narrow the visible entries; **Clear history** still requires confirmation.

In the Room's **Jobs** tab, write requests in the input above the job list, one
request per line, then send them. Jobs start directly unless **Confirm jobs before
starting** is on in Set up; then each request is reviewed first. The heading shows
the number of matching jobs. Search and filters narrow the list; **Reset** in an empty search
result clears them without changing your draft.

Open **Set up** in the tool navigation to choose the assistant's name, language,
execution provider, working permissions and daily token budget. The chosen name
also appears in its Room and on messages it writes. Voice setup checks the
provider, microphone and selected voice separately. Talking always requires an
explicit microphone action.

Setup offers a daily token budget of one million for an unconfigured assistant.
Choose a preset or enter an exact custom limit; existing chosen values are kept.
This limits local scheduling, not your provider's bill. Work and quiet hours use
24-hour clock selections. **Work all day** keeps scheduling available throughout
the day; quiet hours hold notifications. The model's effort can be changed directly
without selecting the same model again. Additional explanations are available from
the information controls beside each group.

**Set up with AI** on the first setup step, and **Create with AI** in Room
**Settings** → Personal, let a text model you choose interview you about how the
assistant should look, sound and behave. Answer its questions, pick a quick answer
or press **Finish and show preview** at any time. The preview lists every proposed
setting next to its current value; untick what you do not want, edit the persona,
and optionally draw an avatar with Codex or Gemini. **Apply to settings** only fills
the form; nothing changes until you save. Jobs and autonomy, execution access,
project supervision and computer use are never proposed and stay manual. The
avatar picker also has **Generate with AI** for a portrait from your own
description; generated avatars are stored on the Host.

Quick setup has three steps: your name and how the assistant addresses you, a
**Work mode**, and a review. Voice setup adds its provider, voice, microphone,
conversation and hours steps. The work mode answers one question, how freely the
assistant may work, and sets the job controls together:

- **Only watch** reports what happens and starts no work.
- **Work and ask** runs jobs you assign and asks before commands, file changes
  and big plans.
- **Work freely** runs jobs without asking; commands and file changes run without
  confirmation.

Nothing is selected until you choose one. Models are not asked for: the available
default model becomes the worker, and you manage the model list later in
**Settings > Work > Models**. If no default model is available, choose a work mode
that starts no work, or add a model in Settings first. Rules you want the assistant
to follow are added in Memory. Opening setup alone does not save a worker or start
work.

Voice has **Global** and **Project** scope. New voice configurations start in
Global; an existing explicit scope is retained. Moving between projects or app
views keeps an authorized voice connection open. Each utterance retains its
original target; the next utterance follows the current selection unless pinned.
Disconnect, screen-lock sleep and permission revocation still stop capture.

Global voice can discover displayed project names and historical session
metadata, then use exact project/session identities for navigation and lifecycle
actions. Partial or duplicate project names need clarification. Desktop operations
can use a real assistant conversation without opening a coding session, while
retaining the owner's per-app approval and computer use permission mode
(Ask every time, Auto or Full access, set only in **Access > Computer use** settings). A tool's
authentic response can be usable even when its contents cannot be attributed to a
project; that content does not become a saved personal rule or trusted memory.

## Give and follow work

Room **Settings** has four sections. **Personal** holds identity and language;
personality and conversation are under **Personality and conversation**. **Work**
holds the work mode, the daily token budget, the model list, presence and hours,
and notifications. **Access** holds everything the assistant may touch: job
execution permissions, folders and commands, computer use, manual session
supervision and the 24/7 readiness list. **Advanced** holds cost and context
limits and conversation retention.

The work mode shows **Custom** when your job settings match none of the three
modes. **Customize** under it keeps autonomy, plan approval, job confirmation and
routine worker questions available individually; picking a mode replaces them.
Execution permissions are on **Access** and the mode sets them together with the
rest. Switching sections keeps
unsaved preferences. **Save** applies changed profile preferences and conversation
retention, then models, project supervision, computer controls and folders, without
closing the dialog. The button shows progress and confirms **Saved** only after
every changed section succeeds. Errors keep the remaining drafts for retry; editing
again restores **Save**. Each section retains its own version and permission checks.
Changing sections does not save drafts. Search
projects by name or folder path; paths distinguish projects with the same name.
Helper executable and checksum fields are under **Advanced helper settings**.
Closing settings or running setup again asks before discarding unsaved profile,
project or computer drafts. **Keep editing** retains those drafts without saving them.
Pending saves and helper preparation keep settings open.

Personal preferences also set how often the assistant uses your name (always,
sometimes or never), its tone, whether profanity is allowed, and a free-text
persona. These change style only; they never approve permissions, publishing,
credentials or destructive actions.

Computer settings distinguish the verified helper file, saved permission and a
currently running desktop operation. Opening settings reads these states; it does
not enable control, connect to an application or prepare the helper. Enabling the
saved permission allows future requests through existing approvals. A verified
helper alone does not mean control is enabled or an operation is running.

**Folders and commands** (Computer settings) is where you choose the folders the
assistant may use when it is not working in a project. Add up to 20 folders with
the folder picker. A whole drive or your home folder may be chosen; system folders
(such as Windows and Program Files) and credential folders (such as `.ssh`) are
refused, both as a chosen folder and as any path the assistant touches inside one,
and a link that leads outside a folder is never followed.
The assistant reads, lists and searches these folders without asking, asks for your
approval of each exact change (write, create, rename, move, copy, delete), and can
run a command to completion and read its exit code and output. Every command run
shows its command, arguments and folder for approval unless you switch on **Run
commands without asking** (off by default; it also applies to project
conversations). Both choices are saved only from this screen, never by the
assistant, and use the dialog's Save. After a Host restart an unfinished command
is reported as unknown and is never run again automatically.

The Room opens full screen on **Today**, with a request field and current work. Use its tabs
for conversations, jobs, sessions, notes, history and memory. The header's status
control contains activity and usage details. Refresh and secondary actions stay
in menus; the settings control and **Stop everything** remain directly available.

**Conversations** shows your messages on the right and assistant replies on the
left, grouped by day. Press **Enter** to send or **Shift+Enter** for a new line.
Unsent drafts stay with their conversation. Message deletion, recorded actions
and related work remain available beside each message; conversation actions live
in the chat header. The voice launcher has its own space beside the composer.
If a draft cannot be saved locally, the Room keeps it in this window and offers
**Retry saving**. Save it before closing the window: an unsaved draft held only
in memory cannot survive a full app exit. Job priority and replan requests wait
until their original request can be saved locally before dispatch.

Enter several requests in the Room or say them during voice chat. Jobs start
directly unless **Confirm jobs before starting** is on; then review each request
and its project before choosing **Start**. Keep the same request when
retrying an uncertain submission: its saved identity lets the Host reconcile it
with the original goal. Closing the voice connection does not stop Host work.

Choose **Save personal note** for a request that only needs a note. Review its
title and complete contents before saving. This creates a global notebook entry
directly, without a project, planner or model call. An uncertain result retains
the original request and note identity for inspection rather than creating a
second note.

Choose **Scheduled automation** for recurring work. Review the project, schedule,
provider, model and run limits before saving. Creation saves the schedule without
starting a run. Open its confirmed result in Automations to inspect or change it.
An unconfirmed result keeps its original identity for reconciliation.

After the desktop has been offline, scheduled automations consider only the newest
missed occurrence. It runs only within its configured grace period; the schedule
then advances to a future occurrence instead of replaying every missed run.

Plan approval can be required always, only for big jobs, or never. Big jobs have
four or more planned tasks or span multiple projects. The selected policy is
saved with the goal and checked before its tasks are created.

A project job's priority changes which queued job is admitted first. High,
normal and low priority retain the existing work-hour, budget and permission
holds; changing priority does not interrupt running work.

The Room shows current jobs, linked tasks and sessions, conversations, saved
memory, notes and activity. Today lists the day's notes, and each job's details
show its **Activity** and the **Notes** that mention it. Open a linked session to
inspect its actual work.
The supervisor can follow and contact sessions belonging to its own jobs.
To include a conversation you opened yourself, enable the separate manual-session
policy in assistant settings, choose its projects, then explicitly enroll the
conversation in **Sessions**. This is off initially. Source changes require a
fresh enrollment. Revoking a grant or turning the policy off stops pending
supervisor writes. Existing approvals, drafts and execution owners still apply.
When the desktop is closed, writes to manually enrolled conversations pause if
their current project privacy and visibility cannot be verified. The Host does
not treat missing desktop visibility as permission. Assistant-created jobs keep
their independently assigned scope.

**Report only** observes without dispatching new project work. Explicitly saving
a reviewed personal note remains available. **Run jobs**
starts and tracks assigned Goal/Task work. **Supervise assigned jobs** additionally
reviews events, replans and nudges its current task workers. Manually opened
conversations retain their existing execution owners; the separate enrollment
policy grants only bounded follow-up messages. Independent reviewers are excluded.

Use **Take assistant off this session** in a managed session's header to remove
future assistant follow-ups. Its canonical task and running worker continue;
historical author labels remain. If removal is unconfirmed, **Check status** reads
the original source before another action.

The optional **Answer routine worker questions** setting is off initially. In
supervision mode it permits answers to bounded clarification questions from
current workers of assigned jobs. Actual permission prompts and questions about
credentials, publication or destructive actions still require you. Unknown or
large worker context also leaves the question for you; pending questions are
preserved through context maintenance. An answer marked submitted means the
matching question protocol accepted it, rather than proof the model used it.

A running task shows **Running · no recent output** after at least 15 minutes
without observed provider work or output. It remains running. Metadata, usage
and polling do not reset the timer; real output clears the warning. Owner-input
waits have their own state. Unknown activity timestamps do not imply a stall.
Task follow-up counts include confirmed delivered messages; unconfirmed outcomes
are shown separately. Updating those counts does not count as new worker output.

If a supervisor review has an uncertain result or exceeds its reservation, the
Room shows an attention message. Inspect History, then use **Retry review** in
supervision mode. This retries reasoning without cancelling running jobs.

After two unsuccessful follow-ups, supervision may restart the same assigned
task once, retaining its changes and history. If it stalls again or the outcome
is uncertain, it waits for you. Manually enrolled conversations are escalated
without automatic cancellation. Inspect an uncertain task before using its normal
Retry action; resuming the assistant does not replay it.

In Jobs autonomy there is no supervisor to follow up, so a stalled job worker gets
one fixed follow-up per stall, still within the nudge limit, budgets and holds.
After the follow-ups are used, the same single restart applies. Manually enrolled
conversations never get this automatic follow-up, and Supervisor mode keeps its own
review-driven follow-ups.

Work you start by voice or in the Room (goals, standalone tasks and crew runs) is
tracked once it is created. The assistant only watches it: you still get a notice
when it is done, fails, needs you or stalls, and no new authority over it is
granted. Up to 200 items are tracked; finished ones are forgotten after seven days.

Use a job's pause, resume or stop action to control that job. **Stop everything**
interrupts the supervisor and requests that its linked jobs stop. Errors remain
visible when a child cannot be stopped. Resuming the supervisor permits new
work; it does not silently recreate cancelled jobs. Emergency Stop stays
available while another Room operation is pending.

Deleting a job keeps its tasks by default. To delete its tasks too, review the
current task list and select that option explicitly. The Host first stops the
exact associated work; an uncertain stop leaves deletion pending. **Keep job and
tasks** releases that pending deletion without restarting anything. Restoring a
deleted job restores available task metadata in a stopped state. **Review tasks**
opens the task board, where existing restart and delivery controls still apply.

When the assistant needs your decision, **Waiting for you** retains the question
and its choices even with voice off. Choose an option, type your own answer, or
use **Later** to postpone the whole question. Later schedules a reminder without
answering it. Answers become context for the next supervisor review and grant no
additional permissions. Unrelated jobs can continue while a question waits.

### One-time schedules, reminders and job chaining

An automation created from a quick job can run **once** at an exact date and time
(up to a year ahead) instead of repeating. The Host stores it as an ordinary
automation armed for that moment; it runs a single time and then turns itself off.
The review shows the run time. Changing its schedule later in Automations makes it
a normal repeating schedule. A run missed while the computer was off for more than
twelve hours is recorded as skipped, as for other automations.

**Reminders** are personal and start no work. The assistant keeps them separately
from jobs; each one fires once at its time as an assistant notification, with
the usual quiet-hours, do-not-disturb and presence rules, and reaches a paired
phone through assistant push. When the desktop voice is connected and you are
present, a fired reminder is also spoken ("Reminder: ..."), once, even if "Speak
job updates" is off; it stays silent in quiet hours, while the speaker is muted or
announcements are held, and when proactive speech is set to never. A reminder that
was not spoken stays a notification. Ask the voice assistant to list or cancel
pending reminders.

A project job can **wait for another job**: it stays queued until that job is
done. If the earlier job fails or is cancelled, the later one stays queued with
the hold reason "dependency" and you get one notification saying which job it is
waiting for. Stop it in the Room if you no longer want it.

### Pull request watches

Ask the assistant in a project Room or by voice to "watch PR 12". The Host
remembers the watch (up to 30, for 14 days) and checks the pull request about every
three minutes using the GitHub sign-in the Git panel already uses, so it keeps
working with the desktop window closed. You get a notification, with a push to a
paired phone, when the PR is merged or closed (the watch then ends), when its checks
fail or pass, or when a review requests changes or approves. If GitHub cannot be
reached or you are not signed in, you get one "Cannot watch PR" notice and the
watch pauses. The watcher only reads: it never comments, merges or pushes. Ask the
assistant to list or stop your watches. Session watches inside a coding session
are separate.

## Rules, conversations and notes

Save preferences as owner rules and choose whether they apply to voice, coding
sessions or both. Learned facts have separate provenance and cannot promote
themselves into owner rules. Forbidden terms can be excluded from assistant
text outputs. Review remembered facts and remove outdated information in
**Memory**. Its search and **Add memory** action sit above grouped Rules, About me
and Learned entries. Each entry keeps its scope, source and date beside the text;
enable, edit and delete controls stay with that entry. In the editor, write the
memory first, then select its kind and scope and optional forbidden words. Deleting
requires confirmation; **Undo** restores the deleted entry.

**Notes** shows searchable cards with a title, update time and content excerpt.
Open a title to read or edit the complete note. **New note** keeps an unfinished
draft when closed; deleting a card requires confirmation and retains recovery.
Hover a note to show its checkbox, or use **Select all** above the list, then
**Delete** removes every checked note after one confirmation. Each note keeps its
own recovery copy, and one **Undo** restores them all. If a note changed or fails
to delete, deletion stops there and later notes are kept.

**Summarize today** in Notes shows the retained daily briefing and its generation
time. It returns that day's saved artifact even if a later return briefing became
the current update. Reopening it does not create another note, regenerate a model
response or repeat its notification. A legacy daily record without its artifact
is shown as unavailable. The normal daily briefing policy still applies.

An accepted spoken correction can be saved as a rule with the owner's exact
words. **I decide when my turn ends** keeps the assistant waiting through pauses;
use **Finish turn** when ready. A model's inferred fact cannot replace an owner
rule, and deleting a rule by voice requires a specific owner confirmation.

Conversations are stored by the local Host. Search them from **Conversations**;
voice and typed messages keep their source. Notes use the existing global Notes
library with the assistant tag. Recently deleted items can be restored for seven
days. Permanent deletion requires a separate action.

Conversation retention defaults to keeping messages indefinitely. Settings offer
30, 90 or 365 days. **Clear conversation** applies to its complete stored history,
including older pages; it preserves the conversation summary and unsent draft.
Deleted messages enter the seven-day recovery period.

The Host normally refreshes a conversation summary after 20 accepted messages.
**Conversation summary interval (messages)** accepts 10–200. The summary is a
separate retained artifact: clearing its source messages does not erase the
artifact or its verified provenance. A verified artifact can still supply context
after transcript clear, while every contributing project must remain available
and visible. An old raw summary without that proof is never treated as verified.
Use **Refresh conversation summary** to request a refresh. If confirmation is
lost, **Retry summary refresh** checks the same saved request; it does not create
a new request or blindly repeat an uncertain provider operation.

Ordinary voice planning choices share the Room's retained decision card when the
Host can verify their conversation and every contributing project. Reconnecting
uses a verified summary once, together with up to six saved, visible messages.
Every contributing project must remain visible when that context is actually
sent. A visibility change closes capture and leaves the microphone off.
Reading unsaved application context can
make a later choice unverifiable; another spoken turn alone does not clear that
condition. Existing messages and drafts remain available. Clearing an original
source can invalidate a question and requires a fresh question.

If saving a question has an uncertain result, voice holds its choices. **Retry**
checks the original saved request instead of creating another card or submitting
an alternative answer. After voice closes, the pending card remains in the Room
for the same recovery. Confirmed answers and postponements are linked in the
conversation. Operation approvals keep their separate confirmation flow.

Remote voice history remains on its captured remote Host; it is never moved into
local history. Mirroring remote voice decisions into the local Room is currently
unavailable.

## Presence and cost

The availability control in the Room and title bar shows green for here, amber
for away or idle, red for do not disturb, and a neutral ring for offline, when
the app cannot reach the Host. Its text and icon identify the state without
color. Availability is always one of these states. A computer whose activity
cannot be read counts as away, and one slow or failed reading keeps the last
state for up to five minutes instead of changing it.

Set **Away** or **Do not disturb** when appropriate. Updates remain in History
and notes; a return briefing can describe completed work and items needing
attention. Quiet hours and the proactive speech preference control spoken
briefings. Returning never opens the microphone.

Presence settings let you choose idle and away delays, working hours, and which
updates can notify you while present or away. Equal start and end hours allow
work throughout the day. Outside working hours, accepted turns can finish while
new work waits. Do not disturb and quiet hours hold notifications for the next
briefing. By default, only urgent updates notify you while away. A job that stalls
(no output for the configured stall minutes) also notifies you and counts as urgent.
Waiting notifications say why: plan approval needed, needs your input, or stopped
with an error.
A done notification also says what verification was actually recorded for the work
(checks that passed or failed, independent review, final review). If none was
recorded it says "No verification was recorded." and never implies tests ran.

**I'm back** refreshes the return briefing. **Listen** reads it through speaker
output only, with Stop and playback errors visible. An explicit assistant language
wins; Auto follows the last confidently recognized owner language. If no language
is known yet, choose one or complete a recognized voice turn before listening.
The Host prepares the daily briefing at the existing notification summary time
even when the Room is closed, and retains it for later eligible delivery.

Choose **Keep the computer awake while working** only if desired. The Host can
request system wakefulness while children are actually running; it does not keep
the display lit or change the power plan. Unsupported or failed requests are
shown explicitly.

The token budget controls local scheduling. At 80% the supervisor switches to
reporting and no new job starts, while children already dispatched keep working;
exhaustion holds new child work. A repeated request for work that is already
active in the same project returns that job instead of starting it twice.
Budgets count cached reads at one tenth of a token, because they re-read earlier
context at a fraction of the cost; sums stored before this rule keep their old value.
Provider charges may exceed a local
reservation when output limits or usage metrics are unavailable. Usage is shown
as estimated or incomplete when appropriate, rather than as a confirmed zero.

Worker cache usage uses actual reported turn measurements and shows their
coverage. Its mean hit percentage averages the available provider-normalized
turn percentages; it is not a billing rate. Missing cache counters remain
unavailable. This breakdown does not claim cache measurements for the separate
Chief or conversational utility calls.

Advanced settings can select separate models for supervision, replies and
planning. Each inherits the worker model unless you select an override. Planning
overrides change the planner's model; worker permissions and independent review
retain their existing settings.

Advanced context settings separately control when workers compact their context
or hand work over to a new session. The defaults are 150k/300k estimated tokens
and 50%/80% of the model window; whichever threshold is reached first applies.
Unknown context waits for inspection. Pending owner questions are preserved.
Reply output also has a local allowance derived from the remaining reservation;
provider usage and billing remain subject to the limitations above.

You can also limit supervisor reviews per hour and choose zero, one or two
follow-ups before a worker needs recovery. Zero disables follow-ups and automatic
recovery. Manually enrolled conversations always wait for your review after their
limit. Chief context renews at the local briefing time and earlier when it reaches
80% of a known model window or your saved hard limit.

### Model pool

In Room **Settings** → **Models** you list the models the assistant may use, in
priority order. Each model has an effort, a provider account and roles: Worker,
Planning, Chief and Reply. Each also has a **Skip below % remaining** threshold and
an **If limit unknown** choice for when the limit cannot be read.

The assistant uses the first model whose remaining limit is above its threshold.
Running work never switches model. When a running model hits its limit, that work
resumes on the same model after the limit resets, even with the window closed.
Tasks that have not started move to the next model. If every model is at its
limit, jobs wait and you get one notification per reset window.

The voice assistant and Room manager can only use models from this list. Your own
choices elsewhere in the app are not affected.

Until you save a list, the assistant shows a suggested one. If you never chose
different models per role, the suggestion ranks the models available for your
provider by value: the strongest handles Chief and Planning, a mid-tier model
handles Worker, and the cheapest handles Reply and takes over Worker work when
the others are limited. With fewer than two models, or if you chose different
models per role before, the assistant keeps your previous worker, planning, chief
and reply choices. Saving the list replaces the suggestion.

## Running around the clock

**Settings, Access, Ready for 24/7** lists what keeps the assistant working
when you are away. It only reads your saved settings; each item that is not ready
opens the control that fixes it, and nothing changes until you change that control.
Setup ends with the same list, which you can skip.

- The assistant is turned on and setup is finished.
- Autonomy is Run jobs or Supervise assigned jobs, not Report only.
- A worker model is in the model list and the daily token budget is above zero.
- Keep the computer awake while working is on (Windows only; other systems show
  it as not supported). A sleeping computer stops jobs, the morning briefing and
  supervisor reviews.
- A paired phone has assistant updates on, so stalled jobs reach you.
- Task done and needs-input events are watched, and notices while away are All
  or Urgent only.
- Quiet hours are shown so you can check the range.
- The Host survives signing out. This cannot be detected and always shows as
  unknown. On Windows the Host stops when you sign out; stay signed in (locking
  the screen is fine) and install the Host service so it restarts at sign-in. See
  [Manage the host](remote-access.md#manage-the-host).

## Optional desktop control

Desktop control is disabled initially. In assistant settings, supply the verified
helper executable and SHA-256, select permitted apps and explicitly enable it.
A shipped verified helper is discovered automatically. Otherwise **Prepare helper**
builds the pinned source after your explicit action and shows progress, cancellation
and errors. **Use verified helper** fills only the executable/hash draft; save and
enable control separately. Source preparation needs Git, Rust and native build
tools; a package containing the prepared helper needs none of those tools.

The assistant observes an allowed app before acting on a short-lived reference
from that observation. When you are present, each action needs a matching native
owner approval from a focused conversation. Physical input also needs the
separate saved permission and your continued presence. Locking the computer or
losing a valid presence reading prevents input. App content cannot grant new
permissions.

Window lookup, search and screenshots stay within permitted apps. App launch
does not accept arbitrary arguments or activate a window. Clipboard access is
global, so reading, replacing or clearing it always requires your presence and
approval of that exact operation in the native dialog. Clipboard contents are
excluded from History and the daily audit note.

**Stop desktop control** cancels active input and fences older queued requests.
Only a fresh explicit Resume re-enables it. After an uncertain result, inspect
the app and use the original request identity rather than blindly repeating the
action.

The configurable global **Ctrl+Alt+Esc** shortcut also requests Stop while the
app is unfocused. A strip shows the configured name and current app/action when
available. Actions are recorded in History and the daily note using metadata;
typed text and observed app contents are excluded from that audit.

The screen-edge control indicator uses its own native window so it can remain
visible while the workspace is minimized. It appears only when the assistant
starts using the computer, not when computer use is merely enabled, and hides
about 20 seconds after activity ends. Its Stop button, the settings controls
and the global shortcut share the same captured Host connection. Connection
errors remain visible; a replaced Host is not silently substituted for an
uncertain operation.

The Host must remain running, with an available execution provider and any
required native helper. Source tests and browser fixtures do not demonstrate
installed overnight operation or actual desktop effects.

Manual-session writes also require a fresh desktop privacy snapshot. Closing the
desktop or losing that snapshot suspends those writes; assigned Goal/Task jobs
retain their own background execution lifecycle. The Host does not survive logout
on Windows, and locked-screen desktop input remains unavailable.
