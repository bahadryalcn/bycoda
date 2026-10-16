import { t } from "../../../shared/i18n";
import type { GuideAction } from "./guide";

export type GuideTopic = {
  id: string;
  group: string;
  title: string;
  summary: string;
  steps: string[];
  advanced: string[];
  /** Keybinding command ids; labels and current keys come from settings. */
  shortcuts: string[];
  action: { id: GuideAction; label: string };
  tour?: boolean;
};

/** Built at render with literal `t()` calls so the locale checker sees every message. */
export function guideTopics(): GuideTopic[] {
  const start = t("Getting started");
  const code = t("Code");
  const work = t("Background work");
  const connect = t("Integrations");
  const customize = t("Customize");
  return [
    {
      id: "projects",
      group: start,
      title: t("Projects"),
      summary: t(
        "A project is a folder on this computer or a connected machine. Chats, files, changes and terminals follow the selected project.",
      ),
      steps: [
        t("Open a folder with + in the project rail or File → Open Project."),
        t("Select a project in the rail to switch the workspace to it."),
        t("Pin the projects you use often and group related ones."),
      ],
      advanced: [
        t("The same + menu opens a folder on a connected machine; its agents run on that machine."),
        t("Project groups can be locked or hidden to keep unrelated work out of view."),
        t("A group's git overview shows changes across all of its projects."),
        t("Without a project the terminal starts in your home folder; files, changes and git need a project."),
      ],
      shortcuts: ["App: Open Project", "Project: Previous", "Project: Next"],
      action: { id: "open-project", label: t("Open a project") },
    },
    {
      id: "chat",
      group: start,
      title: t("Chat with agents"),
      summary: t(
        "Each session is a conversation with one agent in the current project. Describe the result you want; the agent reads files, edits code and runs commands.",
      ),
      steps: [
        t("Start a new session and choose the agent and model under the message box."),
        t("Type @ to attach files and / to run commands or skills."),
        t("Enter sends your message. Shift+Enter adds a new line."),
      ],
      advanced: [
        t(
          "Access modes decide what runs without asking: Supervised, Auto-accept edits, Auto (AI reviewer) or Full access. A change applies from the next turn.",
        ),
        t(
          "Send steers the active turn. Use the queue button to send after it finishes. If steering is unavailable, the message waits in the queue.",
        ),
        t("Stop interrupts the turn and pauses the queue. It does not undo file changes."),
        t("The + menu adds files and skills and turns on Plan mode or the Orchestrator."),
        t("Split panes to run several sessions side by side."),
      ],
      shortcuts: [
        "Tab: New",
        "App: Switch Model",
        "Composer: Queue Message",
        "Session: Stop Turn",
        "Pane: Split Right",
      ],
      action: { id: "new-session", label: t("Start a session") },
      tour: true,
    },
    {
      id: "changes",
      group: code,
      title: t("Changes & Git"),
      summary: t("Review everything the agents changed before you commit it."),
      steps: [
        t("Open Changes in the sidebar to see modified files."),
        t("Select a file to read its diff."),
        t("Commit with your own message or let the app write one."),
      ],
      advanced: [
        t("Worktrees let an agent work on a separate branch without touching your checkout."),
        t("Branches, stash, the git graph, blame and conflict resolution are in the same panel."),
      ],
      shortcuts: [],
      action: { id: "changes", label: t("Open Changes") },
    },
    {
      id: "files",
      group: code,
      title: t("Files & search"),
      summary: t("Browse, preview and edit project files without leaving the workspace."),
      steps: [
        t("Open Explorer in the sidebar to browse the project."),
        t("Go to File opens any file by name."),
        t("Find in Files searches the whole project."),
      ],
      advanced: [
        t("The command palette runs any app command by name."),
        t("Documents, spreadsheets, images, PDFs and HTML open in a preview."),
        t("Search also finds past conversations."),
      ],
      shortcuts: [
        "App: Go to File",
        "App: Find in Files",
        "App: Command Palette",
        "App: Search",
        "Editor: Find",
      ],
      action: { id: "files", label: t("Open Explorer") },
    },
    {
      id: "terminal",
      group: code,
      title: t("Terminal"),
      summary: t("A terminal dock beside your chats, opened in the current project folder."),
      steps: [
        t("Open the dock from the terminal button in the bottom bar or with the shortcut."),
        t("Add more terminals as tabs or split them side by side."),
        t("Move the dock to the bottom or to either side."),
      ],
      advanced: [
        t("Launch profiles start a specific shell. Choose the default in Settings → Terminal."),
        t("Without a project the terminal starts in your home folder."),
      ],
      shortcuts: ["Terminal: Toggle Dock", "Terminal: New", "Terminal: New Tab"],
      action: { id: "terminal", label: t("Open the terminal") },
    },
    {
      id: "tasks",
      group: work,
      title: t("Tasks & goals"),
      summary: t(
        "Hand off work that runs in the background on the project's machine, even while the app is closed.",
      ),
      steps: [
        t("Add a task that states the result you expect."),
        t("For larger work, create a goal. It is split into tasks; review the plan before approving it."),
        t("Open a task's worker or review session to follow its progress."),
      ],
      advanced: [
        t("The Orchestrator in the + menu plans one request across a lead agent and workers. Review the proposal before it starts."),
        t("Subagents appear in the transcript. Open one to follow or stop it."),
        t("Blocked tasks show why. Retry them once the cause is fixed."),
        t("Stewards and the daily summary are on the Tasks board."),
      ],
      shortcuts: ["App: Open Tasks"],
      action: { id: "tasks", label: t("Open Tasks") },
    },
    {
      id: "automations",
      group: work,
      title: t("Automations"),
      summary: t("Run an agent prompt on a schedule for a project or a machine."),
      steps: [
        t("Create an automation with a prompt and a schedule."),
        t("Pause, resume or run it now whenever you need."),
        t("Check the result of every run in its history."),
      ],
      advanced: [
        t("An agent can create an automation for you from a chat. It keeps that chat's access mode."),
        t("Clicking a completion notification opens the automation."),
      ],
      shortcuts: ["App: Open Automations"],
      action: { id: "automations", label: t("Open Automations") },
    },
    {
      id: "notes",
      group: work,
      title: t("Notes"),
      summary: t("Project notes, plus a notes panel beside each session."),
      steps: [
        t("Create a note in Notes. It belongs to the current project."),
        t("Open the session notes panel to keep notes next to a chat."),
        t("Ask an agent to read or update your notes."),
      ],
      advanced: [t("Turn Notes on or off in Settings → Workspace.")],
      shortcuts: ["App: Open Notes", "Session: Toggle Notes Panel"],
      action: { id: "notes", label: t("Open Notes") },
    },
    {
      id: "inbox",
      group: connect,
      title: t("Inbox"),
      summary: t(
        "Pull requests, issues and work items from GitHub, GitLab, Azure DevOps and Jira in one list.",
      ),
      steps: [
        t("Connect a source from the Inbox."),
        t("Filter the list by project, type or read state."),
        t("Open an item to read its comments, checks and diff."),
      ],
      advanced: [
        t("When a check fails, an agent can repair it from the item."),
        t("The pull request button in the bottom bar shows only pull requests."),
        t("Inbox notifications can be set per project."),
      ],
      shortcuts: ["App: Open Inbox"],
      action: { id: "inbox", label: t("Open Inbox") },
    },
    {
      id: "social",
      group: connect,
      title: t("Social media"),
      summary: t("Manage social accounts, plan campaigns and answer comments and messages."),
      steps: [
        t("Connect an account in Social."),
        t("Create a campaign and preview its schedule."),
        t("Review drafted replies before they are sent."),
      ],
      advanced: [
        t("Policies set per-platform limits and what agents may send. Drafts never send on their own."),
        t("Programs generate recurring content on a schedule."),
        t("Bulk replies answer many comments at once."),
      ],
      shortcuts: [],
      action: { id: "social", label: t("Open Social") },
    },
    {
      id: "machines",
      group: connect,
      title: t("Machines & devices"),
      summary: t(
        "Connect other computers and phones, and work with simulators, browsers and development servers.",
      ),
      steps: [
        t("Add a machine in Settings → Connections."),
        t("Open its folders as projects. Agents then run on that machine."),
        t("Pair your phone to follow sessions while away."),
      ],
      advanced: [
        t("Host tools in a session show devices, a host browser, development servers, logs and resource usage."),
        t("iOS simulators run on a connected Mac."),
      ],
      shortcuts: [],
      action: { id: "connections", label: t("Open Connections") },
    },
    {
      id: "settings",
      group: customize,
      title: t("Settings & shortcuts"),
      summary: t("Adjust the app to the way you work."),
      steps: [
        t("Settings has App, Workspace and Agents groups. Search finds any option."),
        t("Change or disable any shortcut in Settings → Keybindings."),
        t("The bottom bar shows the remaining usage of each provider account."),
      ],
      advanced: [
        t("Provider accounts, MCP servers and skills are in the Agents group."),
        t("Hide tools you don't use in Settings → Workspace. Hiding never stops their work."),
        t("Run the setup again from Settings → General → Open setup."),
      ],
      shortcuts: ["App: Settings", "App: Command Palette", "App: Toggle Sidebar"],
      action: { id: "keybindings", label: t("Open Keybindings") },
    },
  ];
}
