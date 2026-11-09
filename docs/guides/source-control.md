# Source control review

Linked workspace repository lists include every declared folder, including `.`
when the containing folder is itself a repository. Root and nested repositories
keep separate changes, commit drafts and action targets.

The Git panel reviews the repository or checkout selected in its target picker.
Its folder name, branch and full-path tooltip identify that target. Workspace/session focus, the Git
review target and the checkout where an agent executes are separate choices.
When checkout discovery fails, the current panel remains available with local
**Retry** and diagnostic details; a failed read does not establish an empty list.

**All checkouts** shows the current checkout, other worktrees and discovered child
repositories as expandable changes panels. Folder names lead, branches remain
visible, and child repositories are indented beneath their checkout. The current
session's checkout starts expanded; each panel keeps its own expanded state and
commit draft when collapsed or when you review another target. Selecting a review
target does not change where the agent executes.

Each panel's staging, unstaging, commit and sync actions apply only to that exact
repository. A file with the same relative name in another checkout is a separate
target. Select one repository in the picker for its full history graph and stash
controls. The Changes tab totals include discovered child repositories in All
checkouts and wait for every target's reading before showing a complete total.

Repository discovery includes initialized submodules and independent repositories
inside the selected checkout, including ignored source folders such as a separate
`mobile` repository. It skips dependency/build directories and directory links.
Discovery is bounded; an access or limit error keeps the previous inventory and
offers Refresh rather than presenting an incomplete scan as an empty result.

Changes retain staged and unstaged sections and the saved list/tree presentation.
File rows expose the exact relative path and emphasize parent directories when
basenames repeat. A partially staged path can appear in both sections, so filter
results count staged and unstaged **entries**. Filtering changes the displayed list;
**All** operations still affect the entire repository, including hidden entries.
Selected-entry actions retain their own narrower scope and existing confirmations.

Unstaged rows offer **Discard Changes** directly beside **Stage Changes**, as well
as in the file menu. Row actions appear on hover, keyboard focus or selection and
remain available on touch devices. Discard keeps its confirmation and selected-entry
scope. File names take priority over directory labels; added/removed line counts
stay together, and the full relative path is available on the file tooltip.

The commit field retains its checkout draft. Message generation remains cancellable
and allows staging. Commit variants are unavailable while generation is pending;
if the draft or index changes, an obsolete generated result does not replace the
current draft. The generation settings control shows effective provider/model,
checkout override versus global/default selection, and provider-default account
provenance in optional details. Account selection is resolved when generation runs.

While there are changes, the main button is **Commit**: it commits what is staged,
or every change when nothing is staged (amending never adds unstaged files). It
never pushes. **Commit & Push** and **Commit, Push & Create PR** are in its menu.
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
