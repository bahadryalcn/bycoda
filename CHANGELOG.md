# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.0]

### Desktop controls and workspace

- Unify workspace, settings and tool panels around shared Arc controls.
- Expand accessible menus, search, selections and form controls with consistent interaction states.
- Refine session composition, conversation clearing and transcript recovery.
- Improve host session storage, remote projects and workspace feedback.
- Expand UI boundary checks and browser coverage for the shared design system.

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
