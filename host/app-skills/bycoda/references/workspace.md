# Projects, groups, explorer, Git, terminals, settings, panels

## Projects and groups
- A project is a folder in the left project rail. A project on a connected machine
  shows a globe icon and runs its sessions on that machine.
- A group is a named set of projects with its own header. The header shows Git status
  across its projects and can fetch them all. Right-click a group to hide it; restore
  it in Settings > Group privacy.
- Per-project options (rail context menu): icon, background, rename, additional
  directories, quick actions, remove.
- Owner-only: adding, grouping and removing projects. There is no agent tool for them.

## Explorer and files
- The Files view has a file tree and an editor. The editor shows inline Git diffs
  (stage or revert a chunk), blame and conflict bars. It also previews PDF, DOCX,
  spreadsheets, CSV, media and HTML.
- In chat, tool rows have Changes and output toggles that show the patch or result of
  that call.
- `files.list`, `files.search`, `files.searchContent` and `files.read` read the session's
  working copy with workspace-relative paths.
- `files.write` / `files.create` save through the editor service. Pass the hash from
  `files.read` as `expectedHash`. Your normal file tools also work.

## Git and checkpoints
- In the UI: the Changes panel, commit graph, branch picker, worktrees, stash, conflict
  editor and the Git actions menu (commit, AI commit message, merge, rebase, tags...).
- `git.index`, `git.fileDiff`, `git.branches` and `git.worktrees` are read-only.
- The owner commits, merges and pushes. Never do this without an explicit request.
- Checkpoints snapshot the working tree on each turn. `checkpoints.status` and
  `checkpoints.diff` show what this session changed. Undo/rewind is an owner action.

## Terminals
- Each project has a terminal dock. The shell profile is set in Settings > Terminal.
- `terminals.list`, `terminals.read`; `terminals.create` opens a dock terminal for this
  conversation; `terminals.close` closes only those.
- `terminals.write` sends exact bytes, so a trailing newline executes the command.
  It returns before the command finishes, so read the output afterwards.
- Use a terminal when the user should see or keep the process; use your own shell for
  quick checks.

## Settings (owner-only; open with `ui.workspace.open` view `settings` + `section`)
- App: `general`, `appearance`, `notifications`, `keybindings`, `groupLock` (group
  privacy).
- Workspace: `workspace`, `terminal`, `connections` (machines, phone), `worktrees`,
  `inbox`, `archive`.
- Agents: `crews`, `chat`, `providers` (accounts, sign-in, binaries), `usage` (budgets
  and limits), `mcp`, `skills`.
- About: `policies`.
- `providers.list`, `models.list` and `usage.sessions.read` are read-only views.

## Panels
- `ui.workspace.open` views: conversation, servers, notes, inbox, automations, tasks,
  social, search, settings, files, terminal.
- `ui.tools.open` tabs: devices, browser, servers, logs, resources (with `placement`).
- These wait for the window to acknowledge. If they fail, report it; do not claim the
  panel opened.
