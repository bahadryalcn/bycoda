# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.65]

### Host tools and session workflows

- Expand conversation tools for projects, files, browsers, servers, tasks, goals and crews, with bundled application guidance.
- Improve contextual handoffs, second opinions, note context and session recovery.
- Strengthen reviewed desktop actions, Inbox integration and host access controls.
- Refine provider discovery and process handling, and remove the legacy Gemini CLI integration.

### Workspace and connections

- Improve SSH terminals, server workflows, project navigation and crew controls.
- Refine shared controls, transcript presentation, usage analytics and translations.
- Expand regression coverage across host tools, native bridges and workspace interactions.

## [0.6.64]

### Terminal and connection workflows

- Improve SSH environment detection, shell integration and remote terminal behavior.
- Refine terminal tools, remote suggestions and the Servers terminal workspace.

### Workspace and session reliability

- Improve checkpoint recovery, session synchronization and transcript rendering.
- Refine crew controls, project quick actions and source-control review panels.
- Improve window controls, session navigation, shared settings and translations.
- Expand regression coverage for the updated native, host and desktop workflows.

## [0.6.61]

### Providers

- Stop background model discovery from launching the legacy Gemini CLI, which could repeatedly open a browser sign-in on Windows, macOS and Linux. Hosts without Gemini sessions no longer probe it; individual Google accounts continue to use Antigravity CLI.
- Orchestration and provider settings no longer start Gemini CLI automatically; its models load when the model list is opened.

### Host and connections

- Run host services from a stable Node engine path so firewall identity survives host updates, with safe replacement and rollback.
- Share project colors, icons and logos with mobile and remote clients after privacy filtering.
- Improve the local update installer's engine handling and regression coverage.

## [0.6.60]

### Session and host reliability

- Improve shared queues, message delivery recovery, session renaming and remote session adoption.
- Strengthen checkpoint leases, configuration conflict handling and background task coordination.
- Improve provider cancellation, skill-policy handling and automation recovery.

### Workspace, connections and content

- Refine server management, SSH forwarding, terminal tools and connection status feedback.
- Improve project navigation, editor save handling, transcript selection and search.
- Strengthen note image handling, file access safeguards and project logo processing.
- Improve crew controls, Inbox notifications, shared preferences and translations.
- Include expanded regression coverage and updated CI documentation.

## [0.6.56]

### Connections and workspace reliability

- Improve remote session discovery, reconnection, adopted-session recovery and shared request queues.
- Show connection recovery progress and feature-specific errors in Servers and remote sessions.
- Improve editor save handling, remote file operations and SFTP transfer recovery.

### Source control

- Improve Git mutation ordering and selected-file staging, including index-state refresh and optimistic updates.
- Keep source-control panels synchronized after focus changes and file operations.

### Skills and providers

- Add per-provider skill policy controls and preferences with consistent provider capability reporting.
- Improve skill discovery, CLI command catalogs and model catalog caching.

### Editor and terminal

- Add workspace editor preferences and improve terminal suggestions, restoration and workspace tab behavior.

### Termius migration

- Import local Termius desktop servers from the Servers actions menu with searchable previews and bulk selection.
- Preserve names, addresses, users, ports, groups and tags, and skip connections already present in the inventory.
- Optionally migrate linked SSH private keys into protected local files without exposing their contents to the interface or logs.
- Show unsupported routing settings for review. Saved passwords, port forwards and snippets are not imported.

## [0.6.51]

### Editor tabs

- Add context-menu actions to close tabs to the left or right of the selected editor tab.
- Keep close and close-others actions together, disable unavailable directions, and preserve unsaved-file and terminal confirmations.

### Editor readability

- Add indentation and bracket guides, comment annotations, color swatches and inline diagnostics to code and conflict editors.
- Improve CSS variable completion and tag matching, with expanded editor selection coverage.

## [0.6.50]

### Crews

- Add reusable crews with coordinator, specialist and reviewer conversations, host-managed assignments and independent review.
- Configure member models, capabilities, budgets and project scopes, and inspect requests and assignment state from Sessions and Tasks.

### Connections and synchronization

- Improve desktop connection state, remote change refresh and automatic recovery controls.
- Reduce large synchronization outbox processing overhead and avoid redundant persistence for unchanged pull results.

### Workspace

- Refine workspace actions, terminal controls, project navigation and shared expanding action groups.
- Improve working-session indicators, approval notices and Star Wars crew animation.

## [0.6.46]

### Remote communication and recovery

- Retry failed conversation content reads automatically even when the host reports no new revision, preserving unsent drafts.
- Keep the content error visible while an automatic retry is waiting to run.
- Wake the shared session and task notification channel when the connection returns, the network comes online or the app regains focus.
- Refresh connected machines and library synchronization on app wake, coalescing overlapping discovery requests.
- Clear library sync backoff after verified host recovery while preserving request spacing and independent failure backoff for other machines.

## [0.6.43]

### Source control

- Stage, unstage and discard selected files in batches, preserving unrelated staged work and literal filenames.
- Serialize Git mutations across repository aliases and linked worktrees, with bounded lock retries and deadlines for local and remote operations.
- Preserve external Git locks and report failed conflict and safety checks instead of treating them as empty results.
- Correct rename unstaging and conflict inspection for filenames containing wildcard characters.

### Conversation queues

- Show loading, acceptance and actionable errors for Resume, Send next and Steer, and prevent duplicate queue actions.
- Resume paused queues during running turns and send restored messages through the normal acceptance path.
- Recover synchronization errors on the first retry and retain queued messages until the host acknowledges delivery.
- Keep Stop authoritative while Resume or Steer is preparing, and preserve rejected messages for recovery.

## [0.6.40]

### Terminals and workspace

- Add local command and history suggestions with inline ghost text and bounded native completion discovery.
- Refine server terminal sessions, terminal layouts and keyboard interactions.
- Extend native tool-window routing and improve workspace navigation and window controls.

### Editing and appearance

- Improve notes navigation and layouts, editor search controls and Windows replace shortcuts.
- Keep code highlighting aligned with the selected theme across editors and conversation code blocks.
- Refine shared controls, appearance previews and surface motion across the application.

## [0.6.39]

### Source control

- Clarify merge, rebase, cherry-pick and revert conflicts with branch and commit details.
- Accept either side across a file in one undoable action while preserving manual edits.
- Simplify conflict actions and layout controls, including narrow layouts and Turkish labels.
- Refresh local changes when returning to or interacting with the Git panel without discarding pending optimistic changes.

## [0.6.38]

### SSH identities

- Choose private SSH key files directly with Finder or File Explorer in server, group and jump-host settings.
- Search discovered keys by name or full path, distinguish matching filenames and inspect public key details.
- Refresh available keys without losing edits, return to SSH defaults, and recover from file-picker errors with manual path entry.

## [0.6.37]

### Servers and SSH

- Refresh the server workspace layout and consolidate SSH settings, identity selection and config imports.
- Refine server activity, files, forwards, snippets, organization and runbook controls.
- Improve narrow layouts and retain server workspace state across navigation.

### Terminal tools

- Show local command suggestions at the terminal cursor using the current visible shell prompt.
- Insert command completions without executing them or storing input history.
- Refine remote suggestions, search controls and keyboard interactions.

## [0.6.36]

### Reliability and workspace

- Preserve attachment ownership across remote reconnects, closed windows and host recovery.
- Protect unsaved editor changes during file and window close; bound PDF rendering memory.
- Improve SSH identity handling, server tools, forwards and remote session recovery.
- Stabilize Windows host diagnostics and service shutdown, provider limits and response timers.
- Refine terminal search, task previews, social interactions and shared inline editing.

### Release builds

- Prepare shared optimized Rust dependency caches on the default branch so release tags can reuse them.
- Verify Windows host diagnostics and upgrade recovery before building release packages.

## [0.6.35]

### Reliability and recovery

- Preserve queued messages, attachment readers, drafts and partial provider responses across limits, cancellation and recovery.
- Correct remote file identity, content search, Git history, submodule discovery and filesystem collision handling.
- Keep automation schedules and usage totals correct through daylight-saving transitions, including half-hour changes.
- Report PDF page failures with page-specific retry and keep nested Agent App sessions addressable.
- Bound runtime diagnostic capture without enumerating arbitrary objects; identify omitted fields and support explicit field/value arrays.

### Workspace and shared controls

- Open workspace tools in the current window and keep a single set of window controls in detached workspaces.
- Improve keyboard navigation, focus handling, responsive recovery actions and large message queues.
- Respect date picker bounds and preserve literal Markdown code during attachment edits.
- Include accumulated host, provider, workspace, settings and shared UI fixes with expanded regression coverage.
- Include SSH connection, reviewed execution, proxy, runbook and file-transfer improvements.

## [0.6.25]

### Workspace, sessions and automation

- Improve workspace navigation, keyboard shortcuts, session status and update handling.
- Refine composer controls, attachment previews, transcript search and terminal tools.
- Expand automation setup, workspace activity and task session previews.

### Shared controls and social workflows

- Improve question forms, recovery surfaces, loading indicators and theme transitions.
- Refine social setup, filtering, campaigns, publishing plans and inbox layouts.
- Refresh translations, contributor issue forms and regression coverage.

## [0.6.21]

### Response speed indicator

- Fill the speed bolt in four bands based on the last completed response's average TPS, independently of context usage.
- Keep the bolt outlined when speed is zero or unavailable, and explain the speed scale in the context details.
- Preserve compact actions, keyboard access, both themes and reduced-motion behavior, with expanded regression coverage.

## [0.6.20]

### Reliability and data preservation

- Preserve unsaved note drafts through failed saves and reconcile external note updates without silently overwriting local edits.
- Drain in-flight composer draft writes and retain failed writes for retry.
- Preserve repeated provider stream deltas and restored remote queue holds; enforce queue limits when editing messages.
- Keep active automation runs and daily limits reliable beyond displayed history, and retain input-needed state when overlap is skipped.
- Preserve concurrent remote saves and Unix file permissions; enforce busy-project guards for stash operations.
- Correct remote search, recursive filters, untracked-file coverage, path containment, worktree locks and Git diff accounting.
- Keep overnight frequency campaigns on schedule and reject frequencies that exceed minute-level scheduling capacity.

### Workspace and shared controls

- Refresh inline editors after cancellation and preserve drafts during IME composition.
- Run file-preview regular expressions outside the UI thread with bounded execution and cancellation.
- Restore native radio-group and disclosure keyboard traversal in modals; cancel slider gestures when disabled.
- Centralize image-preview action layout and review shared UI ownership boundaries.
- Include accumulated settings, usage, connection, workspace, transcript and host-tool improvements with expanded regression coverage.

## [0.6.13]

### Recovery controls and synchronization

- Keep the recovered-session control compact beside search.
- Omit deleted worktree paths from remote file pickers.
- Avoid shared queue conflicts caused by JSON key ordering.

## [0.6.12]

### Workspace rail and recovery controls

- Place recovered-session access beside search and working sessions below workspace tools.
- Distribute workspace tool actions across the available rail width.
- Keep recovery controls compact and readable in narrow layouts.
- Update maintainer attribution and rail regression coverage.

## [0.6.11]

### Session previews and workspace navigation

- Reuse session preview tabs while preserving drafts, active work and intentional layouts.
- Refine recent sessions, pinned-session limits and workspace navigation.
- Improve title bar actions and update notifications.
- Improve transcript layouts, local media previews and diff presentation.
- Refresh translations and expand browser regression coverage.

## [0.6.1]

### Search, notes and workspace controls

- Improve global search navigation, result previews and keyboard shortcuts.
- Keep note editor toolbars visible and improve split-view scrolling.
- Refine workspace tool navigation, sidebar renaming and activity controls.
- Improve attachment links, image previews and shared control behavior.
- Keep preview dialogs centered within the viewport across browser engines.
- Polish appearance settings, translations and browser regression coverage.

## [0.6.0]

### Desktop controls and workspace

- Unify workspace, settings and tool panels around shared Arc controls.
- Expand accessible menus, search, selections and form controls with consistent interaction states.
- Refine session composition, conversation clearing and transcript recovery.
- Improve host session storage, remote projects and workspace feedback.
- Expand UI boundary checks and browser coverage for the shared design system.
- Render project-local Markdown images safely and preserve native text context menus.
- Improve provider model discovery, deleted-worktree recovery and literal Git file paths.

## [0.5.95]

### Workspace and session tools

- Add usage budgets, a guide hub and subagent relay controls.
- Improve remote session synchronization, change notifications and repository selection.
- Refine shared controls, search, notes and Inbox views.
- Refresh automatic update checks without cached responses.

## [0.5.90]

### Host tools and workspace

- Add HTTP transport and external access controls for MCP tools.
- Add host-managed terminals and performance measurement tools.
- Improve session rendering, editor behavior and host recovery.
- Refine device and host tool panels, appearance settings and live backgrounds.

## [0.5.82]

### Source control

- Show nested submodule changes in source control.
- Improve GitHub review access and remote Inbox routing.
- Refine local host recovery notices and shared search controls.

## [0.5.81]

### Workspace controls and diffs

- Reuse shared Arc controls for branch creation and Markdown view actions.
- Synchronize diff view zoom and keep editor find controls visible.
- Improve split diff row alignment and visible content calculations.

## [0.5.80]

### Workspace and performance

- Improve workspace navigation, file opening and drag-and-drop handling.
- Refine conversation rendering, translations and session persistence.
- Expand shared query caching and optimize rendering and syntax highlighting.
- Improve task handoff, usage reporting, fullscreen controls and settings.
- Consolidate the current source into a single initial commit.

## [0.5.78]

### Conversations and workspace

- Add animated conversation backgrounds with configurable appearance settings.
- Improve merge conflict layout and result editing actions.
- Preserve remote conversation state when adopting and synchronizing sessions.
- Refine sidebar renaming, session filters and translated interface labels.

## [0.5.77]

### Conversations and workspace

- Add conversation rewind with native and replay-based provider strategies.
- Isolate provider environments by account and improve account authentication.
- Refine workspace layout, session ordering, project groups and checkout controls.
- Prioritize sidebar sessions by status and animate their position changes.
- Preserve editor focus when navigating changed files and refreshing change lists.
- Improve merge conflict resolution, bounded task output access and local updates.

## [0.5.72]

### Tasks and workspace

- Preserve task artifacts and safely clean up delivered worktrees.
- Add editable goal settings and workspace window routing.
- Refine checkout controls and provider account authentication.

## [0.5.71]

### Workspace and integrations

- Expand social programs with scheduling, image support and publishing controls.
- Add translation actions for conversation, composer and terminal selections.
- Refine shared controls, settings, onboarding and editor search interactions.
- Improve provider recovery, workspace checkpoints and session synchronization.

## [0.5.70]

### Devices and workspace

- Add staged Expo device previews, device controls and reconnect-safe remote support.
- Expand Arc controls across the application and unify shared theme colors.
- Refine device panels, host tools and responsive workspace interactions.

## [0.5.69]

### Workspace and chat

- Add session-owned workspace checkpoints for tracking and restoring conversation changes.
- Run tasks and goals directly in the selected checkout with explicit workspace controls.
- Refine Arc form controls, settings, task history and source-control interactions.
- Improve image zoom, trackpad gestures and animated workspace ordering.
- Separate AI questions from accepted user answers and preserve their attribution in saved conversations.

### Fixes

- Wait for steward turn and checkpoint cleanup before removing its checkout.

## [0.5.68]

### Workspace and chat

- Inspect saved tool output and code changes, preview chat documents and media, and open connected files and development servers through their owning host.
- Navigate application screens and place Conversation Tools through the session-scoped application API.
- Browse usage for each provider account without changing the account selected for the conversation.
- Runtime logs start reading when opened and keep capture controls, source filters and severity filters beside the stream.
- Expand Star Wars character performances and keep the crew on a readable crescent as helpers join.
- Improve editor navigation and formatting, Notes dialogs, workspace tabs and conversation hints.

### Fixes

- Preserve restored tool details and structured Codex results, and align remote file command discovery with the host.
- Canonicalize temporary transfer-test paths on macOS and Windows and allow the exhaustive motion test enough time on shared CI runners.

## [0.5.67]

### Workspace and chat

- Inspect saved tool output and code changes, and preview chat documents, tables, audio and video.
- Browse connected folders through temporary read-only access, open bounded local file copies, and access remote development servers through the paired host.
- Navigate application screens and place Conversation Tools through the session-scoped application API.
- Improve editor navigation, selection and formatting, Notes dialogs, workspace tabs and conversation hints.

### Fixes

- Preserve restored tool details and structured Codex results, and update transcript tests for compact successful calls.

## [0.5.66]

### Fixes

- Tests updated for session recovery, notification project names, the compact project rail and Codex reconnect status; all CI checks pass again.
- Connection handling refinements.

## [0.5.65]

### Workspace

- Choose a crew theme for the agent crew shown in new tasks and behind conversations; each character fills with color as its context fills.
- Diagnostics keep a sample history.
- Session recovery, the project rail, tasks, automations and conversation tools have further refinements.

## [0.5.64]

### Fixes

- The Windows host service no longer stays stuck after the host exits, so host updates and automatic restarts complete reliably.
- Session recovery and the project rail have layout and interaction refinements.

## [0.5.63]

### Host tools

- Connect devices to a conversation: connected Android and iOS devices are detected automatically, and their screens can be viewed and controlled.
- Capture website logs with active website monitors, and keep browser control clear about who holds it.
- Add an HTML file to a conversation as an interactive preview, or ask the agent to create a chart, diagram or prototype.
- Diagnostics show how much memory and CPU the host uses, and automatic refresh pauses after repeated failures.

### Sessions

- Session filters and hints in the session list.

## [0.5.62]

### Sessions

- Recover previous sessions from one list that shows which need attention and hides completed or idle ones; opening a session does not restart its work.
- Filter sessions and create a new branch from a chosen starting point.
- Provider reconnects show a temporary "Retrying" status and notification instead of a failure, and stay out of the transcript.

## [0.5.61]

### Tools and logs

- Open runtime logs as a separate panel or in a new window, and open all workspace tools together in one window.
- Monitor browser logs for a project source, port or URL, and watch every source in a project or computer at once.
- Choose where tool panels are placed in the layout.

### Notes

- Filter notes by project or tag, group and sort them, and see word counts.

## [0.5.60]

### Jira and projects

- Work with a Jira board inside bycoda: Kanban and backlog/sprint views, drag cards to change status, sprint or rank, and move issues from the keyboard.
- Workspace Git shows every repository in a multi-repository workspace with its changes.

### Workspace

- Maximize a panel and restore the panel layout.
- Window controls follow full-screen and focus changes.
- Recent approval requests are kept in a notification history on this device.
- More message-box tips on writing clear requests and reviewing results.
- External tunnels share a local development server or host access through ngrok or cloudflared.

## [0.5.59]

### Tasks and automation

- Run tasks continuously until they are complete, with planner recovery, dependency-aware queues and a choice of machine.
- Task cards show approvals, external verification and blocked work more clearly, and open their worker or review session in the normal transcript pane.
- Automations wait for a running operation to finish before they can be deleted.

### Host tools

- Browse a website on the project's host, take control for a limited time and interact with its screenshot.
- Check the host's memory and CPU usage on demand.
- View and control Android emulators and iOS simulators on the host after setup.

### Social

- Manage social accounts, drafts and campaigns from one workspace, with clearer host authorization and per-platform limits.

### Workspace

- Notes and the attention inbox are available to clients connected to a host.
- Prompt templates warn before overwriting changes made in another window.
- The message box shows rotating tips on writing requests, follow-ups and the message queue.
- Shell output handling and task persistence are more robust.

## [0.5.58]

### Providers

- Connect existing CLI sign-ins as terminal profiles: standard and named home profiles are found automatically, and another folder can be chosen.

### Conversations and queue

- Follow-up messages show whether they were delivered, are still being delivered, or may already have arrived, and wait for the active turn before retrying.
- Sending is held when the saved queue cannot be read, instead of dropping queued messages.
- A stopped turn no longer finalizes the turn that replaced it, locally or on a remote machine.

### Social

- Work with X through a browser session on the host.

### Development

- The dev server prepares lazily loaded dependencies up front, so the first start no longer reloads mid-request.

## [0.5.57]

### Projects

- Select several projects in the sidebar with Ctrl/Cmd-click or Shift-click, then group or delete them together. Working projects are skipped, and project folders on disk are kept.

## [0.5.56]

First public release.

### Workspace and terminal

- Open project terminals in a dedicated dock and keep workspace, worktree and branch controls close to the composer.
- Preview HTML files inside the app while working on a project.
- Support typed MCP input forms and keep editor state across sessions.

### Connections and source control

- Add and edit remote machines from Connections, including an alternate SSH address.
- Browse Git history and manage working-tree changes, branches and worktrees from the project workspace.
- Show CI checks, job details and repair for GitHub, GitLab and Azure DevOps pull requests.
- Refresh Git status when repository metadata changes and avoid waits in non-Git folders.
- Work with Git from a full-screen workspace: branch list, commit inspector, blame view, and
  create, rename, merge, rebase or delete branches locally and on the remote.
- Resolve merge conflicts in the app with current, incoming or combined choices, then save and stage.

### Projects and permissions

- Grant and revoke folder access explicitly; upgrading a read-only folder asks first.
- Keep hidden remote projects in the inbox scope.

### Interface

- Monochrome bycoda identity, project icons and appearance options.
- Organized Settings with provider account recovery.
- Access setup again from Settings to connect computers, configure agents and choose projects.
- Read this version's bundled release notes from **What's new**, even when automatic updates are disabled.
- See working, waiting and recent sessions in the system tray menu and open them from there.

### Updates and reliability

- Notify about new versions published on GitHub and install signed updates from the app.
- Settle agent sessions cleanly on cancellation and process exit, and queue model changes during running remote turns.

### Social media

- Connect X, Instagram, Facebook, LinkedIn and YouTube accounts to a host, with credentials kept in an OS-protected vault.
- Plan campaigns, drafts and replies per project with explicit approval, and give agent sessions scoped social tools.

### Files and hosts

- Open the closest existing folder when a linked file or folder is missing, and keep file action errors visible.
- Use the host running on this computer for host tools, and support projects below linked folders on every platform.

### Hosts

- Ship this computer's host inside the Windows and macOS installers; the app installs it and keeps it updated with the app, waiting while sessions run.
- Publish host packages with each release so SSH setup and **Update Host** work on every supported machine.

### Remote machines

- Show sessions started in the desktop app on a machine to other computers that open its projects.
- Recover library sync after a machine's host is reinstalled, and reconnect to a host that moved to another port.
- Replace a reinstalled machine's connection when it is added again instead of keeping a dead duplicate.
- Hide a reinstalled host's stale copies of projects that its current host already lists.
