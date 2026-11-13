# Tasks: progress and recovery

List view scrolls through all loaded tasks without numbered pages. Bulk selection
and the open task remain selected while offscreen rows are recycled. Search and
project, sprint and status filters retain their own list position.

Tasks opens on the current project's Host. Select All projects to include other machines. A remote machine being unavailable does not mean a successfully read local task list failed. Connection details and optional data warnings describe the affected source; Retry refreshes the selected scope.

Local project options can appear while other sources are still loading. Sprint data appears as soon as its planning Host answers; source history synchronization can continue afterward. Actions that require current history still wait for that synchronization. Repeated refresh ticks do not accumulate an unlimited queue.

## Model selection

Tasks, epics and stewards choose **Default**, **Pool** or **Fixed** for each model
role. Default follows the matching role in **Settings > Background work**. Pool uses a
named ordered subset; Fixed keeps the selected model. **Manage models** opens
the shared Work order and limits. Workers, reviewers and planners resolve when their
run starts; changing settings never switches an existing session. If every model
is skipped, pending work waits for eligibility. See [Models](models.md).

## Understanding progress

- **Queued** means the request is saved. Start requests scheduler admission; it does not promise that a worker has launched. Dependencies, concurrency and budgets still apply.
- **Running** means the worker is active. A lack of recent output is a diagnostic, not proof that the process stopped.
- **Verifying** means configured checks or review are running. Review findings remain attached to the attempt.
- **Completed with open findings** preserves unresolved findings for owner review. It does not mean checks passed, delivery was approved, or a release occurred.
- **Blocked** requires attention to the stated reason. Owner stops, permissions, credentials, budgets, unsafe preparation and repeated runtime failures remain real stops. These gates are not bypassed to make a board look successful.

Automatic correction is bounded. Repeating an unchanged failed check stops another identical repair cycle. A reviewer that omitted its final result may receive bounded follow-up requests in the same review session; the worker is not restarted just to obtain a verdict. External checks and exhausted correction retain their findings and owner approval requirements.

A review with acceptance criteria is bound to the working-copy contents it inspected. In a shared checkout it waits while another task's worker is still writing there. If the contents still change during the review, the stale verdict is discarded and the current contents are reviewed again, at most twice; a third change blocks the task with that reason.

An epic runs only the reviews its plan needs. A plan with one task skips the final epic review, because that task's own review already covered the whole job. When the planner marks a small, low-risk job as simple, its tasks run their configured checks without a separate reviewer. Neither rule adds a review you turned off.

An epic is a planned outcome split into tasks for owner approval. Existing saved goal records and Host API identifiers continue to work. Codex's native `/goal` command remains a separate conversation capability; it does not create or approve an epic.

## Retry safely

Automatic correction allows one repair, after a configured read-only advisor has
returned advice. A second failed review keeps its findings for owner review.
Transient worker failures retry once. Missing advisor access or incomplete advice
leaves the task waiting with its reason; it does not silently skip consultation.
Capacity waits and advice taking more than one minute retain the same queued
consultation across scheduler ticks. The repair allowance is consumed only after
nonempty successful advice.
Under Advanced, **Allow subagents** enables Automatic delegation; disabling it
keeps subagents off for that task, including after changing its model.

Eligible blocked tasks offer **Finish with findings** in card actions and task
details. This retains the failed review and notices, and grants no delivery approval.
Stopped, unauthorized and resource-blocked work cannot use this action. Machine
concurrency accepts any positive safe integer; the configured global limit still applies.

If creating a task loses its reply, keep the draft and retry it. The draft retains its creation identity and checks the original Host for the existing task before another save. If the original result is still unknown, resolve it on that project and machine before changing the target. Closing the draft and creating a separate new one is a new request.

A failed limits refresh means usage is unknown or last known, not zero. Existing Host budget enforcement remains active. Read the task's reason before retrying a blocked operation, and use the recorded task for recovery rather than creating duplicates.

Daily agent time uses confirmed run intervals and the Host's local calendar day. If an interval cannot be measured, usage is marked incomplete and new limited work waits; this does not mean the limit was reached. Running work can still finish. Sprint reports mark history as incomplete when older task events are no longer available, and refresh the affected source from its current snapshot.

Completion, review, delivery, installation and release are separate. Task results and retained branches still use the existing owner delivery approval workflow.
