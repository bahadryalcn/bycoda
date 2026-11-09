# Sidebar footer decision provenance

## Settle instead of close

Owner decision, 2026-11-08:

> I think we should fully move to the reference app's approach, settle (translated)

Sessions follow the reference app's settle model instead of the earlier close/reopen lock.
Settling is a list state owned by the Host lifecycle record: settled sessions move
to the Settled group, stay writable and become active on their next message. A
settle requested during a turn applies when it ends; a failed turn or queued
follow-up leaves the session active. Idle sessions auto-settle after a Host
setting (default three days) unless pinned, archived, running, queued, waiting
for input or un-settled since their last message. Settling never changes archive,
pin, folders, reminders or linked tasks.

## Delegated conversation visibility

Owner decision, 2026-11-06:

> you currently open advisors as a session in the session list too; you need to fix this as well. Look at how Claude does it and let us manage this in bycoda in a similar and better way. (translated)

Advisors and subagents belong to their verified parent's activity panel. Ordinary
conversation lists, search and workspace tabs exclude them. This is presentation
policy: child execution, approvals, questions, drafts and completed history remain
available through their original owners.

2026-10-27, interactive reference session `064a143a-3f73-4dc2-bad5-2ad397af3d41`,
as recorded in the previous sidebar card:

> in bycoda I want the update and this to appear at the same time; at the bottom left, after updating, if it was not dismissed it should stay. (translated)

The repository link and update notices can coexist. Preserve version-scoped
repository dismissal, the remaining available-update action and explicit dismissal
of installed-update notices. Reading release notes is not dismissal. This is
historical behavior provenance, not permission to install or publish an update.

## Transcript conversation layout

Owner decision, 2026-11-05, confirming the 2026-11-04 Arif chat direction. Recorded decision: agent and coding sessions use the transcript layout. It has a full-width reading column, user prompts as distinct blocks, and tool and command steps as single-line summaries with details on demand. Active work and approvals stay visible. It has no bubbles and no alternating alignment. The messaging layout is recorded in feature-assistant decisions.

## Project session list order

Owner decision, 2026-11-07:

> okay, but if interrupted, failed or done, these are actions and need to go to the top. If there are drafts they can stay on top too. It may become hard to find things, so please think about that as well. (translated)

Unpinned rows outside folders always follow last activity; a saved `loose` order is
not applied, so an old drag cannot freeze the list. Pins and folders keep their
hand-made order. Inside every group, status leads: input or approval, then failed or
interrupted, then unseen finished, then working, then drafts. Failed, interrupted and
draft rows lift only within three days of their last activity. The open row keeps its
Done place until the user leaves it, and a row being typed in does not move.
