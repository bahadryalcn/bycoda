import { createStoredSetting, storedFlag } from "../../../shared/lib/storedSetting";
import { t, sourceMessages } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import {
  ALT,
  FULLSCREEN_SHORTCUT,
  IS_MAC,
  IS_WIN,
  MOD,
  SHIFT,
} from "../../../platform/tauri/platform";
import {
  canonicalShortcut,
  isGlobalShortcut,
  QUICK_COMPOSER_DEFAULT_SHORTCUT,
  quickComposerShortcutLabel,
  shortcutFromKeyEvent,
  shortcutTokens,
} from "../../quick-composer/model/quickComposerShortcut";
import { readFlag, writeFlag } from "./storageFlags";

const SECTION_KEY = "bycoda.settingsSection";

export type SettingsSectionId =
  | "notifications"
  | "workspace"
  | "general"
  | "policies"
  | "connections"
  | "appearance"
  | "keybindings"
  | "terminal"
  | "chat"
  | "providers"
  | "usage"
  | "mcp"
  | "skills"
  | "inbox"
  | "worktrees"
  | "groupLock"
  | "archive";

/** Rail buckets. Sections list in order under their group label. */
export type SettingsGroupId = "app" | "agents" | "workspace";

export const SETTINGS_GROUPS: { id: SettingsGroupId; label: string }[] = [
  {
    id: "app",
    get label() {
      return t("App");
    },
  },
  {
    id: "agents",
    get label() {
      return t("Agents");
    },
  },
  {
    id: "workspace",
    get label() {
      return t("Workspace");
    },
  },
];

export type SettingsSection = {
  id: SettingsSectionId;
  group: SettingsGroupId;
  label: string;
  description: string;
  /** Extra words search matches the section on, beyond its label. */
  keywords?: string;
};

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: "general",
    group: "app",
    get label() {
      return t("General");
    },
    get description() {
      return t("Language, application behavior and updates.");
    },
    keywords: "version update language setup sleep tray",
  },
  {
    id: "notifications",
    group: "app",
    get label() {
      return t("Notifications");
    },
    get description() {
      return t("Sounds, desktop alerts and notification preferences for each project.");
    },
    keywords: "sound alert notification summary reminder project",
  },
  {
    id: "policies",
    group: "app",
    get label() {
      return t("Policies");
    },
    get description() {
      return t("Privacy, terms of use, third-party services and software license.");
    },
    keywords:
      "privacy policy terms legal license data deletion tracking gizlilik politika koşullar lisans veri silme takip",
  },
  {
    id: "connections",
    group: "app",
    get label() {
      return t("Connections");
    },
    get description() {
      return t("Connect your machines and run agents remotely through SSH.");
    },
    keywords: "ssh remote host machine server environment always on",
  },
  {
    id: "appearance",
    group: "app",
    get label() {
      return t("Appearance");
    },
    get description() {
      return t("Theme, tint, translucency, workspace layout, and conversation backgrounds.");
    },
    keywords: "theme dark light color accent glass blur zoom scale wallpaper rail sidebar",
  },
  {
    id: "keybindings",
    group: "app",
    get label() {
      return t("Keybindings");
    },
    get description() {
      return t("Every shortcut the workspace handles, from the app menu and the key handler.");
    },
    keywords: "shortcut hotkey keyboard binding",
  },
  {
    id: "terminal",
    group: "app",
    get label() {
      return t("Terminal");
    },
    get description() {
      return t("The shell new terminals open in and `!commands` from the composer run in.");
    },
    keywords: "shell profile bash git bash powershell pwsh cmd command prompt wsl zsh fish default",
  },
  {
    id: "chat",
    group: "agents",
    get label() {
      return t("Chat");
    },
    get description() {
      return t("Conversation layout, follow-ups and prompt templates.");
    },
    keywords: "transcript composer prompt message layout template snippet trigger queue",
  },
  {
    id: "providers",
    group: "agents",
    get label() {
      return t("Providers");
    },
    get description() {
      return t(
        "Provider accounts, agent CLIs {p0} can drive, and the model new sessions start with.",
        { p0: PRODUCT_IDENTITY.displayName },
      );
    },
    keywords: "account sign in login model harness claude codex gemini cli default hooks",
  },
  {
    id: "usage",
    group: "agents",
    get label() {
      return t("Usage");
    },
    get description() {
      return t("Account limits, remaining capacity and usage by project.");
    },
    keywords: "quota limits weekly session tokens cost",
  },
  {
    id: "mcp",
    group: "agents",
    get label() {
      return t("MCP");
    },
    get description() {
      return t("Find MCP servers across providers and manage their connections.");
    },
    keywords: "tools servers connections oauth authenticate login claude codex cursor opencode",
  },
  {
    id: "skills",
    group: "agents",
    get label() {
      return t("Skills");
    },
    get description() {
      return t("Discover and manage file skills from project, personal, and harness folders.");
    },
    keywords: "skill instructions prompt",
  },
  {
    id: "workspace",
    group: "workspace",
    get label() {
      return t("Workspace");
    },
    get description() {
      return t("Workspace panels, file tabs, editing and code review.");
    },
    keywords: "notes agents rail editor files format save diff review explorer",
  },
  {
    id: "inbox",
    group: "workspace",
    get label() {
      return t("Inbox");
    },
    get description() {
      return t("Connect the services that supply your Inbox.");
    },
    keywords: "github gitlab linear jira atlassian azure devops connect token integration",
  },
  {
    id: "archive",
    group: "workspace",
    get label() {
      return t("Archive settings");
    },
    get description() {
      return t("Projects and conversations you have archived.");
    },
    keywords: "archived restore delete hidden",
  },
  {
    id: "worktrees",
    group: "workspace",
    get label() {
      return t("Worktrees");
    },
    get description() {
      return t("Manage additional worktrees for each project.");
    },
    keywords: "git branch worktree working copy project create delete",
  },
  {
    id: "groupLock",
    group: "workspace",
    get label() {
      return t("Group privacy");
    },
    get description() {
      return t(
        "Hide and restore project groups, or protect them with a password. Hidden projects stay on disk.",
      );
    },
    keywords:
      "password privacy hide hidden restore private protect secure passcode gizli gizle geri getir görünür",
  },
];

export function settingsSectionsByGroup(): {
  id: SettingsGroupId;
  label: string;
  sections: SettingsSection[];
}[] {
  return SETTINGS_GROUPS.map((group) => ({
    ...group,
    sections: SETTINGS_SECTIONS.filter((section) => section.group === group.id),
  })).filter((group) => group.sections.length > 0);
}

/**
 * One searchable control. `id` is the row's `data-setting-id` in SettingsView,
 * which is also what Settings scrolls to when it opens on an anchor.
 */
export type SettingsEntry = {
  id: string;
  section: SettingsSectionId;
  label: string;
  keywords?: string;
};

export const SETTINGS_INDEX: SettingsEntry[] = [
  {
    id: "privacy-policy",
    section: "policies",
    get label() {
      return t("Privacy policy");
    },
    keywords: "privacy tracking data collection gizlilik politika takip veri toplama",
  },
  {
    id: "terms-of-use",
    section: "policies",
    get label() {
      return t("Terms of use");
    },
    keywords: "terms liability warranty legal kullanım koşulları sorumluluk garanti",
  },
  {
    id: "third-party-data",
    section: "policies",
    get label() {
      return t("Third-party services and data controls");
    },
    keywords:
      "provider retention revoke delete data third party üçüncü taraf veri silme saklama youtube google",
  },
  {
    id: "software-license",
    section: "policies",
    get label() {
      return t("Software license (MIT)");
    },
    keywords: "mit license open source copyright lisans açık kaynak",
  },
  {
    id: "file-access",
    section: "groupLock",
    get label() {
      return t("File access");
    },
    keywords:
      "files folders projects skills permission access dosya klasör proje skill izin erişim",
  },
  {
    id: "prompt-templates",
    section: "chat",
    get label() {
      return t("Prompt templates");
    },
    keywords: "template snippet trigger prompt şablon istem",
  },
  {
    id: "daily-summary",
    section: "notifications",
    get label() {
      return t("Daily summary");
    },
    keywords: "daily summary time background tasks goals günlük özet",
  },
  {
    id: "start-in-privacy-mode",
    section: "groupLock",
    get label() {
      return t("Start in privacy mode");
    },
    keywords: "startup launch privacy screen gizlilik modu başlat açılış",
  },
  {
    id: "interface-language",
    section: "general",
    get label() {
      return t("Application language");
    },
    keywords:
      "language locale translation system türkçe dil çeviri english deutsch français español português 中文 日本語",
  },
  {
    id: "git-language",
    section: "general",
    get label() {
      return t("Git interface language");
    },
    keywords: "git language english dil ingilizce commit branch diff",
  },
  {
    id: "technical-language",
    section: "general",
    get label() {
      return t("Technical interface language");
    },
    keywords: "technical language terminal developer file editor teknik dil geliştirici",
  },
  {
    id: "terminal-default-profile",
    section: "terminal",
    get label() {
      return t("Default terminal profile");
    },
    keywords: "shell bash git bash powershell pwsh cmd wsl zsh default ! command",
  },
  {
    id: "hidden-project-groups",
    section: "groupLock",
    get label() {
      return t("Hidden groups");
    },
    keywords:
      "hide hidden restore recover show visible temporary privacy personal gizli gizle geri getir görünür kişisel",
  },
  {
    id: "group-lock-password",
    section: "groupLock",
    get label() {
      return t("Lock password");
    },
    keywords: "set change remove forgot reset passcode group rail protect",
  },
  {
    id: "group-lock-options",
    section: "groupLock",
    get label() {
      return t("Lock groups again when {p0} starts", { p0: PRODUCT_IDENTITY.displayName });
    },
    keywords: "auto lock inactivity timeout minutes launch startup unlock all",
  },
  {
    id: "group-lock-groups",
    section: "groupLock",
    get label() {
      return t("Lockable groups");
    },
    keywords: "group rail project password lock now",
  },
  {
    id: "remote-machines",
    section: "connections",
    get label() {
      return t("Your machines");
    },
    keywords: "ssh remote connect host server environment",
  },
  {
    id: "remote-auto-reconnect",
    section: "connections",
    get label() {
      return t("Automatically reconnect to remote machines");
    },
    keywords: "ssh remote retry reconnect drop tunnel offline background",
  },
  {
    id: "mcp-servers",
    section: "mcp",
    get label() {
      return t("MCP servers");
    },
    keywords: "claude tools connections oauth authenticate login add remove",
  },
  {
    id: "project-worktrees",
    section: "worktrees",
    get label() {
      return t("Project worktrees");
    },
    keywords: "git branch working copy create delete manage",
  },
  {
    id: "update",
    section: "general",
    get label() {
      return t("Version");
    },
    keywords: "update upgrade release what's new build changelog",
  },
  {
    id: "import-history",
    section: "general",
    get label() {
      return t("Import Claude Code and Codex sessions");
    },
    keywords: "history conversations terminal resume migrate existing",
  },
  {
    id: "sounds",
    section: "notifications",
    get label() {
      return t("Sounds");
    },
    keywords: "audio cue chime mute volume",
  },
  {
    id: "notifications",
    section: "notifications",
    get label() {
      return t("Notifications");
    },
    keywords: "notify alert toast permission reminder background",
  },
  {
    id: "notes",
    section: "workspace",
    get label() {
      return t("Notes");
    },
    keywords: "notebook markdown rail scratchpad",
  },
  ...[
    {
      id: "workspace-tasks",
      label: "Tasks",
      keywords: "tasks workspace navigation show hide görev",
    },
    {
      id: "workspace-automations",
      label: "Automations",
      keywords: "automations workspace navigation show hide otomasyon",
    },
    {
      id: "workspace-inbox",
      label: "Inbox",
      keywords: "inbox workspace navigation show hide gelen kutusu",
    },
    {
      id: "workspace-social",
      label: "Social Media",
      keywords: "social media workspace navigation show hide sosyal medya",
    },
  ].map((item) => ({
    id: item.id,
    section: "workspace" as const,
    get label() {
      return t(item.label);
    },
    keywords: item.keywords,
  })),
  ...(IS_MAC
    ? [
        {
          id: "quick-composer",
          section: "workspace" as const,
          get label() {
            return t("Quick composer");
          },
          keywords: "spotlight global shortcut hotkey floating prompt anywhere",
        },
      ]
    : []),
  {
    id: "usage-guide",
    section: "general",
    get label() {
      return t("Usage guide");
    },
    keywords: "help tour onboarding shortcuts chat queue stop learn",
  },
  {
    id: "working-agents",
    section: "workspace",
    get label() {
      return t("Working agents");
    },
    keywords: "live running sessions rail card",
  },
  {
    id: "file-tabs",
    section: "workspace",
    get label() {
      return t("File tabs");
    },
    keywords: "editor open top workspace normal session pane beside chat",
  },
  {
    id: "tab-animations",
    section: "appearance",
    get label() {
      return t("Tab animations");
    },
    keywords: "motion open close resize transition",
  },
  {
    id: "keep-awake",
    section: "general",
    get label() {
      return t("Prevent sleep while agents work");
    },
    keywords:
      "sleep awake idle running agents windows linux macos duration 15 30 hour forever hold after",
  },
  {
    id: "keep-awake-screen",
    section: "general",
    get label() {
      return t("Keep the screen on");
    },
    keywords: "sleep display screen blank dim lock awake",
  },
  ...(IS_WIN
    ? [
        {
          id: "close-to-tray",
          section: "general" as const,
          get label() {
            return t("Close to tray");
          },
          keywords: "minimize background quit exit window taskbar windows",
        },
      ]
    : []),
  {
    id: "theme",
    section: "appearance",
    get label() {
      return t("Theme");
    },
    keywords: "dark light system appearance mode",
  },
  {
    id: "interface-contrast",
    section: "appearance",
    get label() {
      return t("Contrast");
    },
    keywords: "borders secondary text softer stronger",
  },
  {
    id: "chat-width",
    section: "appearance",
    get label() {
      return t("Chat width");
    },
    keywords: "comfortable wide full messages composer",
  },
  {
    id: "interface-font",
    section: "appearance",
    get label() {
      return t("Interface font");
    },
    keywords: "typography typeface Segoe Arial Verdana",
  },
  {
    id: "monospace-font",
    section: "appearance",
    get label() {
      return t("Monospace font");
    },
    keywords: "code terminal font size Consolas Menlo typography",
  },
  {
    id: "code-word-wrap",
    section: "appearance",
    get label() {
      return t("Word wrap");
    },
    keywords: "code long lines wrapping",
  },
  {
    id: "decorative-motion",
    section: "appearance",
    get label() {
      return t("Decorative animations");
    },
    keywords: "motion reduced accessibility mascot particles welcome effects",
  },
  {
    id: "accent-color",
    section: "appearance",
    get label() {
      return t("Accent color");
    },
    keywords: "highlight bubble send button tint",
  },
  {
    id: "diff-colors",
    section: "appearance",
    get label() {
      return t("Diff colors");
    },
    keywords:
      "colorblind color blind accessibility added removed red green blue orange high contrast changes",
  },
  {
    id: "hue",
    section: "appearance",
    get label() {
      return t("Hue");
    },
    keywords: "tint color chrome",
  },
  {
    id: "saturation",
    section: "appearance",
    get label() {
      return t("Saturation");
    },
    keywords: "tint color neutral grey gray",
  },
  {
    id: "dark-lightness",
    section: "appearance",
    get label() {
      return t("Dark-mode lightness");
    },
    keywords: "black brightness contrast background",
  },
  {
    id: "sidebar-opacity",
    section: "appearance",
    get label() {
      return t("Sidebar opacity");
    },
    keywords: "glass translucent transparency vibrancy rail",
  },
  {
    id: "blur",
    section: "appearance",
    get label() {
      return t("Blur radius");
    },
    keywords: "glass translucent vibrancy backdrop",
  },
  {
    id: "main-pane-glass",
    section: "appearance",
    get label() {
      return t("Main pane glass");
    },
    keywords: "translucent transparency body window",
  },
  {
    id: "main-pane-opacity",
    section: "appearance",
    get label() {
      return t("Main pane opacity");
    },
    keywords: "glass translucent transparency body window",
  },
  {
    id: "interface-scale",
    section: "appearance",
    get label() {
      return t("Interface scale");
    },
    keywords: "zoom font size bigger smaller ui",
  },
  {
    id: "collapsed-project-rail",
    section: "appearance",
    get label() {
      return t("Collapsed project rail");
    },
    keywords: "sidebar compact icons hidden navigation layout",
  },
  {
    id: "show-excluded-files",
    section: "workspace",
    get label() {
      return t("Show excluded files");
    },
    keywords: "explorer gitignore ignored hidden files tree",
  },
  {
    id: "chat-background",
    section: "appearance",
    get label() {
      return t("Chat background");
    },
    keywords: "wallpaper image picture opacity backdrop blur",
  },
  {
    id: "transcript-layout",
    section: "chat",
    get label() {
      return t("Transcript layout");
    },
    keywords: "full width chat bubble message",
  },
  {
    id: "anchor-prompts",
    section: "chat",
    get label() {
      return t("Anchor prompts to top");
    },
    keywords: "scroll position sticky message",
  },
  {
    id: "follow-up",
    section: "chat",
    get label() {
      return t("Follow-up behavior");
    },
    keywords: "queue steer interrupt send while running",
  },
  {
    id: "composer-spelling",
    section: "chat",
    get label() { return t("Spelling and autocorrect"); },
    keywords: "spellcheck spelling autocorrect correction yazım düzeltme",
  },
  {
    id: "resume-at-reset",
    section: "chat",
    get label() {
      return t("Resume at reset");
    },
    keywords: "usage limit rate limit continue automatically wait",
  },
  {
    id: "auto-continue-interrupted",
    section: "chat",
    get label() {
      return t("Automatically continue interrupted turns");
    },
    keywords: "restart quit resume continue where you left off cut off crash",
  },
  {
    id: "model-controls",
    section: "chat",
    get label() {
      return t("Extras summary");
    },
    keywords:
      "extras advisor subagent effort thinking reasoning fast service tier model picker composer",
  },
  {
    id: "format-on-save",
    section: "workspace",
    get label() {
      return t("Format on save");
    },
    keywords: "prettier quotes editor save format",
  },
  {
    id: "diff-view",
    section: "workspace",
    get label() {
      return t("Diff view");
    },
    keywords: "unified editor review changes working tree",
  },
  {
    id: "crew-scene",
    section: "appearance",
    get label() {
      return t("Agent crew");
    },
    keywords:
      "crew ekip agents ajanlar coffeehouse kahvehane tea çay amcalar bebek baby context grow büyüme ambient scene",
  },
  {
    id: "crew-theme",
    section: "appearance",
    get label() {
      return t("Crew theme");
    },
    keywords: "crew theme ekip tema classic star wars starwars yoda obi wan vader luke leia r2 d2",
  },
  {
    id: "crew-growth",
    section: "appearance",
    get label() {
      return t("Grow with context");
    },
    keywords:
      "crew ekip age yaş baby bebek child çocuk adult yetişkin uncle amca context window compact büyüme color renk doluluk battery şarj",
  },
  {
    id: "agent-clis",
    section: "providers",
    get label() {
      return t("Agent CLIs");
    },
    keywords: "codex opencode cursor grok pi omp fx hermes antigravity gemini google binary path",
  },
  {
    id: "enabled-models",
    section: "providers",
    get label() {
      return t("Models");
    },
    keywords: "model enable disable hide turn off sonnet opus haiku gpt default",
  },
  {
    id: "harness-updates",
    section: "providers",
    get label() {
      return t("CLI updates");
    },
    keywords:
      "update upgrade version outdated latest release claude codex cursor grok opencode pi omp fx",
  },
  {
    id: "antigravity-account",
    section: "providers",
    get label() {
      return t("Antigravity CLI account");
    },
    keywords:
      "google gemini antigravity agy install migration sign in login oauth account authentication api key",
  },
  {
    id: "provider-accounts",
    section: "providers",
    get label() {
      return t("Provider accounts");
    },
    keywords:
      "account sign in login rename remove delete credentials profile color colour orange pink",
  },
  {
    id: "show-remaining-usage",
    section: "usage",
    get label() {
      return t("Show remaining usage");
    },
    keywords: "usage limit meter bar left used quota percent",
  },
  {
    id: "mask-emails",
    section: "usage",
    get label() {
      return t("Mask account emails");
    },
    keywords: "email privacy blur hide screenshot account",
  },
  {
    id: "provider-usage",
    section: "usage",
    get label() {
      return t("Usage");
    },
    keywords: "usage tokens cost spend billing cache model project account",
  },
  {
    id: "claude-hooks",
    section: "providers",
    get label() {
      return t("Claude Code hooks");
    },
    keywords: "pretooluse settings.json block command notification",
  },
  {
    id: "project-notifications",
    section: "notifications",
    get label() {
      return t("Project notifications");
    },
    keywords: "mute resume sounds banners reminders categories",
  },
  {
    id: "github",
    section: "inbox",
    get label() {
      return t("GitHub");
    },
    keywords: "gh cli connect pull request sign in",
  },
  {
    id: "gitlab",
    section: "inbox",
    get label() {
      return t("GitLab");
    },
    keywords: "token self-managed merge request connect",
  },
  {
    id: "azuredevops",
    section: "inbox",
    get label() {
      return t("ADO");
    },
    keywords: "azure devops boards repos pull request pat organization connect",
  },
  {
    id: "jira",
    section: "inbox",
    get label() {
      return t("Jira");
    },
    keywords: "atlassian cloud site email api token issues projects connect",
  },
  {
    id: "linear",
    section: "inbox",
    get label() {
      return t("Linear");
    },
    keywords: "api key issues teams connect",
  },
  {
    id: "show-archived",
    section: "archive",
    get label() {
      return t("Show archived in the sidebar");
    },
    keywords: "hidden conversations list",
  },
];

export type SettingsSearchResult = {
  section: SettingsSectionId;
  sectionLabel: string;
  /** Row to scroll to, or `null` when the whole section matched. */
  settingId: string | null;
  label: string;
};

/** Ranks a label/keyword pair against a lowercased needle; `null` means no match. */
function matchScore(needle: string, label: string, keywords?: string): number | null {
  const labels = [label, ...sourceMessages(label)].map((value) => value.toLowerCase());
  if (labels.some((value) => value.startsWith(needle))) return 0;
  if (labels.some((value) => value.includes(needle))) return 1;
  if (keywords?.toLowerCase().includes(needle)) return 2;
  return null;
}

/** Individual settings first, then whole sections, so a row wins its own name. */
export function searchSettings(query: string, limit = 8): SettingsSearchResult[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const scored: { score: number; result: SettingsSearchResult }[] = [];

  for (const entry of SETTINGS_INDEX) {
    const score = matchScore(needle, entry.label, entry.keywords);
    if (score == null) continue;
    scored.push({
      score,
      result: {
        section: entry.section,
        sectionLabel: settingsSectionLabel(entry.section),
        settingId: entry.id,
        label: entry.label,
      },
    });
  }

  for (const section of SETTINGS_SECTIONS) {
    // A matching row already takes the user to this page; avoid duplicate labels.
    if (
      scored.some(({ result }) => result.section === section.id && result.label === section.label)
    )
      continue;
    const score = matchScore(
      needle,
      section.label,
      `${section.description} ${section.keywords ?? ""}`,
    );
    if (score == null) continue;
    scored.push({
      score: score + 0.5,
      result: {
        section: section.id,
        sectionLabel: section.label,
        settingId: null,
        label: section.label,
      },
    });
  }

  return scored
    .sort((a, b) => a.score - b.score || a.result.label.localeCompare(b.result.label))
    .slice(0, limit)
    .map((item) => item.result);
}

export const SETTINGS_SECTION_DEFAULT: SettingsSectionId = "general";

export function isSettingsSectionId(value: unknown): value is SettingsSectionId {
  return SETTINGS_SECTIONS.some((section) => section.id === value);
}

export function settingsSectionLabel(id: SettingsSectionId): string {
  return SETTINGS_SECTIONS.find((section) => section.id === id)?.label ?? "General";
}

export function settingsSectionDescription(id: SettingsSectionId): string {
  return SETTINGS_SECTIONS.find((section) => section.id === id)?.description ?? "";
}

export function loadSettingsSection(): SettingsSectionId {
  try {
    const raw = localStorage.getItem(SECTION_KEY);
    return isSettingsSectionId(raw) ? raw : SETTINGS_SECTION_DEFAULT;
  } catch {
    return SETTINGS_SECTION_DEFAULT;
  }
}

export function saveSettingsSection(id: SettingsSectionId) {
  try {
    localStorage.setItem(SECTION_KEY, id);
  } catch {
    // private mode / quota
  }
}

const FOLLOW_UP_BEHAVIOR_KEY = "bycoda.followUpBehavior";
const FOLLOW_UP_BEHAVIOR_CHANGE_EVENT = "bycoda:follow-up-behavior-change";

const COMPOSER_EFFORT_VISIBLE_KEY = "bycoda.composerEffortVisible";

const MODEL_CONTROLS_KEY = "bycoda.modelControls";

const FILE_TAB_MODE_KEY = "bycoda.fileTabMode";

const TAB_ANIMATIONS_ENABLED_KEY = "bycoda.tabAnimationsEnabled";

const COLLAPSED_PROJECT_RAIL_MODE_KEY = "bycoda.collapsedProjectRailMode";

export type FollowUpBehavior = "steer" | "queue";

export const FOLLOW_UP_BEHAVIOR_DEFAULT: FollowUpBehavior = "steer";

export function loadFollowUpBehavior(): FollowUpBehavior {
  try {
    const raw = localStorage.getItem(FOLLOW_UP_BEHAVIOR_KEY);
    return raw === "queue" || raw === "steer" ? raw : FOLLOW_UP_BEHAVIOR_DEFAULT;
  } catch {
    return FOLLOW_UP_BEHAVIOR_DEFAULT;
  }
}

export function saveFollowUpBehavior(value: FollowUpBehavior) {
  try {
    localStorage.setItem(FOLLOW_UP_BEHAVIOR_KEY, value);
  } catch {
    // private mode / quota
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(FOLLOW_UP_BEHAVIOR_CHANGE_EVENT));
  }
}

export function subscribeFollowUpBehavior(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(FOLLOW_UP_BEHAVIOR_CHANGE_EVENT, onStoreChange);
  return () => window.removeEventListener(FOLLOW_UP_BEHAVIOR_CHANGE_EVENT, onStoreChange);
}

export type FileTabMode = "pane" | "workspace";

export const FILE_TAB_MODE_DEFAULT: FileTabMode = "pane";

/** Choose whether an ordinary file joins the active pane or gets a top tab. */
export function loadFileTabMode(): FileTabMode {
  try {
    const raw = localStorage.getItem(FILE_TAB_MODE_KEY);
    return raw === "pane" || raw === "workspace" ? raw : FILE_TAB_MODE_DEFAULT;
  } catch {
    return FILE_TAB_MODE_DEFAULT;
  }
}

export function saveFileTabMode(value: FileTabMode) {
  try {
    localStorage.setItem(FILE_TAB_MODE_KEY, value);
  } catch {
    // private mode / quota
  }
}

export const TAB_ANIMATIONS_ENABLED_DEFAULT = false;

export function loadTabAnimationsEnabled(): boolean {
  return readFlag(TAB_ANIMATIONS_ENABLED_KEY) ?? TAB_ANIMATIONS_ENABLED_DEFAULT;
}

export function saveTabAnimationsEnabled(value: boolean) {
  writeFlag(TAB_ANIMATIONS_ENABLED_KEY, value);
}

export type CollapsedProjectRailMode = "compact" | "hidden";

export const COLLAPSED_PROJECT_RAIL_MODE_DEFAULT: CollapsedProjectRailMode = "compact";

export const COLLAPSED_PROJECT_RAIL_MODE_CHANGE_EVENT = "bycoda:collapsed-project-rail-mode-change";

const collapsedProjectRailModeSetting = createStoredSetting<CollapsedProjectRailMode>({
  key: COLLAPSED_PROJECT_RAIL_MODE_KEY,
  fallback: COLLAPSED_PROJECT_RAIL_MODE_DEFAULT,
  parse: (raw) =>
    raw === "compact" || raw === "hidden" ? raw : COLLAPSED_PROJECT_RAIL_MODE_DEFAULT,
  serialize: String,
  event: COLLAPSED_PROJECT_RAIL_MODE_CHANGE_EVENT,
});
export const loadCollapsedProjectRailMode = collapsedProjectRailModeSetting.load;
export const saveCollapsedProjectRailMode = collapsedProjectRailModeSetting.save;
export const subscribeCollapsedProjectRailMode = collapsedProjectRailModeSetting.subscribe;

export type ModelControls = "menu" | "beside";

export const MODEL_CONTROLS_DEFAULT: ModelControls = "menu";

/** Fired on `window` when the composer model controls setting flips. */
export const MODEL_CONTROLS_CHANGE_EVENT = "bycoda:model-controls-change";

export function loadModelControls(): ModelControls {
  try {
    const raw = localStorage.getItem(MODEL_CONTROLS_KEY);
    if (raw === "menu" || raw === "beside") return raw;
    if (raw == null) {
      // Migrate the previous effort-control toggle: on means beside the picker.
      const legacy = localStorage.getItem(COMPOSER_EFFORT_VISIBLE_KEY);
      if (legacy === "1" || legacy === "true") return "beside";
    }
  } catch {
    // private mode / quota
  }
  return MODEL_CONTROLS_DEFAULT;
}

export function saveModelControls(value: ModelControls) {
  try {
    localStorage.setItem(MODEL_CONTROLS_KEY, value);
  } catch {
    // private mode / quota
  }
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<ModelControls>(MODEL_CONTROLS_CHANGE_EVENT, {
      detail: value,
    }),
  );
}

export function subscribeModelControls(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(MODEL_CONTROLS_CHANGE_EVENT, onStoreChange);
  return () => window.removeEventListener(MODEL_CONTROLS_CHANGE_EVENT, onStoreChange);
}

const NOTES_ENABLED_KEY = "bycoda.notesEnabled";

export const NOTES_ENABLED_DEFAULT = true;

/** Fired on `window` when the Notes UI setting flips. */
export const NOTES_ENABLED_CHANGE_EVENT = "bycoda:notes-enabled-change";

const notesEnabledSetting = storedFlag(
  NOTES_ENABLED_KEY,
  NOTES_ENABLED_DEFAULT,
  NOTES_ENABLED_CHANGE_EVENT,
);

export function loadNotesEnabled(): boolean {
  return notesEnabledSetting.load() ?? NOTES_ENABLED_DEFAULT;
}

export function saveNotesEnabled(value: boolean) {
  notesEnabledSetting.save(value);
}

export const subscribeNotesEnabled = notesEnabledSetting.subscribe;

const QUICK_COMPOSER_ENABLED_KEY = "bycoda.quickComposerEnabled";
const QUICK_COMPOSER_SHORTCUT_KEY = "bycoda.quickComposerShortcut";

export const QUICK_COMPOSER_ENABLED_DEFAULT = true;

const quickComposerEnabledSetting = storedFlag(
  QUICK_COMPOSER_ENABLED_KEY,
  QUICK_COMPOSER_ENABLED_DEFAULT,
);

export function loadQuickComposerEnabled(): boolean {
  return quickComposerEnabledSetting.load() ?? QUICK_COMPOSER_ENABLED_DEFAULT;
}

export function saveQuickComposerEnabled(value: boolean) {
  quickComposerEnabledSetting.save(value);
}

export function loadQuickComposerShortcut(): string {
  try {
    const value = localStorage.getItem(QUICK_COMPOSER_SHORTCUT_KEY);
    return value && isGlobalShortcut(value) ? value : QUICK_COMPOSER_DEFAULT_SHORTCUT;
  } catch {
    return QUICK_COMPOSER_DEFAULT_SHORTCUT;
  }
}

export function saveQuickComposerShortcut(value: string) {
  if (!isGlobalShortcut(value)) return;
  // Same conflict rules as every other row, so the separately stored Quick
  // Composer chord cannot claim a combination another command already owns.
  const shortcut = validateKeybindingShortcut(QUICK_COMPOSER_COMMAND, value);
  try {
    localStorage.setItem(QUICK_COMPOSER_SHORTCUT_KEY, shortcut);
  } catch {
    // private mode / quota
  }
}

const LIVE_AGENTS_ENABLED_KEY = "bycoda.liveAgentsEnabled";

export const LIVE_AGENTS_ENABLED_DEFAULT = true;

/** Fired on `window` when the working-agents rail card setting flips. */
export const LIVE_AGENTS_ENABLED_CHANGE_EVENT = "bycoda:live-agents-enabled-change";

const liveAgentsEnabledSetting = storedFlag(
  LIVE_AGENTS_ENABLED_KEY,
  LIVE_AGENTS_ENABLED_DEFAULT,
  LIVE_AGENTS_ENABLED_CHANGE_EVENT,
  false,
);

export function loadLiveAgentsEnabled(): boolean {
  return liveAgentsEnabledSetting.load() ?? LIVE_AGENTS_ENABLED_DEFAULT;
}

export function saveLiveAgentsEnabled(value: boolean) {
  liveAgentsEnabledSetting.save(value);
}

export const subscribeLiveAgentsEnabled = liveAgentsEnabledSetting.subscribe;

const CLOSE_TO_TRAY_KEY = "bycoda.closeToTray";

const KEEP_AWAKE_KEY = "bycoda.keepAwakeWhileAgentsWork";
export const KEEP_AWAKE_DEFAULT = false;
export const KEEP_AWAKE_CHANGE_EVENT = "bycoda:keep-awake-change";

const keepAwakeEnabledSetting = storedFlag(
  KEEP_AWAKE_KEY,
  KEEP_AWAKE_DEFAULT,
  KEEP_AWAKE_CHANGE_EVENT,
  true,
);

export function loadKeepAwakeEnabled(): boolean {
  return keepAwakeEnabledSetting.load() ?? KEEP_AWAKE_DEFAULT;
}

export function saveKeepAwakeEnabled(value: boolean) {
  keepAwakeEnabledSetting.save(value);
}

export const subscribeKeepAwakeEnabled = keepAwakeEnabledSetting.subscribe;

export const KEEP_AWAKE_HOLD_AFTER = [
  {
    value: "0",
    get label() {
      return t("When it ends");
    },
  },
  {
    value: "15m",
    get label() {
      return t("15 minutes");
    },
  },
  {
    value: "30m",
    get label() {
      return t("30 minutes");
    },
  },
  {
    value: "1h",
    get label() {
      return t("1 hour");
    },
  },
  {
    value: "4h",
    get label() {
      return t("4 hours");
    },
  },
  {
    value: "forever",
    get label() {
      return t("Forever");
    },
  },
] as const;

export type KeepAwakeHoldAfter = (typeof KEEP_AWAKE_HOLD_AFTER)[number]["value"];

const KEEP_AWAKE_HOLD_AFTER_KEY = "bycoda.keepAwakeHoldAfter";
export const KEEP_AWAKE_HOLD_AFTER_DEFAULT: KeepAwakeHoldAfter = "0";
export const KEEP_AWAKE_HOLD_AFTER_CHANGE_EVENT = "bycoda:keep-awake-hold-after-change";

export function isKeepAwakeHoldAfter(value: unknown): value is KeepAwakeHoldAfter {
  return KEEP_AWAKE_HOLD_AFTER.some((option) => option.value === value);
}

export function keepAwakeHoldAfterMs(value: KeepAwakeHoldAfter): number {
  switch (value) {
    case "0":
      return 0;
    case "15m":
      return 15 * 60 * 1000;
    case "30m":
      return 30 * 60 * 1000;
    case "1h":
      return 60 * 60 * 1000;
    case "4h":
      return 4 * 60 * 60 * 1000;
    case "forever":
      return Number.POSITIVE_INFINITY;
  }
}

export function loadKeepAwakeHoldAfter(): KeepAwakeHoldAfter {
  try {
    const raw = localStorage.getItem(KEEP_AWAKE_HOLD_AFTER_KEY);
    return isKeepAwakeHoldAfter(raw) ? raw : KEEP_AWAKE_HOLD_AFTER_DEFAULT;
  } catch {
    return KEEP_AWAKE_HOLD_AFTER_DEFAULT;
  }
}

export function saveKeepAwakeHoldAfter(value: KeepAwakeHoldAfter): void {
  try {
    localStorage.setItem(KEEP_AWAKE_HOLD_AFTER_KEY, value);
  } catch {
    // private mode / quota
  }
  if (typeof window !== "undefined")
    window.dispatchEvent(
      new CustomEvent<KeepAwakeHoldAfter>(KEEP_AWAKE_HOLD_AFTER_CHANGE_EVENT, {
        detail: value,
      }),
    );
}

const REMOTE_AUTO_RECONNECT_KEY = "bycoda.remoteAutoReconnect";
export const REMOTE_AUTO_RECONNECT_DEFAULT = true;
export const REMOTE_AUTO_RECONNECT_CHANGE_EVENT = "bycoda:remote-auto-reconnect-change";

/** Whether dropped remote machines are retried in the background. */
const remoteAutoReconnectSetting = storedFlag(
  REMOTE_AUTO_RECONNECT_KEY,
  REMOTE_AUTO_RECONNECT_DEFAULT,
  REMOTE_AUTO_RECONNECT_CHANGE_EVENT,
  true,
);

export function loadRemoteAutoReconnect(): boolean {
  return remoteAutoReconnectSetting.load() ?? REMOTE_AUTO_RECONNECT_DEFAULT;
}

export function saveRemoteAutoReconnect(value: boolean) {
  remoteAutoReconnectSetting.save(value);
}

export const subscribeRemoteAutoReconnect = remoteAutoReconnectSetting.subscribe;

const KEEP_AWAKE_SCREEN_KEY = "bycoda.keepAwakeScreen";
export const KEEP_AWAKE_SCREEN_DEFAULT = false;
export const KEEP_AWAKE_SCREEN_CHANGE_EVENT = "bycoda:keep-awake-screen-change";

const keepAwakeScreenSetting = storedFlag(
  KEEP_AWAKE_SCREEN_KEY,
  KEEP_AWAKE_SCREEN_DEFAULT,
  KEEP_AWAKE_SCREEN_CHANGE_EVENT,
  true,
);

export function loadKeepAwakeScreen(): boolean {
  return keepAwakeScreenSetting.load() ?? KEEP_AWAKE_SCREEN_DEFAULT;
}

export function saveKeepAwakeScreen(value: boolean) {
  keepAwakeScreenSetting.save(value);
}

export const subscribeKeepAwakeScreen = keepAwakeScreenSetting.subscribe;

export function subscribeKeepAwakeHoldAfter(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEEP_AWAKE_HOLD_AFTER_KEY || event.key === null) onChange();
  };
  window.addEventListener(KEEP_AWAKE_HOLD_AFTER_CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(KEEP_AWAKE_HOLD_AFTER_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export const CLOSE_TO_TRAY_DEFAULT = true;

export function loadCloseToTray(): boolean {
  // Close to tray is Windows-only: nowhere else installs a tray icon.
  if (!IS_WIN) return false;
  return readFlag(CLOSE_TO_TRAY_KEY) ?? CLOSE_TO_TRAY_DEFAULT;
}

export function saveCloseToTray(value: boolean) {
  writeFlag(CLOSE_TO_TRAY_KEY, value);
}

const CREW_SCENE_ENABLED_KEY = "bycoda.crewSceneEnabled";

export const CREW_SCENE_ENABLED_DEFAULT = true;

/** Fired on `window` when the crew scene setting flips. */
export const CREW_SCENE_ENABLED_CHANGE_EVENT = "bycoda:crew-scene-enabled-change";

/** The setting's key before the scene was renamed from "coffeehouse" to "crew". */
const LEGACY_CREW_SCENE_ENABLED_KEY = "bycoda.coffeehouseSceneEnabled";

export function loadCrewSceneEnabled(): boolean {
  return (
    readFlag(CREW_SCENE_ENABLED_KEY) ??
    readFlag(LEGACY_CREW_SCENE_ENABLED_KEY) ??
    CREW_SCENE_ENABLED_DEFAULT
  );
}

export function saveCrewSceneEnabled(value: boolean) {
  writeFlag(CREW_SCENE_ENABLED_KEY, value);
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<boolean>(CREW_SCENE_ENABLED_CHANGE_EVENT, {
      detail: value,
    }),
  );
}

export function subscribeCrewSceneEnabled(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CREW_SCENE_ENABLED_CHANGE_EVENT, onStoreChange);
  return () => window.removeEventListener(CREW_SCENE_ENABLED_CHANGE_EVENT, onStoreChange);
}

const CREW_GROWTH_ENABLED_KEY = "bycoda.crewGrowthEnabled";

export type CrewTheme = "classic" | "star-wars";
const crewThemeSetting = createStoredSetting<CrewTheme>({
  key: "bycoda.crewTheme",
  fallback: "classic",
  event: "bycoda:crew-theme-change",
  storageEvents: true,
  parse: (value) => (value === "star-wars" ? "star-wars" : "classic"),
  serialize: String,
});
export const loadCrewTheme = crewThemeSetting.load;
export const subscribeCrewTheme = crewThemeSetting.subscribe;
export function saveCrewTheme(value: CrewTheme) {
  crewThemeSetting.save(value === "star-wars" ? "star-wars" : "classic");
}

export const CREW_GROWTH_ENABLED_DEFAULT = true;

/** Fired on `window` when crew members start or stop ageing with their context. */
export const CREW_GROWTH_ENABLED_CHANGE_EVENT = "bycoda:crew-growth-enabled-change";

export function loadCrewGrowthEnabled(): boolean {
  return readFlag(CREW_GROWTH_ENABLED_KEY) ?? CREW_GROWTH_ENABLED_DEFAULT;
}

export function saveCrewGrowthEnabled(value: boolean) {
  writeFlag(CREW_GROWTH_ENABLED_KEY, value);
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<boolean>(CREW_GROWTH_ENABLED_CHANGE_EVENT, {
      detail: value,
    }),
  );
}

export function subscribeCrewGrowthEnabled(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CREW_GROWTH_ENABLED_CHANGE_EVENT, onStoreChange);
  return () => window.removeEventListener(CREW_GROWTH_ENABLED_CHANGE_EVENT, onStoreChange);
}

const DIFF_VIEWER_KEY = "bycoda.diffViewer";

export type DiffViewer = "editor" | "unified";

export const DIFF_VIEWER_DEFAULT: DiffViewer = "editor";

/** Fired on `window` when the working-tree diff layout flips. */
export const DIFF_VIEWER_CHANGE_EVENT = "bycoda:diff-viewer-change";

function isDiffViewer(value: unknown): value is DiffViewer {
  return value === "editor" || value === "unified";
}

const diffViewerSetting = createStoredSetting<DiffViewer>({
  key: DIFF_VIEWER_KEY,
  fallback: DIFF_VIEWER_DEFAULT,
  event: DIFF_VIEWER_CHANGE_EVENT,
  parse: (raw) => (isDiffViewer(raw) ? raw : DIFF_VIEWER_DEFAULT),
  serialize: String,
});

export const loadDiffViewer = diffViewerSetting.load;

export function saveDiffViewer(value: DiffViewer) {
  diffViewerSetting.save(isDiffViewer(value) ? value : DIFF_VIEWER_DEFAULT);
}

export const subscribeDiffViewer = diffViewerSetting.subscribe;

const DIFF_LAYOUT_KEY = "bycoda.diffLayout";

/** How a single file's changes are drawn: one column, or before | after. */
export type DiffLayout = "inline" | "split";

export const DIFF_LAYOUT_DEFAULT: DiffLayout = "inline";

/** Fired on `window` when the single-file diff layout flips. */
export const DIFF_LAYOUT_CHANGE_EVENT = "bycoda:diff-layout-change";

function isDiffLayout(value: unknown): value is DiffLayout {
  return value === "inline" || value === "split";
}

const diffLayoutSetting = createStoredSetting<DiffLayout>({
  key: DIFF_LAYOUT_KEY,
  fallback: DIFF_LAYOUT_DEFAULT,
  event: DIFF_LAYOUT_CHANGE_EVENT,
  parse: (raw) => (isDiffLayout(raw) ? raw : DIFF_LAYOUT_DEFAULT),
  serialize: String,
});

export const loadDiffLayout = diffLayoutSetting.load;

export function saveDiffLayout(value: DiffLayout) {
  diffLayoutSetting.save(isDiffLayout(value) ? value : DIFF_LAYOUT_DEFAULT);
}

export const subscribeDiffLayout = diffLayoutSetting.subscribe;

const RESUME_AT_RESET_KEY = "bycoda.resumeAtReset";

export const RESUME_AT_RESET_DEFAULT = true;

/** Whether a usage limit notice starts armed to continue at the reset. */
const resumeAtResetSetting = storedFlag(RESUME_AT_RESET_KEY, RESUME_AT_RESET_DEFAULT);

export function loadResumeAtReset(): boolean {
  return resumeAtResetSetting.load() ?? RESUME_AT_RESET_DEFAULT;
}

export function saveResumeAtReset(value: boolean) {
  resumeAtResetSetting.save(value);
}

const FORMAT_ON_SAVE_KEY = "bycoda.formatOnSave";

export const FORMAT_ON_SAVE_DEFAULT = true;

const formatOnSaveSetting = storedFlag(FORMAT_ON_SAVE_KEY, FORMAT_ON_SAVE_DEFAULT);

export function loadFormatOnSave(): boolean {
  return formatOnSaveSetting.load() ?? FORMAT_ON_SAVE_DEFAULT;
}

export function saveFormatOnSave(value: boolean) {
  formatOnSaveSetting.save(value);
}

const AUTOSAVE_KEY = "bycoda.autosave";
const AUTOSAVE_CHANGE_EVENT = "bycoda:autosave-change";

export const AUTOSAVE_DEFAULT = false;

export function loadAutosave(): boolean {
  return readFlag(AUTOSAVE_KEY) ?? AUTOSAVE_DEFAULT;
}

export function saveAutosave(value: boolean): boolean {
  writeFlag(AUTOSAVE_KEY, value);
  const saved = loadAutosave();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(AUTOSAVE_CHANGE_EVENT));
  }
  return saved;
}

export function subscribeAutosave(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === AUTOSAVE_KEY) onStoreChange();
  };
  window.addEventListener(AUTOSAVE_CHANGE_EVENT, onStoreChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(AUTOSAVE_CHANGE_EVENT, onStoreChange);
    window.removeEventListener("storage", onStorage);
  };
}

const CLAUDE_HOOKS_KEY = "bycoda.claudeHooks";

export const CLAUDE_HOOKS_DEFAULT = true;

const claudeHooksSetting = storedFlag(CLAUDE_HOOKS_KEY, CLAUDE_HOOKS_DEFAULT);

export function loadClaudeHooks(): boolean {
  return claudeHooksSetting.load() ?? CLAUDE_HOOKS_DEFAULT;
}

export function saveClaudeHooks(value: boolean) {
  claudeHooksSetting.save(value);
}

const CTRL = IS_MAC ? "⌃" : "Ctrl+";

export type KeybindingRow = {
  command: string;
  keys: string;
  when: string;
};

/**
 * Mirrors the bindings we actually handle: the native menu accelerators in
 * `src-tauri/src/menu.rs`, `tabCommand`, the window key handler in App, and
 * focused surface handlers such as the draft composer workspace toggle.
 */
export const KEYBINDINGS: KeybindingRow[] = [
  { command: "App: Settings", keys: `${MOD},`, when: "Always" },
  { command: "App: Search", keys: `${MOD}K`, when: "Always" },
  { command: "App: Go to File", keys: `${MOD}P`, when: "Always" },
  { command: "App: Command Palette", keys: `${MOD}${SHIFT}P`, when: "Always" },
  { command: "App: Find in Files", keys: `${MOD}${SHIFT}F`, when: "Always" },
  { command: "App: Open Project", keys: `${MOD}O`, when: "Always" },
  { command: "App: New Window", keys: `${MOD}${SHIFT}N`, when: "Always" },
  ...(IS_MAC
    ? [
        {
          command: "App: Quick Composer",
          keys: `${MOD}${SHIFT}Space`,
          when: "Anywhere",
        },
      ]
    : []),
  { command: "App: Toggle Sidebar", keys: `${MOD}B`, when: "Always" },
  {
    command: "App: Toggle Session Sidebar",
    keys: `${MOD}${SHIFT}B`,
    when: "Always",
  },
  { command: "App: Switch Model", keys: `${MOD}.`, when: "Always" },
  {
    command: "Composer: Toggle Workspace",
    keys: `${MOD}${SHIFT}G`,
    when: "Draft session composer",
  },
  {
    command: "Composer: Queue Message",
    keys: `${SHIFT}Tab`,
    when: "textFocus && turnRunning && !popup",
  },
  {
    command: "Session: Stop Turn",
    keys: "Esc",
    when: "textFocus && turnRunning && !popup",
  },
  { command: "View: Reload", keys: `${MOD}${SHIFT}R`, when: "Always" },
  { command: "View: Zoom In", keys: `${MOD}+`, when: "Always" },
  { command: "View: Zoom Out", keys: `${MOD}-`, when: "Always" },
  { command: "View: Reset Zoom", keys: `${MOD}0`, when: "Always" },
  { command: "Tab: New", keys: `${MOD}T`, when: "Always" },
  { command: "Tab: Close Others", keys: `${MOD}${ALT}T`, when: "Always" },
  { command: "Tab: Close All", keys: `${MOD}${SHIFT}W`, when: "Always" },
  { command: "Tab: Next", keys: `${MOD}${SHIFT}]`, when: "Always" },
  { command: "Tab: Previous", keys: `${MOD}${SHIFT}[`, when: "Always" },
  { command: "Tab: Cycle Next", keys: `${CTRL}Tab`, when: "Always" },
  {
    command: "Tab: Cycle Previous",
    keys: `${CTRL}${SHIFT}Tab`,
    when: "Always",
  },
  { command: "Tab: Back", keys: `${MOD}[`, when: "Always" },
  { command: "Tab: Forward", keys: `${MOD}]`, when: "Always" },
  { command: "Tab: Activate 1–8", keys: `${MOD}1 … ${MOD}8`, when: "Always" },
  { command: "Tab: Activate Last", keys: `${MOD}9`, when: "Always" },
  {
    command: "Session: Archive",
    keys: `${MOD}${SHIFT}A`,
    when: "sessionFocus && !overlay",
  },
  {
    command: "Session: Toggle Notes Panel",
    keys: `${MOD}N`,
    when: "sessionFocus && !overlay",
  },
  {
    command: "Session: Previous",
    keys: `${MOD}${SHIFT}↑`,
    when: "!overlay && (!textFocus || emptyComposer)",
  },
  {
    command: "Session: Next",
    keys: `${MOD}${SHIFT}↓`,
    when: "!overlay && (!textFocus || emptyComposer)",
  },
  {
    command: "Session: Previous in Current Tab",
    keys: `${MOD}↑`,
    when: "!overlay && (!textFocus || emptyComposer)",
  },
  {
    command: "Session: Next in Current Tab",
    keys: `${MOD}↓`,
    when: "!overlay && (!textFocus || emptyComposer)",
  },
  {
    command: "Project: Previous",
    keys: `${MOD}${SHIFT}←`,
    when: "!overlay && (!textFocus || emptyComposer)",
  },
  {
    command: "Project: Next",
    keys: `${MOD}${SHIFT}→`,
    when: "!overlay && (!textFocus || emptyComposer)",
  },
  { command: "Pane: Close", keys: `${MOD}W`, when: "Always" },
  { command: "Pane: Split Right", keys: `${MOD}D`, when: "!editorFocus" },
  { command: "Pane: Toggle Maximized", keys: `${MOD}${SHIFT}Enter`, when: "workspaceFocus" },
  { command: "App: Toggle Full Screen", keys: FULLSCREEN_SHORTCUT, when: "Always" },
  {
    command: "Pane: Split Down",
    keys: `${MOD}${SHIFT}D`,
    when: "!editorFocus",
  },
  { command: "Pane: Focus Left", keys: `${MOD}${ALT}←`, when: "Always" },
  { command: "Pane: Focus Right", keys: `${MOD}${ALT}→`, when: "Always" },
  { command: "Pane: Focus Up", keys: `${MOD}${ALT}↑`, when: "Always" },
  { command: "Pane: Focus Down", keys: `${MOD}${ALT}↓`, when: "Always" },
  { command: "Terminal: New", keys: `${MOD}\``, when: "Always" },
  { command: "Terminal: New Tab", keys: `${MOD}${SHIFT}\``, when: "Always" },
  { command: "Terminal: Toggle Dock", keys: `${MOD}J`, when: "Always" },
  { command: "Editor: Find", keys: `${MOD}F`, when: "editorFocus" },
  { command: "Editor: Replace", keys: `${MOD}${ALT}F`, when: "editorFocus" },
];

const KEYBINDING_OVERRIDES_KEY = "bycoda.keybindingOverrides";
const KEYBINDINGS_CHANGE_EVENT = "bycoda:keybindings-change";

export type KeybindingOverride = {
  disabled?: boolean;
  shortcut?: string;
};

export type KeybindingOverrides = Record<string, KeybindingOverride>;

const VALID_COMMANDS = new Set(KEYBINDINGS.map((row) => row.command));

const KEY_CODES: Record<string, string> = {
  " ": "Space",
  Enter: "Enter",
  Space: "Space",
  Tab: "Tab",
  "`": "Backquote",
  "[": "BracketLeft",
  "]": "BracketRight",
  ",": "Comma",
  ".": "Period",
  "+": "Equal",
  "-": "Minus",
  "\\": "Backslash",
  "↑": "ArrowUp",
  "↓": "ArrowDown",
  "←": "ArrowLeft",
  "→": "ArrowRight",
};

const DISPLAY_MODIFIERS: [string, string][] = IS_MAC
  ? [
      ["⌘", "Command"],
      ["⌃", "Control"],
      ["⌥", "Option"],
      ["⇧", "Shift"],
    ]
  : [
      ["Ctrl+", "Control"],
      ["Alt+", "Option"],
      ["Shift+", "Shift"],
    ];

const QUICK_COMPOSER_COMMAND = "App: Quick Composer";
const ACTIVATE_RANGE_COMMAND = "Tab: Activate 1–8";

/**
 * Every chord a command owns by default, in stored form. Grouped rows expand
 * to one chord per key so a rebind can never shadow a working shortcut.
 */
function defaultShortcutsFor(command: string): string[] {
  const row = KEYBINDINGS.find((entry) => entry.command === command);
  if (!row) return [];
  let rest = row.keys;
  const modifiers: string[] = [];
  for (const [display, modifier] of DISPLAY_MODIFIERS) {
    if (rest.startsWith(display)) {
      modifiers.push(modifier);
      rest = rest.slice(display.length);
    }
  }
  const chords = (code: string) => {
    const value = canonicalShortcut(modifiers.length ? [...modifiers, code].join("+") : code);
    return value ? [value] : [];
  };
  if (row.keys.includes("…")) {
    return [1, 2, 3, 4, 5, 6, 7, 8].flatMap((digit) => chords(`Digit${digit}`));
  }
  if (/^[A-Za-z]$/.test(rest)) return chords(`Key${rest.toUpperCase()}`);
  if (/^[0-9]$/.test(rest)) return chords(`Digit${rest}`);
  if (KEY_CODES[rest]) return chords(KEY_CODES[rest]);
  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(rest)) return chords(rest);
  return [];
}

/** Chord to owning command, covering defaults, live overrides and Quick Composer. */
function shortcutOwners(): Map<string, string> {
  const owners = new Map<string, string>();
  for (const row of KEYBINDINGS) {
    // The Quick Composer chord is stored separately from the table.
    const chords =
      row.command === QUICK_COMPOSER_COMMAND
        ? [loadQuickComposerShortcut()]
        : defaultShortcutsFor(row.command);
    for (const chord of chords) owners.set(chord, row.command);
  }
  for (const [command, override] of Object.entries(loadKeybindingOverrides())) {
    if (override.shortcut) owners.set(override.shortcut, command);
  }
  return owners;
}

function validateShortcut(command: string, shortcut: string): string {
  const canonical = canonicalShortcut(shortcut);
  if (!canonical) throw new Error("That combination is not a valid shortcut");
  if (command === ACTIVATE_RANGE_COMMAND && !/Digit[1-8]$/.test(canonical)) {
    throw new Error("Tab: Activate 1–8 needs a number key from 1 to 8");
  }
  return canonical;
}

/** Shared by both save paths so no chord can be claimed twice. */
export function validateKeybindingShortcut(command: string, shortcut: string): string {
  const canonical = validateShortcut(command, shortcut);
  const owner = shortcutOwners().get(canonical);
  if (owner && owner !== command) {
    throw new Error(`Already used by ${owner}`);
  }
  return canonical;
}

let cacheStorage: Storage | null = null;
let cacheRaw: string | null = null;
let cacheValue: KeybindingOverrides = {};

function parseKeybindingOverrides(raw: string | null): KeybindingOverrides {
  const value = JSON.parse(raw ?? "{}");
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const next: KeybindingOverrides = {};
  for (const [command, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!VALID_COMMANDS.has(command) || !entry || typeof entry !== "object") continue;
    const override = entry as { disabled?: unknown; shortcut?: unknown };
    const disabled = override.disabled === true;
    const shortcut =
      typeof override.shortcut === "string"
        ? (canonicalShortcut(override.shortcut) ?? undefined)
        : undefined;
    if (shortcut) next[command] = { shortcut };
    else if (disabled) next[command] = { disabled: true };
  }
  return next;
}

/** Cached per raw value: this runs several times on every keydown. Returns a fresh object. */
export function loadKeybindingOverrides(): KeybindingOverrides {
  try {
    const storage = localStorage;
    const raw = storage.getItem(KEYBINDING_OVERRIDES_KEY);
    if (cacheStorage === storage && cacheRaw === raw) return { ...cacheValue };
    const next = parseKeybindingOverrides(raw);
    cacheStorage = storage;
    cacheRaw = raw;
    cacheValue = next;
    return { ...next };
  } catch {
    return {};
  }
}

export function saveKeybindingOverride(
  command: string,
  override: KeybindingOverride,
): KeybindingOverrides {
  const next = loadKeybindingOverrides();
  if (override.disabled) next[command] = { disabled: true };
  else if (override.shortcut) {
    const shortcut = validateKeybindingShortcut(command, override.shortcut);
    next[command] = { shortcut };
  } else delete next[command];
  try {
    if (Object.keys(next).length) {
      localStorage.setItem(KEYBINDING_OVERRIDES_KEY, JSON.stringify(next));
    } else {
      localStorage.removeItem(KEYBINDING_OVERRIDES_KEY);
    }
  } catch {
    throw new Error("Could not save shortcuts");
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(KEYBINDINGS_CHANGE_EVENT));
  }
  return next;
}

export type ShortcutEvent = Pick<KeyboardEvent, "code"> &
  Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

export function shortcutMatches(shortcut: string, event: ShortcutEvent): boolean {
  // Copy the fields: real keyboard events expose modifiers as prototype
  // accessors, so spreading the event would silently drop all of them.
  return (
    shortcutFromKeyEvent({
      code: event.code,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
    }) === shortcut
  );
}

export function matchCustomKeybinding(event: ShortcutEvent): string | null {
  for (const [command, override] of Object.entries(loadKeybindingOverrides())) {
    if (override.shortcut && shortcutMatches(override.shortcut, event)) {
      return command;
    }
  }
  return null;
}

export function keybindingPressed(
  command: string,
  event: ShortcutEvent,
  defaultMatch: boolean,
): boolean {
  const override = loadKeybindingOverrides()[command];
  if (override?.disabled) return false;
  if (override?.shortcut) return shortcutMatches(override.shortcut, event);
  return defaultMatch;
}

export function keybindingShortcutLabel(command: string, fallback: string): string | null {
  const override = loadKeybindingOverrides()[command];
  if (override?.disabled) return null;
  return override?.shortcut ? quickComposerShortcutLabel(override.shortcut) : fallback;
}

export function keybindingShortcutTokens(command: string, fallback: string): string | null {
  const override = loadKeybindingOverrides()[command];
  if (override?.disabled) return null;
  return override?.shortcut ? shortcutTokens(override.shortcut) : fallback;
}

export function subscribeKeybindings(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEYBINDING_OVERRIDES_KEY) onStoreChange();
  };
  window.addEventListener(KEYBINDINGS_CHANGE_EVENT, onStoreChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(KEYBINDINGS_CHANGE_EVENT, onStoreChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function currentKeybindings(): KeybindingRow[] {
  const overrides = loadKeybindingOverrides();
  return KEYBINDINGS.map((row) => {
    if (row.command === "App: Quick Composer") {
      return {
        ...row,
        keys: loadQuickComposerEnabled()
          ? quickComposerShortcutLabel(loadQuickComposerShortcut())
          : "Disabled",
      };
    }
    const override = overrides[row.command];
    return {
      ...row,
      keys: override?.disabled
        ? "Disabled"
        : override?.shortcut
          ? quickComposerShortcutLabel(override.shortcut)
          : row.command === "Terminal: Toggle Dock"
            ? `${row.keys} / Ctrl+"`
            : row.keys,
    };
  });
}

export function filterKeybindings(rows: KeybindingRow[], query: string): KeybindingRow[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter(
    (row) =>
      row.command.toLowerCase().includes(needle) ||
      row.keys.toLowerCase().includes(needle) ||
      row.when.toLowerCase().includes(needle),
  );
}

const INLINE_BLAME_KEY = "bycoda.inlineBlame";

export const INLINE_BLAME_DEFAULT = false;

/** Fired on `window` when the editor's inline blame gutter is switched. */
export const INLINE_BLAME_CHANGE_EVENT = "bycoda:inline-blame-change";

/** Whether editors show the per-line blame gutter. */
const inlineBlameSetting = storedFlag(
  INLINE_BLAME_KEY,
  INLINE_BLAME_DEFAULT,
  INLINE_BLAME_CHANGE_EVENT,
  false,
);

export function loadInlineBlame(): boolean {
  return inlineBlameSetting.load() ?? INLINE_BLAME_DEFAULT;
}

export function saveInlineBlame(value: boolean) {
  inlineBlameSetting.save(value);
}

export const subscribeInlineBlame = inlineBlameSetting.subscribe;

const AUTO_CONTINUE_INTERRUPTED_KEY = "bycoda.autoContinueInterrupted";

export const AUTO_CONTINUE_INTERRUPTED_DEFAULT = true;

/**
 * Whether a turn that was cut off when Bycoda quit is continued on its own at
 * the next launch. Off leaves an "Interrupted - Continue" action on the chat.
 */
export function loadAutoContinueInterrupted(): boolean {
  return readFlag(AUTO_CONTINUE_INTERRUPTED_KEY) ?? AUTO_CONTINUE_INTERRUPTED_DEFAULT;
}

export function saveAutoContinueInterrupted(value: boolean) {
  writeFlag(AUTO_CONTINUE_INTERRUPTED_KEY, value);
}
