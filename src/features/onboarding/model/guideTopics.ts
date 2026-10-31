import { t } from "../../../shared/i18n";
import { guideActionBlocker, type GuideAction, type GuideSignal } from "./guide";
import type { UsageGuideTarget } from "./usageGuideTargets";

/** Why a control may be absent from the screen; picks the explanation and the fix. */
export type GuideNeed =
  | "rail"
  | "pin"
  | "chat"
  | "changes"
  | "files"
  | "terminal"
  | "tasks"
  | "automations"
  | "notes"
  | "inbox"
  | "settings";

export type GuideShortcut = {
  /** Keybinding command id; the current keys come from settings. */
  command: string;
  /** User-facing name. */
  label: string;
};

export type GuideStep = {
  id: string;
  /** Short name used in the quick tour and the spotlight. */
  title: string;
  text: string;
  /** Controls to spotlight. A step without any is explained in the tour only. */
  show?: { targets: UsageGuideTarget[]; need: GuideNeed };
  /** Finished as soon as the app state says so, without any click. */
  done?: GuideSignal;
  shortcuts?: GuideShortcut[];
};

export type GuideTopic = {
  id: string;
  group: string;
  title: string;
  summary: string;
  steps: GuideStep[];
  tips: string[];
  shortcuts: GuideShortcut[];
  /** The one primary action; running it finishes `step`. */
  action: { id: GuideAction; label: string; step: string };
  /** 3–5 step quick tour built from `steps`. */
  tour?: boolean;
};

export type GuideContext = { cwd: string; notesEnabled: boolean };

export type GuideMissingHelp = { reason: string; action: GuideAction; label: string };

/** What to tell the user when a spotlight target is not on screen, and what opens it. */
export function guideMissingHelp(need: GuideNeed, context: GuideContext): GuideMissingHelp {
  const open: Record<GuideNeed, GuideMissingHelp> = {
    rail: {
      reason: t("The sidebar looks hidden. Show it to see this control."),
      action: "command-palette",
      label: t("Open command palette"),
    },
    pin: {
      reason: t(
        "Pin shows on a project row in the sidebar. Open a project first. To make a group, open a project's … menu and choose Move to group → New group…",
      ),
      action: "open-project",
      label: t("Open a project"),
    },
    chat: {
      reason: t("The message box shows once a session is open."),
      action: "new-session",
      label: t("Start a session"),
    },
    changes: {
      reason: t("Changes shows once a project is open in the sidebar."),
      action: "changes",
      label: t("Open Changes"),
    },
    files: {
      reason: t("Explorer shows once a project is open in the sidebar."),
      action: "files",
      label: t("Open Explorer"),
    },
    terminal: {
      reason: t("The terminal button is in the bottom bar and needs a folder on this computer."),
      action: "terminal",
      label: t("Open the terminal"),
    },
    tasks: {
      reason: t("Tasks is hidden. Turn it on in Settings → Workspace."),
      action: "workspace-settings",
      label: t("Open Settings"),
    },
    automations: {
      reason: t("Automations is hidden. Turn it on in Settings → Workspace."),
      action: "workspace-settings",
      label: t("Open Settings"),
    },
    notes: {
      reason: t("Notes is turned off."),
      action: "workspace-settings",
      label: t("Turn on in Settings"),
    },
    inbox: {
      reason: t("Inbox is hidden. Turn it on in Settings → Workspace."),
      action: "workspace-settings",
      label: t("Open Settings"),
    },
    settings: {
      reason: t("The sidebar looks hidden. Show it to see this control."),
      action: "command-palette",
      label: t("Open command palette"),
    },
  };
  const help = open[need];
  const blocker = guideActionBlocker(help.action, context);
  if (blocker === "project" || blocker === "local-project") {
    return {
      reason:
        blocker === "local-project"
          ? t("Open a project folder on this computer first.")
          : t("Open a project first."),
      action: "open-project",
      label: t("Open a project"),
    };
  }
  return help;
}

/** Topic-level note under a disabled primary action. */
export function guideBlockerHelp(
  action: GuideAction,
  context: GuideContext,
): GuideMissingHelp | null {
  const blocker = guideActionBlocker(action, context);
  if (!blocker) return null;
  if (blocker === "notes-disabled")
    return {
      reason: t("Notes is turned off."),
      action: "workspace-settings",
      label: t("Turn on in Settings"),
    };
  return {
    reason:
      blocker === "local-project"
        ? t("Open a project folder on this computer first.")
        : t("Open a project first."),
    action: "open-project",
    label: t("Open a project"),
  };
}

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
      summary: t("A project is a folder on this computer or a connected machine."),
      steps: [
        {
          id: "projects.open",
          title: t("Open a folder"),
          text: t("Open a folder with + in the project rail or File → Open Project."),
          show: { targets: ["project-add", "project-navigation"], need: "rail" },
          done: "project-open",
          shortcuts: [{ command: "App: Open Project", label: t("Open project") }],
        },
        {
          id: "projects.switch",
          title: t("Switch projects"),
          text: t("Select a project in the rail to switch the workspace to it."),
          show: { targets: ["project-navigation"], need: "rail" },
          done: "project-many",
          shortcuts: [
            { command: "Project: Previous", label: t("Previous project") },
            { command: "Project: Next", label: t("Next project") },
          ],
        },
        {
          id: "projects.pin",
          title: t("Pin and group"),
          text: t(
            "Pin the projects you use often with the pin on a project row. Group related ones from a project's … menu → Move to group.",
          ),
          show: { targets: ["group-pin", "project-navigation"], need: "pin" },
          done: "project-pinned",
        },
      ],
      tips: [
        t("The same + menu opens a folder on a connected machine; its agents run on that machine."),
        t("Project groups can be locked or hidden to keep unrelated work out of view."),
        t("A group's git overview shows changes across all of its projects."),
        t("Without a project the terminal starts in your home folder; files, changes and git need a project."),
      ],
      shortcuts: [
        { command: "App: Open Project", label: t("Open project") },
        { command: "Project: Previous", label: t("Previous project") },
        { command: "Project: Next", label: t("Next project") },
      ],
      action: { id: "open-project", label: t("Open a project"), step: "projects.open" },
      tour: true,
    },
    {
      id: "chat",
      group: start,
      title: t("Chat with agents"),
      summary: t("A session is a conversation with one agent in the current project."),
      steps: [
        {
          id: "chat.session",
          title: t("Start a session"),
          text: t("Start a new session and choose the agent and model under the message box."),
          show: { targets: ["model-controls", "composer"], need: "chat" },
          done: "session-started",
          shortcuts: [
            { command: "Tab: New", label: t("New tab") },
            { command: "App: Switch Model", label: t("Switch model") },
          ],
        },
        {
          id: "chat.access",
          title: t("Choose access mode"),
          text: t("Pick what the agent may do without asking. A change applies from the next turn."),
          show: { targets: ["access-mode", "model-controls", "composer"], need: "chat" },
        },
        {
          id: "chat.attach",
          title: t("Attach and run commands"),
          text: t("Type @ to attach files and / to run commands or skills."),
          show: { targets: ["composer-plus", "composer"], need: "chat" },
        },
        {
          id: "chat.send",
          title: t("Send"),
          text: t("Enter sends your message. Shift+Enter adds a new line."),
          show: { targets: ["send-controls", "composer"], need: "chat" },
        },
      ],
      tips: [
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
        { command: "Tab: New", label: t("New tab") },
        { command: "App: Switch Model", label: t("Switch model") },
        { command: "Composer: Queue Message", label: t("Queue message") },
        { command: "Session: Stop Turn", label: t("Stop") },
        { command: "Pane: Split Right", label: t("Split pane") },
      ],
      action: { id: "new-session", label: t("Start a session"), step: "chat.session" },
      tour: true,
    },
    {
      id: "changes",
      group: code,
      title: t("Changes & Git"),
      summary: t("Review everything the agents changed before you commit it."),
      steps: [
        {
          id: "changes.open",
          title: t("Open Changes"),
          text: t("Open Changes in the sidebar to see modified files."),
          show: { targets: ["changes"], need: "changes" },
        },
        {
          id: "changes.diff",
          title: t("Read a diff"),
          text: t("Select a file to read its diff."),
          show: { targets: ["changes"], need: "changes" },
          done: "change-reviewed",
        },
        {
          id: "changes.commit",
          title: t("Commit"),
          text: t("Commit with your own message or let the app write one."),
          show: { targets: ["changes"], need: "changes" },
        },
      ],
      tips: [
        t("Worktrees let an agent work on a separate branch without touching your checkout."),
        t("Branches, stash, the git graph, blame and conflict resolution are in the same panel."),
      ],
      shortcuts: [],
      action: { id: "changes", label: t("Open Changes"), step: "changes.open" },
      tour: true,
    },
    {
      id: "files",
      group: code,
      title: t("Files & search"),
      summary: t("Browse, preview and edit project files without leaving the workspace."),
      steps: [
        {
          id: "files.explorer",
          title: t("Browse files"),
          text: t("Open Explorer in the sidebar to browse the project."),
          show: { targets: ["files-tab"], need: "files" },
        },
        {
          id: "files.goto",
          title: t("Go to a file"),
          text: t("Go to File opens any file by name."),
          shortcuts: [{ command: "App: Go to File", label: t("Go to file") }],
        },
        {
          id: "files.find",
          title: t("Search the project"),
          text: t("Find in Files searches the whole project."),
          shortcuts: [{ command: "App: Find in Files", label: t("Find in files") }],
        },
      ],
      tips: [
        t("The command palette runs any app command by name."),
        t("Documents, spreadsheets, images, PDFs and HTML open in a preview."),
        t("Search also finds past conversations."),
      ],
      shortcuts: [
        { command: "App: Go to File", label: t("Go to file") },
        { command: "App: Find in Files", label: t("Find in files") },
        { command: "App: Command Palette", label: t("Command palette") },
        { command: "App: Search", label: t("Search") },
        { command: "Editor: Find", label: t("Find in file") },
      ],
      action: { id: "files", label: t("Open Explorer"), step: "files.explorer" },
      tour: true,
    },
    {
      id: "terminal",
      group: code,
      title: t("Terminal"),
      summary: t("A terminal dock beside your chats, opened in the current project folder."),
      steps: [
        {
          id: "terminal.open",
          title: t("Open the dock"),
          text: t("Open the dock from the terminal button in the bottom bar or with the shortcut."),
          show: { targets: ["terminal-toggle"], need: "terminal" },
          done: "terminal-opened",
          shortcuts: [{ command: "Terminal: Toggle Dock", label: t("Toggle terminal") }],
        },
        {
          id: "terminal.tabs",
          title: t("Tabs and splits"),
          text: t("Add more terminals as tabs or split them side by side."),
          shortcuts: [
            { command: "Terminal: New", label: t("New terminal") },
            { command: "Terminal: New Tab", label: t("New terminal tab") },
          ],
        },
        {
          id: "terminal.dock",
          title: t("Move the dock"),
          text: t("Move the dock to the bottom or to either side."),
        },
      ],
      tips: [
        t("Launch profiles start a specific shell. Choose the default in Settings → Terminal."),
        t("Without a project the terminal starts in your home folder."),
      ],
      shortcuts: [
        { command: "Terminal: Toggle Dock", label: t("Toggle terminal") },
        { command: "Terminal: New", label: t("New terminal") },
        { command: "Terminal: New Tab", label: t("New terminal tab") },
      ],
      action: { id: "terminal", label: t("Open the terminal"), step: "terminal.open" },
      tour: true,
    },
    {
      id: "tasks",
      group: work,
      title: t("Tasks & goals"),
      summary: t("Hand off work that runs in the background, even while the app is closed."),
      steps: [
        {
          id: "tasks.add",
          title: t("Add a task"),
          text: t("Add a task that states the result you expect."),
          show: { targets: ["rail-tasks"], need: "tasks" },
          shortcuts: [{ command: "App: Open Tasks", label: t("Open tasks") }],
        },
        {
          id: "tasks.goal",
          title: t("Create a goal"),
          text: t("For larger work, create a goal. It is split into tasks; review the plan before approving it."),
        },
        {
          id: "tasks.follow",
          title: t("Follow progress"),
          text: t("Open a task's worker or review session to follow its progress."),
        },
      ],
      tips: [
        t("The Orchestrator in the + menu plans one request across a lead agent and workers. Review the proposal before it starts."),
        t("Subagents appear in the transcript. Open one to follow or stop it."),
        t("Blocked tasks show why. Retry them once the cause is fixed."),
        t("Stewards and the daily summary are on the Tasks board."),
      ],
      shortcuts: [{ command: "App: Open Tasks", label: t("Open tasks") }],
      action: { id: "tasks", label: t("Open Tasks"), step: "tasks.add" },
      tour: true,
    },
    {
      id: "automations",
      group: work,
      title: t("Automations"),
      summary: t("Run an agent prompt on a schedule for a project or a machine."),
      steps: [
        {
          id: "automations.create",
          title: t("Create an automation"),
          text: t("Create an automation with a prompt and a schedule."),
          show: { targets: ["rail-automations"], need: "automations" },
        },
        {
          id: "automations.control",
          title: t("Pause or run"),
          text: t("Pause, resume or run it now whenever you need."),
        },
        {
          id: "automations.history",
          title: t("Check results"),
          text: t("Check the result of every run in its history."),
        },
      ],
      tips: [
        t("An agent can create an automation for you from a chat. It keeps that chat's access mode."),
        t("Clicking a completion notification opens the automation."),
      ],
      shortcuts: [{ command: "App: Open Automations", label: t("Open automations") }],
      action: { id: "automations", label: t("Open Automations"), step: "automations.create" },
    },
    {
      id: "notes",
      group: work,
      title: t("Notes"),
      summary: t("Project notes, plus a notes panel beside each session."),
      steps: [
        {
          id: "notes.create",
          title: t("Create a note"),
          text: t("Create a note in Notes. It belongs to the current project."),
          show: { targets: ["rail-notes"], need: "notes" },
        },
        {
          id: "notes.panel",
          title: t("Session notes"),
          text: t("Open the session notes panel to keep notes next to a chat."),
        },
        {
          id: "notes.agent",
          title: t("Ask an agent"),
          text: t("Ask an agent to read or update your notes."),
        },
      ],
      tips: [t("Turn Notes on or off in Settings → Workspace.")],
      shortcuts: [
        { command: "App: Open Notes", label: t("Open notes") },
        { command: "Session: Toggle Notes Panel", label: t("Toggle session notes") },
      ],
      action: { id: "notes", label: t("Open Notes"), step: "notes.create" },
    },
    {
      id: "inbox",
      group: connect,
      title: t("Inbox"),
      summary: t("Pull requests, issues and work items from your connected services in one list."),
      steps: [
        {
          id: "inbox.connect",
          title: t("Connect a source"),
          text: t("Connect a source from the Inbox."),
          show: { targets: ["rail-inbox"], need: "inbox" },
        },
        {
          id: "inbox.filter",
          title: t("Filter"),
          text: t("Filter the list by project, type or read state."),
        },
        {
          id: "inbox.open",
          title: t("Open an item"),
          text: t("Open an item to read its comments, checks and diff."),
        },
      ],
      tips: [
        t("When a check fails, an agent can repair it from the item."),
        t("The pull request button in the bottom bar shows only pull requests."),
        t("Inbox notifications can be set per project."),
      ],
      shortcuts: [{ command: "App: Open Inbox", label: t("Open inbox") }],
      action: { id: "inbox", label: t("Open Inbox"), step: "inbox.connect" },
    },
    {
      id: "social",
      group: connect,
      title: t("Social media"),
      summary: t("Manage social accounts, plan campaigns and answer comments and messages."),
      steps: [
        {
          id: "social.connect",
          title: t("Connect an account"),
          text: t("Connect an account in Social."),
        },
        {
          id: "social.campaign",
          title: t("Plan a campaign"),
          text: t("Create a campaign and preview its schedule."),
        },
        {
          id: "social.review",
          title: t("Review replies"),
          text: t("Review drafted replies before they are sent."),
        },
      ],
      tips: [
        t("Policies set per-platform limits and what agents may send. Drafts never send on their own."),
        t("Programs generate recurring content on a schedule."),
        t("Bulk replies answer many comments at once."),
      ],
      shortcuts: [],
      action: { id: "social", label: t("Open Social"), step: "social.connect" },
    },
    {
      id: "machines",
      group: connect,
      title: t("Machines & devices"),
      summary: t("Connect other computers and phones, and work with simulators and development servers."),
      steps: [
        {
          id: "machines.add",
          title: t("Add a machine"),
          text: t("Add a machine in Settings → Connections."),
        },
        {
          id: "machines.projects",
          title: t("Open its folders"),
          text: t("Open its folders as projects. Agents then run on that machine."),
        },
        {
          id: "machines.phone",
          title: t("Pair your phone"),
          text: t("Pair your phone to follow sessions while away."),
        },
      ],
      tips: [
        t("Host tools in a session show devices, a host browser, development servers, logs and resource usage."),
        t("iOS simulators run on a connected Mac."),
      ],
      shortcuts: [],
      action: { id: "connections", label: t("Open Connections"), step: "machines.add" },
    },
    {
      id: "settings",
      group: customize,
      title: t("Settings & shortcuts"),
      summary: t("Adjust the app to the way you work."),
      steps: [
        {
          id: "settings.search",
          title: t("Find an option"),
          text: t("Settings has App, Workspace and Agents groups. Search finds any option."),
          show: { targets: ["rail-settings"], need: "settings" },
          shortcuts: [{ command: "App: Settings", label: t("Settings") }],
        },
        {
          id: "settings.keys",
          title: t("Change shortcuts"),
          text: t("Change or disable any shortcut in Settings → Keybindings."),
        },
        {
          id: "settings.usage",
          title: t("Watch your usage"),
          text: t("The bottom bar shows the remaining usage of each provider account."),
        },
      ],
      tips: [
        t("Provider accounts, MCP servers and skills are in the Agents group."),
        t("Hide tools you don't use in Settings → Workspace. Hiding never stops their work."),
        t("Run the setup again from Settings → General → Open setup."),
      ],
      shortcuts: [
        { command: "App: Settings", label: t("Settings") },
        { command: "App: Command Palette", label: t("Command palette") },
        { command: "App: Toggle Sidebar", label: t("Toggle sidebar") },
      ],
      action: { id: "keybindings", label: t("Open Keybindings"), step: "settings.keys" },
    },
  ];
}

/** The first-run checklist: a few key steps, in the order a new user needs them. */
export function gettingStartedSteps(): { stepId: string; topicId: string; label: string }[] {
  return [
    { stepId: "projects.open", topicId: "projects", label: t("Open a project") },
    { stepId: "chat.session", topicId: "chat", label: t("Start a session") },
    { stepId: "changes.diff", topicId: "changes", label: t("Review a change") },
    { stepId: "terminal.open", topicId: "terminal", label: t("Use the terminal") },
  ];
}
