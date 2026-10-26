# Coding workspaces and delivery

The worktree-first model gives each new coding session or task its own Git branch
and execution directory. The project remains the same project; edits, terminals,
checks and development servers run in the assigned directory. Existing `current`
sessions remain in their checkout until explicitly migrated.

This guide describes the managed-workspace contract. The contracts baseline
contains the existing manual worktree controls, not the complete new lifecycle,
delivery or Git rewind implementation. A connected Host must advertise the
required capability before a client offers its operation. Older Hosts need an
update explanation; creation failure must never send work into main silently.

## Starting and continuing work

Select the intended project and machine. The model resolves an explicit creation
choice before project policy and then the execution Host's default. New coding
work defaults to a worktree based on a resolved committed SHA. It does not copy
uncommitted work from another checkout. To depend on another session, use its
committed result and record that dependency.

The baseline composer already offers workspace/base selection for a blank
session. Settings → Workspace → Source control includes manual worktree
management. Policy, retention, storage and unified delivery controls belong to
the managed-workspace integration; their presence in a contract is not proof that
the installed app has them. Mobile sources are absent from this baseline, so its
mobile creation and recovery flow cannot be documented as implemented here.

The assigned branch is where the worker can commit its own coherent changes.
Review the branch and execution path before starting an independent writer.
Parallel writers need separate workspaces. Feature cards describe all affected
surfaces; live feature claims coordinate ownership across branches.

## Reviewing and delivering a result

Finished means implementation and its checks are ready for review. It does not
mean merged, installed or released. Review commits, paths, checks, screenshots and
blockers. Delivery review binds the source and target SHAs, workspace revision
and target working-state fingerprint. Changed source or target requires a fresh
review; stale approval cannot apply to a new result.

Only the authenticated owner UI authorizes integration merge, push or PR
publication. Persistent automatic-merge preferences need renewed approval. The
baseline task UI has legacy merge controls; these must be routed through the new
review contract before they satisfy this policy. Agent requests cannot provide
owner approval. A successful push followed by PR failure retains its push
receipt; inspect/reconcile the same operation before retrying.

Unrelated dirty target files are preserved. Overlapping staged, unstaged,
untracked or renamed paths block delivery. Resolve them with the owner; never
auto-stash, reset, clean or commit somebody else's files.

## Keeping and retiring directories

Workspace lifecycle and directory presence are separate. Default retention is
Never while active, 14 days for idle unfinished work, 7 days after finishing or
explicit abandonment, and 24 hours after verified merge. Every configurable
period supports Never; pinning disables automatic removal. Inactivity alone does
not abandon work.

Directory removal preserves the conversation, branch and recovery refs. Resume
rematerializes the retained branch. Dirty, unknown, locked or in-use state blocks
automatic removal. Removing a directory is separate from deleting a conversation
or branch. Unknown directories and main are never automatic cleanup targets.
On Windows, dependency links must be detached without following their targets;
unsafe links and blocked handles leave a recoverable blocked operation.

The default directory budget is 50 GiB, warning at 80%, with 20 GiB minimum free
space. Shared caches and Git recovery objects are counted separately. Pressure
can accelerate only already eligible safe cleanup. If that is insufficient, new
materialization pauses; it does not discard dirty work or unmerged branches.

## Rewind and Undo

Managed Git rewind restores the selected accepted user boundary's conversation,
branch HEAD, index and working copy together. Preview shows affected commits and
paths and capture blockers. Unsupported or incomplete capture cannot promise an
exact rewind. Settle provider execution, shells and editor buffers first.

Apply uses a short-lived reviewed plan, revalidates state, and preserves rescue
HEAD/index/worktree and transcript state before restoring anything. Changed
external state blocks the operation. Undo requires a fresh preview against that
rescue state; it does not overwrite later work blindly. Interrupted operations
block further writes until reconciled. Neither rewind nor Undo rewinds an already
merged integration branch or force-pushes published history.

The baseline conversation rewind does not provide this bycoda-owned Git
transaction. Its per-file checkpoint review/Undo is a separate operation with
shared-work and HEAD-change guards. Until `sessions.git-rewind.v1` is implemented
and advertised, treat conversation rewind as legacy/provider-dependent behavior,
not an exact branch/index/worktree restore guarantee.

## Knowing which build is visible

Before reporting a screenshot as a new defect, compare requested source with the
displayed app and responsive Host identities. A semver match or completion before
capture time does not prove inclusion across worktrees. Unstamped builds report
source identity unknown. The planned `build:status` comparison requires the
development-environment stream; it is absent from this contracts baseline.
See [Local updates](../local-update.md) for owner-directed packaging/installation
and [Managed workspace contracts](../reference/managed-workspaces.md) for RPCs,
recovery and the integration acceptance inventory.
