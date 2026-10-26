# Coding workspaces and delivery

The worktree-first model gives each new coding session or task its own Git branch
and execution directory. The project remains the same project; edits, terminals,
checks and development servers run in the assigned directory. Existing `current`
sessions remain in their checkout until explicitly migrated.
Clearing a conversation preserves that execution identity, including after restart.

This guide describes the integrated managed-workspace workflow. A connected Host
must advertise the
required capability before a client offers its operation. Older Hosts need an
update explanation; creation failure must never send work into main silently.

## Starting and continuing work

Select the intended project and machine. The model resolves an explicit creation
choice before project policy and then the execution Host's default. New coding
work defaults to a worktree based on a resolved committed SHA. It does not copy
uncommitted work from another checkout. To depend on another session, use its
committed result and record that dependency.

The composer offers workspace/base selection for a blank session. Settings →
Workspace → Source control includes managed workspace policy, retention, storage,
pinning and directory management. Review the selected execution Host and committed
base before creating work; missing Host support shows an update requirement.
The source includes these controls, but the installed app must still be compared
with its build stamp. The separate mobile repository is inventoried read-only in
`.agents/skills/feature-mobile/SKILL.md`; its source is not included in this branch.

The authenticated Host also enforces creation for older and direct clients: an
omitted workspace choice prepares an owned worktree. Current-checkout execution
requires an explicit choice. A contextual conversation gets an independent branch
even when its source is a legacy current-mode conversation. Interrupted legacy
tasks retain their recorded branch and directory outside automatic lifecycle
ownership until explicitly migrated.

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
task UI separates completion, finalization, approval, delivery and artifact state.
Use Review changes on the managed directory or task result to inspect delivery.
Agent requests cannot provide owner approval. A successful push followed by PR failure retains its push
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

Unsaved or unknown native editor reports also block removal and rewind. Fresh
reports settle only that app profile, process instance and window; reconnecting
one app cannot silently clear another app's buffers. Uncertain prior process
leases require explicit reconciliation, even after their process appears old.
Stale closed windows and earlier app instances can remain blocked until their
state is explicitly reconciled. Clean app exit retires an authenticated empty
buffer report. After restart, only empty predecessor reports from the same device
and client can be reconciled when the Host proves their process has exited.
Dirty or unknown reports continue to require explicit owner recovery.

Finished sessions expose Delete directory directly. The same guarded removal
preview and activity checks apply; the conversation, unmerged branch and recovery
refs remain available.

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

Managed Host sessions use the bycoda-owned Git transaction when
`sessions.git-rewind.v1` is advertised. Native sessions additionally require
`sessions.native-rewind.v1` and durable native transcript acknowledgement;
missing support leaves the operation unavailable. The integrated Host supplies
the trusted native protocol, while complete live native execution and crash
recovery remain separate acceptance checks. Reload discovers authoritative
operation state before recovering Undo. A timeout retains the existing operation
and write fence; it does not authorize retrying Git restoration blindly.
Native intent is saved before Host preparation. Restart reconciliation looks up
that same idempotency key, including when the app exited before saving its local
rescue record. An interrupted restore can reclaim only its own journaled Git
index lock after proving the former process dead and validating the restore
state. Unrelated Git locks remain protected.
If preparation was rejected before creating any Host operation, authenticated
reconciliation records a durable cancellation for that key before releasing the
native intent. Request a fresh preview afterward. Delayed requests with the old
key cannot recreate it; uncertain outcomes continue to hold the fence.
An expired preview explains why applying is disabled. Close it and request a
fresh preview before continuing.
Existing `current` sessions retain their legacy rewind confirmation. Per-file
checkpoint review/Undo remains a separate operation with shared-work and
HEAD-change guards.

## Knowing which build is visible

Before reporting a screenshot as a new defect, compare requested source with the
displayed app and responsive Host identities. A semver match or completion before
capture time does not prove inclusion across worktrees. Unstamped builds report
source identity unknown. General settings shows a compact source stamp and
copyable build details. Different source fingerprints at the same commit are
different builds; a dirty HEAD alone cannot prove that committed source was
included. `pnpm build:status` provides bounded, read-only comparison
of source, manifest, native and responsive Host identities without starting or
updating services. Isolated development uses `pnpm dev:native` with leased ports,
separate Host/desktop data and a copied run executable; `pnpm dev:shot` captures
source-stamped native evidence. A browser fixture is labelled separately.
See [Local updates](../local-update.md) for owner-directed packaging/installation
and [Managed workspace contracts](../reference/managed-workspaces.md) for RPCs,
recovery and the integration acceptance inventory.
