# Source control review

A clean working tree shows a centered check icon above its empty-state message.
If a file is committed or restored while its diff is open, the comparison clears
and the editor keeps any unsaved text.
If the branch has diverged, the panel keeps the divergence message and uses a branch icon.

The sidebar's **Changes** tab opens source control. Its caption hides when the
icon and change counts need the available space. **Generate commit message**
and pull request text generation run on the Host that owns the selected remote
repository, using that Host's Git model routing and provider accounts. They never
fall back to a local provider when the remote Host is unavailable. Stopping
generation dismisses the pending result; the Host call retains its 90-second
provider deadline. Edited drafts and changed staged content remain protected.
The arrow beside **Generate commit message** opens the account and model picker
with **Reasoning** and **Fast** where the model supports them. Choosing an
account for the current provider or editing a model setting saves the model and
its options for the selected checkout. **Automatic** clears the commit-specific
choice. Remote checkouts list accounts and models from their own Host.

Linked workspace repository lists include every declared folder, including `.`
when the containing folder is itself a repository. Root and nested repositories
keep separate changes, commit drafts and action targets.

The Git panel reviews the worktree or repository selected in the sidebar header,
the only worktree selector. Its folder name, branch and full-path tooltip identify
that target. When checkout discovery fails, the current panel remains available with local
**Retry** and diagnostic details; a failed read does not establish an empty list.

A folder without Git metadata shows **Initialize Repository** in place of Git
actions, Stashes and Graph. The button runs `git init` there and is refused inside
an existing repository. In an overview, use a child repository row to see that
repository's Graph. A project opened on an empty folder outside any repository,
including one created by the assistant, a crew or a remote machine, is
initialized automatically.

**All repositories** (the default when a project has several worktrees) works like VS
Code's Source Control view: it lists a section for every worktree, and for each separate
repository inside an open one (such as `mobile`), all on the same level with no
indentation. Worktrees with uncommitted changes or commits waiting to be pushed come first
and start open; clean and unknown worktrees follow, collapsed. With none changed or ahead,
the session's worktree opens. A section header shows the bold name (the project name for
the project folder, the folder for another worktree), the change count, sync arrows, the
branch picker (open or collapsed, so each worktree switches its own branch here), and
refresh and a menu. Collapsed rows sit tight between their separator lines, and each
section's staged and unstaged files scroll within a capped height so the other worktrees
stay in reach. Each section's menu offers **Show only this repository** (remembered per
project) and **Show all repositories**. Rows carry no text markers such as "This session"
or "Separate repository"; hover for the path. The Changes tab badge is the sum of the
changed sections' counts.

The header picker scopes only the Changes panel and where new sessions start; the
Sessions list always shows every session of the project.

Remote projects use the same picker, with a server icon before the project icon.

The header picker is the repository list: **All repositories** with the total count, worktrees
with uncommitted changes first, then the project folder and other worktrees, and last
**Agent worktrees** (shown with an agent icon, no folder name), collapsed to **… N more**
after five rows. A worktree whose state could not be read shows no change count and is
never counted as clean. A panel keeps its own expanded state and commit draft when
collapsed or when you review another target.

Change totals update when the changed-file, added-line or deleted-line count changes.
Each machine loads a few summaries at a time, giving the selected checkout priority
over background summaries.

With one worktree selected, the Changes header is a single row: a `folder · branch`
picker leads, with refresh, worktree management and the Git menu at the end. The panel
has no Worktrees or Branches tabs. A branch checked out in another worktree appears under
**In a worktree** with a worktree badge; selecting it opens that worktree.

Deleting a worktree offers **Also delete branch**, off by default. It is available only
when the branch is fully merged; it is unavailable with unpushed commits or for the
default branch.

Each panel's staging, unstaging, commit and sync actions apply only to that exact
repository. A file with the same relative name in another checkout is a separate
target. A single review target shows its Stashes and Graph sections below its changes.
All repositories shows one Stashes and Graph below the rows instead
of one per row: Auto follows the repository you last used in the list, and the
selector in the Graph header shows the active repository even when collapsed and
switches to another repository. The full Commit graph offers the same selector;
when Graph is hidden, it appears above Stashes. Right-click an empty part of the Git panel to show or
hide Stashes and Graph in every panel, or to switch Auto Fetch. The Changes tab totals include discovered child repositories in All
checkouts and wait for every target's reading before showing a complete total.

In narrow Commit graph windows, reopening Branches keeps the commit inspector visible; the commit column yields space while branch and file controls stay reachable.

Repository discovery includes initialized submodules and independent repositories
inside the selected checkout, including ignored source folders such as a separate
`mobile` repository. It skips dependency/build directories and directory links,
including `.pnpm-store`, Python environments (`.venv`, `venv`, `__pycache__`),
generated `.artifacts` and `.local-data` trees. These trees do not consume the
discovery budget; explicitly selected repositories and initialized submodules
inside them remain accessible.
Discovery is bounded. When a scan reaches its size limit (files, folders, depth or
repository count), the repositories found so far stay listed and the panel shows
"Repositories found: N (scan limited)"; All-checkout change totals stay unknown
because they would be incomplete. A timeout or access error keeps the previous
inventory and offers Refresh rather than presenting an incomplete scan as an empty result.

When All repositories lists a submodule as its own row, the parent's change list
leaves out that submodule's pointer (gitlink) change and the submodule row shows it
instead, as Pointer changed or Pointer staged with a button to stage or unstage it in
the parent. The parent's change count and Commit still include the pointer. Choosing
only the parent repository lists the pointer as an ordinary change again.

Changes retain staged and unstaged sections and the saved list/tree presentation.
File rows expose the exact relative path. File names keep the same size and weight,
including repeated basenames; parent directories use smaller, secondary text.
A partially staged path can appear in both sections, so filter
results count staged and unstaged **entries**. With a filter active, bulk stage,
unstage and discard apply to the shown entries. **Open All Changes** opens the full diff.
Selected-entry actions retain their own narrower scope and existing confirmations.

Select a deleted-file row to inspect its deletion diff; opening the missing file
in an editor remains unavailable. Commits opened from file history or blame keep
the repository that was inspected, even when another checkout is active.
Changing the Git language updates labels in already-open diffs.

The **Changes** header has separate icons for **Open All Changes** and **Discard All Changes**,
alongside the filter, list/tree toggle and stage action. Bulk discard asks for confirmation.
Unstaged rows offer **Discard Changes** directly beside **Stage Changes**, as well
as in the file menu. Row actions appear on hover, keyboard focus or selection and
remain available on touch devices. Discard keeps its confirmation and selected-entry
scope. File names take priority over directory labels; added/removed line counts
stay together, and the full relative path is available on the file tooltip.
Each changes list is a single Tab stop: Up/Down/Home/End move between files and
folders, and Right/Left move across a row's open, Discard, Stage and More controls.

The commit field retains its checkout draft. Message generation remains cancellable
and allows staging. Commit variants are unavailable while generation is pending;
if the staged changes or branch move, the generated message comes with a reminder
to review it. If the draft changes during generation, **Use AI message** lets you
replace it with the generated message. Configure the commit and pull request generation model globally in
**Settings > Models > Background work > Who uses what**. The commit field keeps only the generate/cancel
action, without a separate model settings menu. Saved legacy checkout selections
remain available as a fallback when global model routing is unavailable. Account
selection is resolved when generation runs.

If pull request text can't be generated (signed-out provider, quota, timeout or an
unusable reply), **Create PR** stops without creating anything and shows a short
message with **Retry**. **Create with commit summary** publishes the branch's commit
list instead, only when you choose it; provider error text is not shown.

While there are changes, the main button is **Commit**: it commits what is staged,
or every change when nothing is staged (amending never adds unstaged files). It
never pushes. After a successful commit, the file list and Changes tab totals update
together while Git refreshes the full status. A regular commit on a tracked branch
also updates the outgoing commit count.
**Commit & Push** and **Commit, Push & Create PR** are in its menu.
Pending outgoing or incoming commits keep their own **Push**, **Pull**, **Sync
Changes** or **Publish Branch** button beside it. With nothing to commit, that sync,
Create PR or View PR action leads instead.
**Push** and **Publish Branch** send commits while sessions are running on a remote
Host. **Pull** and **Sync Changes** can update working files, so the remote Host
requires the project's sessions to be idle.

On mobile, **Changes** shows a short status when the working folder is clean.
Search and filters appear with changed files. An existing commit message is still
editable, and **Git actions > Commit message** opens the field to start a draft. **Push**
stays available when the branch has local commits to send to its remote.

Remote actions distinguish incoming and outgoing commits and display their upstream
destination. Existing publication, amend, conflict and destructive-operation gates
remain in force. Diagnostic **Details** retains raw output and the checkout path,
with explicit Copy, Notes and chat-draft actions. Replacing a diagnostic also replaces
its local pending/result feedback; an older completion cannot mark a newer error saved.

The diff toolbar's icon menu offers **Automatic**, **Inline** and **Side-by-side**.
Automatic follows the available surface width at the existing 900px breakpoint;
hidden zero-width surfaces retain their previous mode. Editor constraints can still
prevent a saved split choice from being rendered. A failed preference save keeps the
persisted selection and offers local retry. Diff consumers listen for changes from
other windows without creating another preference store.

Use **Add to chat** on a file or diff line comment to insert an inline reference
such as `build.mjs L20`. Select it in the draft to view or edit the comment.
Sent references open the saved comment, file path and source line.

## GitHub CLI

GitHub inbox items and pull request watches use the GitHub CLI (`gh`). bycoda installs a
pinned GitHub CLI automatically on first use when none is found. Signing in to GitHub is
still required: run `gh auth login` on this computer, or follow the message bycoda shows.
