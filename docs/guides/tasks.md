# Tasks: progress and recovery

List view scrolls through all loaded tasks without numbered pages. Bulk selection
and the open task remain selected while offscreen rows are recycled. Search and
project, sprint and status filters retain their own list position.

Tasks opens on the current project's Host. Select All projects to include other machines. A remote machine being unavailable does not mean a successfully read local task list failed. Connection details and optional data warnings describe the affected source; Retry refreshes the selected scope.

Local project options can appear while other sources are still loading. Sprint data appears as soon as its planning Host answers; source history synchronization can continue afterward. Actions that require current history still wait for that synchronization. Repeated refresh ticks do not accumulate an unlimited queue.

## Understanding progress

- **Queued** means the request is saved. Start requests scheduler admission; it does not promise that a worker has launched. Dependencies, concurrency and budgets still apply.
- **Running** means the worker is active. A lack of recent output is a diagnostic, not proof that the process stopped.
- **Verifying** means configured checks or review are running. Review findings remain attached to the attempt.
- **Completed with open findings** preserves unresolved findings for owner review. It does not mean checks passed, delivery was approved, or a release occurred.
- **Blocked** requires attention to the stated reason. Owner stops, permissions, credentials, budgets, unsafe preparation and repeated runtime failures remain real stops. These gates are not bypassed to make a board look successful.

Automatic correction is bounded. Repeating an unchanged failed check stops another identical repair cycle. A reviewer that omitted its final result may receive bounded follow-up requests in the same review session; the worker is not restarted just to obtain a verdict. External checks and exhausted correction retain their findings and owner approval requirements.

## Retry safely

If creating a task loses its reply, keep the draft and retry it. The draft retains its creation identity and checks the original Host for the existing task before another save. If the original result is still unknown, resolve it on that project and machine before changing the target. Closing the draft and creating a separate new one is a new request.

A failed limits refresh means usage is unknown or last known, not zero. Existing Host budget enforcement remains active. Read the task's reason before retrying a blocked operation, and use the recorded task for recovery rather than creating duplicates.

Daily agent time uses confirmed run intervals and the Host's local calendar day. If an interval cannot be measured, usage is marked incomplete and new limited work waits; this does not mean the limit was reached. Running work can still finish. Sprint reports mark history as incomplete when older task events are no longer available, and refresh the affected source from its current snapshot.

Completion, review, delivery, installation and release are separate. Task results and retained branches still use the existing owner delivery approval workflow.
