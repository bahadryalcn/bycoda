import { getLocale, t } from "../../../shared/i18n";

type KeybindingLabels = {
  locale: string;
  commands: Record<string, string>;
  conditions: Record<string, string>;
  categories: Record<string, string>;
};

let cached: KeybindingLabels | null = null;

/** Every command, condition and category written as a literal `t()` so the locale check can extract it. */
function buildKeybindingLabels(locale: string): KeybindingLabels {
  return {
    locale,
    commands: {
      "App: Command Palette": t("App: Command Palette"),
      "App: Find in Files": t("App: Find in Files"),
      "App: Focus Approval Requests": t("App: Focus Approval Requests"),
      "App: Go to File": t("App: Go to File"),
      "App: New Window": t("App: New Window"),
      "App: Open Automations": t("App: Open Automations"),
      "App: Open Crews": t("App: Open Crews"),
      "App: Open Inbox": t("App: Open Inbox"),
      "App: Open Notes": t("App: Open Notes"),
      "App: Open Project": t("App: Open Project"),
      "App: Open Tasks": t("App: Open Tasks"),
      "App: Quick Composer": t("App: Quick Composer"),
      "App: Search": t("App: Search"),
      "App: Settings": t("App: Settings"),
      "App: Stop computer use": t("App: Stop computer use"),
      "App: Switch Model": t("App: Switch Model"),
      "App: Toggle Full Screen": t("App: Toggle Full Screen"),
      "App: Toggle Session Sidebar": t("App: Toggle Session Sidebar"),
      "App: Toggle Sidebar": t("App: Toggle Sidebar"),
      "Composer: Queue Message": t("Composer: Queue Message"),
      "Composer: Toggle Workspace": t("Composer: Toggle Workspace"),
      "Editor: Find": t("Editor: Find"),
      "Editor: Replace": t("Editor: Replace"),
      "Pane: Arrange Columns": t("Pane: Arrange Columns"),
      "Pane: Arrange Grid": t("Pane: Arrange Grid"),
      "Pane: Arrange Main Left": t("Pane: Arrange Main Left"),
      "Pane: Arrange Main Top": t("Pane: Arrange Main Top"),
      "Pane: Arrange Rows": t("Pane: Arrange Rows"),
      "Pane: Close": t("Pane: Close"),
      "Pane: Equalize Sizes": t("Pane: Equalize Sizes"),
      "Pane: Focus Down": t("Pane: Focus Down"),
      "Pane: Focus Left": t("Pane: Focus Left"),
      "Pane: Focus Right": t("Pane: Focus Right"),
      "Pane: Focus Up": t("Pane: Focus Up"),
      "Pane: Move Down": t("Pane: Move Down"),
      "Pane: Move Left": t("Pane: Move Left"),
      "Pane: Move Right": t("Pane: Move Right"),
      "Pane: Move Up": t("Pane: Move Up"),
      "Pane: Split Down": t("Pane: Split Down"),
      "Pane: Split Right": t("Pane: Split Right"),
      "Pane: Toggle Maximized": t("Pane: Toggle Maximized"),
      "Project: Next": t("Project: Next"),
      "Project: Previous": t("Project: Previous"),
      "Session: Archive": t("Session: Archive"),
      "Session: New": t("Session: New"),
      "Session: Next": t("Session: Next"),
      "Session: Next in Current Tab": t("Session: Next in Current Tab"),
      "Session: Previous": t("Session: Previous"),
      "Session: Previous in Current Tab": t("Session: Previous in Current Tab"),
      "Session: Stop Turn": t("Session: Stop Turn"),
      "Session: Toggle Notes Panel": t("Session: Toggle Notes Panel"),
      "Settings: Appearance": t("Settings: Appearance"),
      "Settings: Connections": t("Settings: Connections"),
      "Settings: General": t("Settings: General"),
      "Settings: Inbox": t("Settings: Inbox"),
      "Settings: Keybindings": t("Settings: Keybindings"),
      "Settings: Notifications": t("Settings: Notifications"),
      "Settings: Providers": t("Settings: Providers"),
      "Settings: Terminal": t("Settings: Terminal"),
      "Settings: Workspace": t("Settings: Workspace"),
      "Tab: Activate 1–8": t("Tab: Activate 1–8"),
      "Tab: Activate Last": t("Tab: Activate Last"),
      "Tab: Back": t("Tab: Back"),
      "Tab: Close All": t("Tab: Close All"),
      "Tab: Close Others": t("Tab: Close Others"),
      "Tab: Cycle Next": t("Tab: Cycle Next"),
      "Tab: Cycle Previous": t("Tab: Cycle Previous"),
      "Tab: Forward": t("Tab: Forward"),
      "Tab: New": t("Tab: New"),
      "Tab: Next": t("Tab: Next"),
      "Tab: Previous": t("Tab: Previous"),
      "Terminal: New": t("Terminal: New"),
      "Terminal: New Tab": t("Terminal: New Tab"),
      "Terminal: Toggle Dock": t("Terminal: Toggle Dock"),
      "View: Reload": t("View: Reload"),
      "View: Reset Zoom": t("View: Reset Zoom"),
      "View: Zoom In": t("View: Zoom In"),
      "View: Zoom Out": t("View: Zoom Out"),
      "Voice: Dictate": t("Voice: Dictate"),
      "Voice: Open Companion": t("Voice: Open Companion"),
      "Voice: Push to Talk": t("Voice: Push to Talk"),
      "Voice: Talk to assistant (global)": t("Voice: Talk to assistant (global)"),
    },
    conditions: {
      "Message composer focused": t("Message composer focused"),
      "Voice connected and microphone paused": t("Voice connected and microphone paused"),
      "Voice companion closed": t("Voice companion closed"),
      "Anywhere, even when hidden": t("Anywhere, even when hidden"),
      Anywhere: t("Anywhere"),
      Always: t("Always"),
      "Draft session composer": t("Draft session composer"),
      "textFocus && turnRunning && !popup": t("textFocus && turnRunning && !popup"),
      "sessionFocus && !overlay": t("sessionFocus && !overlay"),
      "!overlay && (!textFocus || emptyComposer)": t("!overlay && (!textFocus || emptyComposer)"),
      workspaceFocus: t("workspaceFocus"),
      "!editorFocus": t("!editorFocus"),
      editorFocus: t("editorFocus"),
    },
    categories: {
      App: t("App"),
      Composer: t("Composer"),
      Editor: t("Editor"),
      Pane: t("Pane"),
      Project: t("Project"),
      Session: t("Session"),
      Settings: t("Settings"),
      Tab: t("Tab"),
      Terminal: t("Terminal"),
      View: t("View"),
      Voice: t("Voice"),
    },
  };
}

function keybindingLabels(): KeybindingLabels {
  const locale = getLocale();
  if (cached?.locale !== locale) cached = buildKeybindingLabels(locale);
  return cached;
}

/** The translated name of a shortcut command such as "Tab: New". */
export function keybindingCommandLabel(command: string): string {
  return keybindingLabels().commands[command] ?? command;
}

/** The translated condition of a shortcut row such as "Always". */
export function keybindingWhenLabel(when: string): string {
  return keybindingLabels().conditions[when] ?? when;
}

/** The translated group of a shortcut command, the part before the colon. */
export function keybindingCategoryLabel(category: string): string {
  return keybindingLabels().categories[category] ?? category;
}
