# Source control review

A clean working tree shows a centered check icon above its empty-state message.
If the branch has diverged, the panel keeps the divergence message and uses a branch icon.

The sidebar's **Changes** tab opens source control. **Generate commit message**
and pull request text generation run on the Host that owns the selected remote
repository, using that Host's Git model routing and provider accounts. They never
fall back to a local provider when the remote Host is unavailable. Stopping
generation dismisses the pending result; the Host call retains its 90-second
provider deadline. Edited drafts and changed staged content remain protected.
The arrow beside **Generate commit message** opens the model picker with the
selected model's supported effort and speed controls. The choice is saved per
checkout and applies to commit messages. **Automatic** clears the commit-specific
choice. Remote checkouts list models from their own Host.

Linked workspace repository lists include every declared folder, including `.`
when the containing folder is itself a repository. Root and nested repositories
keep separate changes, commit drafts and action targets.

The Git panel reviews the repository or checkout selected in its target picker.
Its folder name, branch and full-path tooltip identify that target. Workspace/session focus, the Git
review target and the checkout where an agent executes are separate choices.
When checkout discovery fails, the current panel remains available with local
**Retry** and diagnostic details; a failed read does not establish an empty list.

A folder that is not a Git repository shows no failure: the panel offers
**Initialize Repository**, which runs `git init` there and is refused inside an
existing repository. A project opened on an empty folder outside any repository,
including one created by the assistant, a crew or a remote machine, is
initialized automatically.

**All checkouts** shows the current checkout, other worktrees and discovered child
repositories as expandable changes panels. Folder names lead with the branch on
the same line; when the panel narrows the branch label shortens before the name.
Child repositories are indented beneath their checkout. A workspace with only one
repository shows its full panel, named in the picker, instead of a single row. The current
session's checkout starts expanded; each panel keeps its own expanded state and
commit draft when collapsed or when you review another target. Selecting a review
target does not change where the agent executes.

With one checkout selected, its header is a single row: the `folder · branch` picker
leads, with refresh, worktree management and the Git menu at the end. The picker has
**Worktrees** and **Branches** tabs, so switching checkout (or back to All checkouts)
and switching branch happen in one place.

Each panel's staging, unstaging, commit and sync actions apply only to that exact
repository. A file with the same relative name in another checkout is a separate
target. A single review target shows its Stashes and Graph sections below its changes.
All repositories and All checkouts show one Stashes and Graph below the rows instead
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
results count staged and unstaged **entries**. Filtering changes the displayed list;
**All** operations still affect the entire repository, including hidden entries.
Selected-entry actions retain their own narrower scope and existing confirmations.

Select a deleted-file row to inspect its deletion diff; opening the missing file
in an editor remains unavailable. Commits opened from file history or blame keep
the repository that was inspected, even when another checkout is active.
Changing the Git language updates labels in already-open diffs.

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
never pushes. After a successful regular commit, a tracked branch shows the
updated outgoing commit count while Git refreshes the full status.
**Commit & Push** and **Commit, Push & Create PR** are in its menu.
Pending outgoing or incoming commits keep their own **Push**, **Pull**, **Sync
Changes** or **Publish Branch** button beside it. With nothing to commit, that sync,
Create PR or View PR action leads instead.

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

## GitHub CLI

GitHub inbox items and pull request watches use the GitHub CLI (`gh`). bycoda installs a
pinned GitHub CLI automatically on first use when none is found. Signing in to GitHub is
still required: run `gh auth login` on this computer, or follow the message bycoda shows.
