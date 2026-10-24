# Sessions, tasks, goals, crews, notes, automations, stewards

## Sessions
- A session is one conversation with a provider (Claude, Codex, Cursor, OpenCode, Grok
  and others) in a project. Sessions run on the host and survive closing the app.
- `sessions.list` / `sessions.read` read other conversations in this project, a few
  exchanges per page; page older with `nextBefore`. They are read-only.
- Owner-only UI: provider handoff, message queue edits, rewind to a checkpoint,
  compact, account switching.

## Tasks
- Tasks are tracked work units with a worker and, by default, a reviewer. They appear
  in the Tasks view.
- `tasks.create` (`taskId`, `title`, `prompt`; optional `dependsOn`, `verifyCommand`,
  `status` `todo` or `queued`). Use `tasks.start` for a task left in `todo`, then poll
  `tasks.get`.
- Tasks created here run in the shared checkout (direct mode). The owner reviews and
  commits the diff. Isolated worktree tasks and auto-merge are chosen in the UI.
- When a task is blocked, read `tasks.session.read` / `tasks.notes.read`.
  - `tasks.review.recheck` reruns checks and review on the existing work.
  - `tasks.retry` launches a new correction run.
- You cannot merge, delete, mark done, or change your own running task.
- `tasks.delete`, `tasks.transfer` and `tasks.notes.resolve` require a current
  `expectedUpdatedAt` and native owner approval of the exact operation. Delete
  preserves unmerged branches by refusing their deletion. Transfer accepts an
  existing `targetProjectId` only for independent, unstarted to-do work; goal,
  steward, crew, dependency and retained-work tasks cannot move. A task moved to
  another project is no longer accessible through the old project's grant.
  Note resolution changes one note's acknowledgement, not review/check results.

## Goals
- A goal is a planned outcome that is split into tasks. `goals.create` makes a plan;
  the owner approves it and starts its tasks. Read with `goals.list` / `goals.get`.

## Crews
- A crew is a team definition: a coordinator plus member agents with roles, models and
  file scopes. Users manage them in Settings > Crews.
- Flow:
  1. `crews.schema`, then `crews.inspect`, then `crews.save` (project scope).
  2. `crews.start` (`definitionId`, `prompt`, `requestId`).
  3. As coordinator, `crews.assign` work to members. Then `crews.get`, `crews.accept`
     each result, and `crews.finish`.
- Only the coordinator assigns, accepts, pauses or finishes. Members use `crews.request`.
- Overlapping file scopes run one after another. Several component assignments need a
  final integration assignment that depends on them.
- Acceptance never authorizes commits, pushes or publishing.

## Notes
- Project notes live in the Notes view. Use them for findings, decisions and handoff
  context that other sessions should see.
- `notes.create` (your own unique `id`, `body`, optional `title`/`tags`). Pass
  `expectedUpdatedAt` from a read to `notes.update` and `notes.delete`.

## Automations
- Scheduled agent runs. `automations.create` needs `automationId`, `name`, `prompt`
  and `scheduleKind`:
  - `hourly` takes a `minute`.
  - `daily` and `weekdays` take a `time` ("HH:MM").
  - `weekly` takes `time` and `dayOfWeek` (0-6).
  Times are in the host's local time. There are no cron strings or event triggers.
- `automations.runNow` to test; verify with `automations.runs`. Pause stops future runs
  only; `stopRun` stops an active run.

## Stewards
- A steward is a scheduled project caretaker that proposes tasks. It never auto-starts
  or auto-merges them when created from a conversation. Use `stewards.*` with
  `expectedUpdatedAt`.
- `stewards.delete` requires its active run to have settled and preserves board
  tasks. `stewards.decline` takes `taskId`, the steward's revision and
  `expectedTaskUpdatedAt`; it removes only a matching unstarted to-do proposal
  and remembers its title to avoid proposing it again. Dependent work blocks it.
