# Personal assistant

Open **Set up** in the tool navigation to choose the assistant's name, language,
execution provider, working permissions and daily token budget. The chosen name
also appears in its Room and on messages it writes. Voice setup checks the
provider, microphone and selected voice separately. Talking always requires an
explicit microphone action.

## Give and follow work

The Room opens on **Today**, with a request field and current work. Use its tabs
for conversations, jobs, sessions, notes, history and memory. The header's status
control contains activity and usage details. Refresh and secondary actions stay
in menus; the settings control and **Stop everything** remain directly available.

Enter several requests in the Room or say them during voice chat. Review each
request and its project before choosing **Start**. Keep the same request when
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

Plan approval can be required always, only for big jobs, or never. Big jobs have
four or more planned tasks or span multiple projects. The selected policy is
saved with the goal and checked before its tasks are created.

A project job's priority changes which queued job is admitted first. High,
normal and low priority retain the existing work-hour, budget and permission
holds; changing priority does not interrupt running work.

The Room shows current jobs, linked tasks and sessions, conversations, saved
memory, notes and activity. Open a linked session to inspect its actual work.
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

## Rules, conversations and notes

Save preferences as owner rules and choose whether they apply to voice, coding
sessions or both. Learned facts have separate provenance and cannot promote
themselves into owner rules. Forbidden terms can be excluded from assistant
text outputs. Review remembered facts and remove outdated information in
**Memory**.

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
for away or idle, red for do not disturb, and a neutral ring when the
current reading is unknown. Its text and icon identify the state without color.
Pending changes and failed reads do not show a confirmed green state.

Set **Away** or **Do not disturb** when appropriate. Updates remain in History
and notes; a return briefing can describe completed work and items needing
attention. Quiet hours and the proactive speech preference control spoken
briefings. Returning never opens the microphone.

Presence settings let you choose idle and away delays, working hours, and which
updates can notify you while present or away. Equal start and end hours allow
work throughout the day. Outside working hours, accepted turns can finish while
new work waits. Do not disturb and quiet hours hold notifications for the next
briefing. By default, only urgent updates notify you while away.

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
reporting; exhaustion holds new child work. Provider charges may exceed a local
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
visible while the workspace is minimized. Its Stop button, the inline controls
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
