# Tasks: progress and recovery

List view scrolls through all loaded tasks without numbered pages. Bulk selection
and the open task remain selected while offscreen rows are recycled. Search and
project, sprint and status filters retain their own list position.

Backlog and a selected sprint both offer List and Board views. The first visit uses
the list; the chosen view is retained. Empty board lanes stay compact, and narrower
work areas stack lanes with a status picker. Crew role instructions remain in the
task detail and editor rather than repeating as list and card previews.

Sprints shows sprint collections until a sprint is selected. Selecting a sprint opens
its scoped tasks. The toolbar refresh updates both task data and sprint planning on
the Sprints and Reports tabs. Sprint capacity and project budgets are optional;
expand Capacity in the sprint editor to change them.

Bulk actions show the number of eligible selected tasks before execution. An action
with no eligible tasks is disabled with a reason. Inactive crew assignments can be
deleted. Crew start, stop and retry actions follow the same Host rules as individual
task actions; accepting a Crew assignment still belongs to its coordinator. Active work, dependencies,
revisions and unmerged branches retain their Host protections. Successful deletions
leave the selection; failures remain available for Retry failed tasks. Identical
failure reasons share one explanation with the affected task names.

Tasks opens on the current project's Host. Select All projects to include other machines. During a brief interruption, the board keeps loaded data and retries in the background. Connection details and optional data warnings appear for sustained interruptions or a failure that needs attention. Retry refreshes the selected scope.

Local project options can appear while other sources are still loading. Sprint data appears as soon as its planning Host answers; source history synchronization can continue afterward. Actions that require current history still wait for that synchronization. Repeated refresh ticks do not accumulate an unlimited queue.

## Creating tasks

`/task <request>` in a chat creates a to-do task from your words exactly as typed;
no model rewrites them. The first line becomes the title, the task uses the chat's
agent and settings, and a notice in the transcript confirms it. If creation fails, the
draft stays in the composer. Agents, voice and Room, automations and stewards create
tasks through the same Host path, so a request delivered twice makes one task. The task
keeps your original request and the chat it came from.

## Model selection

Task, epic and background-automation forms share three rows: **Run with** (Agent, Crew or
Auto), **Model** and **Helpers**. New work starts on **Use settings**: the model follows the role
that matches where the work came from in **Settings > Models > Background work** (board, chat,
voice and Room use the task worker role; an automation uses the automation role) and the
form shows what it uses now. In a chat, **Use this session's model** is a fixed choice with that
session's model. Tasks, epics and stewards can also choose **Any model** or **Fixed**.
Use settings follows the matching role. Any model uses
**Any model, in order** or a named group (an ordered subset); Fixed keeps the selected model. **Manage models** opens
the shared model order and limits. Workers, reviewers and planners resolve when their
run starts; changing settings never switches an existing session. If every model
is skipped, pending work waits for eligibility. When a run starts the Host records how it chose
the executor, model, the entries skipped (with their reasons, such as a quota below its limit)
and the helper policy; the task keeps that record and a running session never changes when
settings change later. A fixed model is never replaced by another one. See [Models](models.md).

## Who runs it and helpers

**Agent** runs one agent. **Crew** runs a saved crew, which works in the project's shared folder and
reviews its own work and picks its own members' models. If the task also asks for isolation, a
working branch, a separate review, automatic merge, retries until done or a fixed model, the
Host refuses and names that option, and the form shows the reason beside the choice; nothing is
dropped silently. **Auto** keeps those options: the Host lists the project's crews that fit them
and, if any, asks the configured decision model once to choose between them and a single agent.
No fitting crew, no confident answer or an error means one agent, and the reason is recorded.
**Helpers** are subagents and the advisor: **Use settings** follows the task, account, provider
then global layers of Settings > Models, **Off** runs the task alone and **Use** lets the task
choose helper models and an effort cap. A task may narrow, but never widen, the model list or the
effort cap the settings allow, whichever model it runs on. The worker, its reviewer and a crew's
coordinator and members follow the same helper policy.

## Understanding progress

- **Queued** means the request is saved. Start requests scheduler admission; it does not promise that a worker has launched. Dependencies, concurrency and budgets still apply.
- **Running** means the worker is active. A lack of recent output is a diagnostic, not proof that the process stopped.
- **Verifying** means configured checks or review are running. Review findings remain attached to the attempt.
- **Completed with open findings** preserves unresolved findings for owner review. It does not mean checks passed, delivery was approved, or a release occurred.
- **Blocked** requires attention to the stated reason. Owner stops, permissions, credentials, budgets, unsafe preparation and repeated runtime failures remain real stops. These gates are not bypassed to make a board look successful.

Every stop and wait carries a reason code, and the card, notifications, the daily summary, Host notes and the assistant all show the same title, reason and next step. A blocked task shows why it stopped (stopped by you, host interrupted, budget reached, failed run, correction exhausted, preparation failed, permission needed, instructions needed, dependency cycle or stopped, crew unavailable, working copy changed, cleanup failed, restored, or could not be scheduled) and what you can do about it. A queued task shows why it has not started: waiting for model quota, a provider usage limit, the daily limit, crew capacity, an unfinished dependency or an assistant hold. When the dependency is itself blocked, the waiting card names that reason; when you stopped the dependency, the waiting task stops with "Dependency stopped" instead of waiting forever. A task saved before reasons were recorded shows "Reason not recorded".

Automatic correction is bounded. Repeating an unchanged failed check stops another identical repair cycle. A reviewer that omitted its final result may receive bounded follow-up requests in the same review session; the worker is not restarted just to obtain a verdict. External checks and exhausted correction retain their findings and owner approval requirements.

A review with acceptance criteria is bound to the working-copy contents it inspected. In a shared checkout it waits while another task's worker is still writing there. If the contents still change during the review, the stale verdict is discarded and the current contents are reviewed again, at most twice; a third change blocks the task with that reason.

An epic runs only the reviews its plan needs. A plan with one task skips the final epic review, because that task's own review already covered the whole job. When the planner marks a small, low-risk job as simple, its tasks run their configured checks without a separate reviewer. Neither rule adds a review you turned off.

An epic is a planned outcome split into tasks for owner approval. Existing saved goal records and Host API identifiers continue to work. For a native Codex `/goal`, open **Goal** in the conversation activity bar to see the full objective, usage and available actions.

Epic progress and budget totals reflect the Host scheduler's latest recorded state and can take a scheduler tick to catch up with task changes.

Open **Goal** beside the current work above the message input to see the provider's goal status, objective, reported token usage and elapsed time. **Pause** pauses an active goal. **Resume goal** continues a paused, blocked or limited goal. **Clear goal** removes it. These actions preserve the input draft and follow the conversation's messaging permissions. Wait for the current turn to finish before changing the goal. Current work and subagents can still be running while a goal is blocked. The panel shows when Codex has provided no reason for that state.

## Retry safely

Tasks open across all projects and servers. Use **Server** to narrow tasks, sprint projects and report totals; **All servers** restores the shared view. The sprint list includes records saved on each connected server and identifies their owning server. Opening a sprint keeps actions on that server, even when another server uses the same sprint ID. Unavailable servers keep their last known catalog with an error and disabled actions.

In the sprint form, project choices include server names. **Sprint server** is where the record is saved; its tasks can run on other servers. Dates and **Work estimates** are optional. Capacity is a planning target in points. Two task estimates of 3 and 5 points total 8 points. Points do not represent hours or limit concurrent execution. Leave capacity blank when not estimating work.

The project picker keeps **All projects** above the scrolling results, including while searching. Finished epic details collapse under **Details** so task lists stay visible. Expand them to inspect run usage, the plan and completed acceptance evidence.

Task and epic deletion wait for Host confirmation. A rejected deletion keeps its confirmation open with the Host's reason and a retry action; the item stays on the board. Cancelling leaves it unchanged. Unmerged work still requires explicit discard confirmation. A cancelled epic never presents an unfinished final acceptance as queued or offers to restart that acceptance.

On mobile, task, epic, and crew-run confirmations show the record, the computer, and the effect of the action in one panel. Cancel returns to the current screen. If the paired connection changes, open the action again to review it for the current connection.

Automatic correction allows one repair, after a configured read-only advisor has
returned advice. A second failed review keeps its findings for owner review.
Transient worker failures retry once. Missing advisor access or incomplete advice
leaves the task waiting with its reason; it does not silently skip consultation.
Capacity waits and advice taking more than one minute retain the same queued
consultation across scheduler ticks. The repair allowance is consumed only after
nonempty successful advice.
Helpers set to **Off** keep subagents off for that task whichever model it runs on, including
a model chosen by the model order.

Eligible blocked tasks offer **Finish with findings** in card actions and task
details. This retains the failed review and notices, and grants no delivery approval.
Stopped, unauthorized and resource-blocked work cannot use this action. Machine
concurrency accepts any positive safe integer; the configured global limit still applies.

If creating a task loses its reply, keep the draft and retry it. The draft retains its creation identity and checks the original Host for the existing task before another save. If the original result is still unknown, resolve it on that project and machine before changing the target. Closing the draft and creating a separate new one is a new request.

A failed limits refresh means usage is unknown or last known, not zero. Existing Host budget enforcement remains active. Read the task's reason before retrying a blocked operation, and use the recorded task for recovery rather than creating duplicates.

Daily agent time and task runtime count only the time a run was actually observed working, per Host local calendar day. If the computer sleeps or the Host stalls, that time is not counted and the run simply continues afterwards: 10 minutes of work, an hour of sleep and 5 more minutes is 15 minutes. A gap never blocks a task or asks for your decision; only counted time reaching a limit does. Running work can still finish. Sprint reports mark history as incomplete when older task events are no longer available, and refresh the affected source from its current snapshot.

Completion, review, delivery, installation and release are separate. Automatic delivery requires a current PASS review, no unresolved findings, a retained workspace plan and Native permission for its original Assistant Room/project. Denied, excluded and uncertain delivery retains the branch and owner-review fallback. A passing review alone never grants permission.

A committed branch conflict shares the single repair allowance and read-only advisor. An active task owning the exact target checkout and run receives one recorded coordination message; otherwise an isolated resolution task receives both reviewed commits and shares the original budget. Stop fences that child, preserving later owner work. Successful resolution makes the original task review a fresh delivery plan. Dirty target overlap remains for owner inspection and does not start committed-conflict recovery.
