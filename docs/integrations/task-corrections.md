# Automatic corrections for unattended tasks

New Task and Goal forms enable **Continue until complete** by default. The selected
host must advertise `tasks.continue-until-done`; an older host is rejected before
project registration or task creation so it cannot silently ignore this choice.
Continuous tasks keep correcting actionable review and check failures beyond the
legacy three-attempt limit while the working-copy contents or findings show progress.
Repeated findings on unchanged contents still require a different approach or owner
input; concrete missing resources, owner stops and configured run limits still apply.
Automatic merging remains a separate choice: with it disabled, verified isolated work waits
for the owner's approval in Review, and dependent tasks wait for delivery.

Legacy goal, steward and explicitly auto-merge tasks get up to three automatic
correction runs after a concrete review failure or a nonzero check exit code.
Other legacy manual tasks keep their explicit Retry behavior. Each correction uses a fresh worker session
in the existing task worktree, with the original prompt and bounded verification
feedback. The original checks and reviewer run again before delivery.
Structured open findings are sent once with their suggestions; their surrounding
review transcript is not duplicated in correction prompts. Legacy details remain available.

Continuous planners and reviewers get up to two format-only follow-up turns in
their retained read-only conversation when a plan or required verdict is missing
or malformed. These turns do not start implementation workers or invent acceptance
evidence. A trusted host interruption can resume a planner or reviewer's retained conversation;
daily usage limits delay recovery instead of discarding the plan.

## Execution machine

Task and Goal forms provide an explicit machine selector and list projects from
that host. New work defaults to this computer, including when the desktop is viewing
a remote project. Switching a goal's machine clears its selected projects. Drafts
retain the chosen machine ID, and clients reject a disconnected destination or a
project belonging to another machine before any write; they never fall back to a
remote host. Existing tasks retain their original host when edited.

The native launcher marks its authenticated direct local host with `localHost`.
This identity survives machine renaming. SSH tunnel endpoints remain remote even
when they use a loopback address; legacy reserved-name local records remain valid.

## Workspace and owner controls

Hosts advertising `tasks.workspaces` support explicit base branches and project
worktrees. Task and goal creation use dialogs. Select an existing checkout, or
create an integration branch with its own worktree. Isolated tasks branch from
that checkout's committed HEAD and deliver back into it. Direct tasks use the
selected checkout without creating or removing its branch. The host validates
that selected paths belong to the task's project; it never switches the owner's
checkout. Uncommitted edits do not become part of a new isolated task.

Task and Goal forms expose an **Execution mode** choice independently of the selected
branch. **Shared checkout** works directly in the selected checkout, usually `main`.
**Separate worktree** creates task branches for later delivery.
New tasks and goals default to direct execution with second-agent review disabled.
Independent direct tasks may run concurrently in the same checkout within the
configured host and goal limits. They preserve existing dirty work and become Done
after their configured checks pass; the owner reviews and commits the shared diff.
Their dependents can
then start without a host commit or merge. Hosts must advertise
`goals.direct-checkout`; older hosts are rejected before creation.

The Changes panel lists the main working copy and available worktrees together in
**All checkouts**. Expand a checkout to review its own changes, or select it in the
checkout picker for its full Git panel and history. Diff, stage and commit targets
remain tied to that checkout; selecting one does not move running sessions or
switch a branch. A worktree isolates edits, but delivery to the base still requires
passing configured checks and a clean target checkout. Work already committed on
the task branch appears in that checkout's history rather than its dirty-file list.

For isolated tasks, **Merge automatically** honors disabled checks as well as
configured checks. No command and no reviewer means no verification is requested;
it does not silently disable automatic merging. Every configured check must still
pass, and delivery still requires a clean checkout on the recorded base branch.

Goals can leave their planned tasks in **To do** for manual starts and set their
own concurrency cap (1–8). The machine cap applies across all goals. **Start now**
prioritizes the selected task and immediately asks the scheduler to run it, while
respecting dependencies, capacity, daily limits and owner cancellation. Drag tasks
between supported board columns, or reorder them within a column on one host;
buttons remain available for keyboard users. Running work cannot be marked done
or skipped by dragging it into a finished column.

In Review, **Choose delivery target** retains the completed branch and changes
its integration checkout without another worker run. Pending tasks of the same
goal and project inherit the new target. **Pause automatic merge** leaves the
result for an explicit merge. A dependent task cannot start from a base missing
its recorded prerequisite integration commit. Worker and reviewer session buttons
open their host-bound conversations; details show working and delivery paths.
Older hosts reject these new options until updated instead of silently ignoring
them. Changes in source do not update an installed host or desktop.

## Automatic integration recovery

Verified auto-merge tasks waiting in Review are reconsidered on host ticks, including
cards left by older hosts. A dirty/wrong-branch checkout or another pending merge
waits without a worker. Unchanged checkout failures have a persisted five-minute
backoff; changed branch heads or checkout state allow immediate retry. Merges into
one project are serialized. The host never stashes, resets or switches the owner's checkout.

A real merge conflict queues an integration correction in the retained task worktree.
The host merges the recorded base commit there, preserving both histories. Only
unresolved integration defects are handed to the worker; a clean base integration
goes straight to verification without a worker. Checks and review run again against
the updated base before delivery and dependent tasks start. Unresolved Git index
entries cannot be automatically staged as completed work. Integration corrections
have a separate persisted three-attempt limit and obey concurrency/daily limits.
Owner stops and unavailable acceptance checks remain stopped. A dirty task checkout
after review is retained for inspection rather than silently absorbed into recovery.

If the delivery branch has been replaced with an unrelated Git history, the host
detects this before merging. It validates that the recorded task base belongs to
the result branch, then flattens only the changes since that base into a replay
commit. A new task branch/worktree starts at the current delivery base and applies
that delta with a three-way cherry-pick. The original branch, worktree, base and
result commit remain retained in `historyRecovery`; old project history is not
merged into the replacement history. Clean replay proceeds to verification and
review; conflicts go to an integration correction worker. Dependencies remain
queued until successful delivery. This uses the same correction budget, owner
stop rules and scheduler limits as ordinary conflict recovery.

Replay preparation is persisted before Git changes the index, allowing a host
restart to continue from staged changes or unresolved conflicts. Missing or
unrelated recorded task bases and post-review edits in the original worktree
stop recovery with a concrete blocker instead of guessing or discarding work.
Retained original results are not automatically deleted after successful delivery.

If delivery succeeds but worktree removal fails, its path and cleanup error remain
on the done task. Later drafts are retained; removal is never forced.

A required review note may explicitly specify `category: "external"` plus an
actionable suggestion naming missing device/access and the check required. If all
current required findings are external, correction stops immediately, without
claiming acceptance or releasing dependencies. Mixed reviews still repair code.
Legacy prose is never guessed to be external. Identical required findings after a
correction stop further automatic retries as unchanged; moved source line numbers
do not count as a new finding. Existing location-only duplicates are coalesced with
their review links and conservative open/unread state retained.
In the same JSON block reviewers may provide `resolvedNoteIds` for earlier required
findings they actually verified fixed, even when another issue keeps the verdict
at FAIL. Merely omitting an old finding does not resolve it; a recurring finding
reopens it. This keeps obsolete defects from hiding the current acceptance blocker.

The detail panel records up to 20 review outcomes, each with worker-reported summary,
review verdict and worker/reviewer links. Old tasks cannot reconstruct missing run
history; their latest review remains available. Stop reasons distinguish external
verification, unchanged findings and exhausted attempts. Marking a note fixed does
not remove these verification requirements.

Hosts advertising `tasks.review-recheck` support `tasks.review.recheck`. The owner
can use **Recheck review** on blocked work with an existing failed review: checks
and the reviewer run against existing work, without launching a worker. A failed
recheck stays blocked; PASS uses the normal delivery/merge gates. Retry remains the
explicit action for a new worker correction after supplying access or changing the
approach. Independent queued tasks continue; dependent tasks wait for delivery.

Correction counts are stored with the task and survive host restarts. The board
shows the attempt number and the latest finding. For legacy tasks, after three corrections another
failure leaves the task blocked with its verification details; an explicit Retry
does not reset this allowance. Concurrency, daily usage limits and dependencies still apply.
Independent queued work can continue; dependents wait until the prerequisite is done.

For legacy tasks, three failed reviews since the last instruction change also stop the task, even
when finding wording changes or Retry previously reset the correction counter.
Legacy tasks recover this count from their retained attempt history. External-only
findings, unchanged findings, and a failed review-only recheck stop earlier.
The next host tick gives blocked verification failures one independent AI takeover
before asking the owner for help. The fresh session keeps the assigned model,
branch and worktree, and receives the original task contract, earlier outcomes,
remaining findings and blocker as a bounded JSON handoff. It must diagnose a
different approach, complete the work and pass the original checks plus review.
Takeover only starts from Blocked; owner stops, provider failures, missing verdicts,
cancelled goals and unavailable check processes are not automatically retried.
Concurrency, dependencies and daily budgets also gate takeover. Its durable marker
survives restarts; it cannot recursively hand off. Continuous work may keep correcting
after takeover while contents show progress. Three content-identical failed reviews
also stop continuous work even if the reviewer changes its wording.

If takeover still fails, the task shows **Needs input / Waiting for your
instructions** and **Update instructions** instead of Retry/Recheck. The recovery
agent is asked to leave one concrete request naming the missing resource or input.
The owner can change the description to explain a new approach, provide missing
evidence/access, or revise the requirement.
Renaming, whitespace edits, host restarts and moving through To do cannot bypass
the gate. Saving new instructions resets the budget without starting work; the
owner can then Retry or Recheck. Existing worktrees, findings and history remain.

Worker/runtime failures, owner stops, unrecoverable reviewer failures or missing verdicts, and
check timeouts or commands that cannot start remain blocked. Reviews distinguish
implementation defects from unavailable device/release/service acceptance checks,
while still requiring any evidence explicitly requested by the task.

For existing running or blocked goals, legacy review failures can recover once.
Recovery requires a matching successful reviewer session and its explicit FAIL
verdict. Cancelled goals, owner-stopped tasks, missing sessions and exhausted
correction attempts are not revived. Installing this host change is required for
the policy to affect tasks on that machine.

## Structured task briefs

New goal plans use a `bycoda.task.v1` brief with `objective`, `deliverables`,
`acceptance`, `constraints` and `verification`. The host stores the JSON as prompt
text for compatibility and sends workers/reviewers a task-contract envelope.
Cards display the objective; details render the brief as readable sections.
Legacy plain-text instructions remain intact. Unknown JSON fields are never
silently discarded. Hosts advertise automatic takeover with `tasks.blocked-takeover`;
the UI does not promise it for older hosts.

## Persistent review notes

Reviewers can return a `reviewNotes` JSON array before their verdict. Each entry
contains a `finding`, optional `suggestion`, and `kind` (`finding` or `suggestion`).
The host stores notes on the task before retrying it. Legacy FAIL reviews become
a summary note with their supporting review text when that session is available;
the latest trusted automatic-correction summary can also be retained without a
session. Missing or failed reviewer evidence is not invented as a code finding.

Cards and the board show unread counts. The detail panel offers Mark as read,
Mark fixed, Reopen note, and links to source review sessions. Read updates name
the displayed note IDs, leaving newer findings unread. These states live on the
host and survive retries, refreshes and host restarts. Older hosts remain usable
without note controls; updated hosts advertise `tasks.notes`.

Repeated findings with matching wording (ignoring case and whitespace) retain
their ID and source-session history. Reviewers are asked to reuse earlier wording.
A fixed finding that returns is reopened and unread. Open notes are included in
worker/reviewer prompts; optional suggestions are labelled as optional. PASS
closes existing required findings while retaining optional suggestions. Changing
a note's state never marks a task done, merges a branch or bypasses verification.
