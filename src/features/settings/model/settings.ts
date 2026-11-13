import { modelsSettingsEntries } from "./modelsSettingsEntries";
import {
  createStoredSetting,
  storedFlag,
  subscribePreferenceChanges,
} from "../../../shared/lib/storedSetting";
import { ACCOUNT_SECTION } from "./accountSection";
import { SECRETS_SECTION } from "./secretsSection";
import { SETTINGS_GROUPS, SETTINGS_SECTION_ORDER, type SettingsGroupId } from "./settingsGroups";
import { t, sourceMessages } from "../../../shared/i18n/core";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { HARNESSES, HARNESS_TITLE } from "../../../shared/model/harnessIdentity";
import {
  ALT,
  FULLSCREEN_SHORTCUT,
  IS_LINUX,
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
import { DESKTOP_STOP_COMMAND, DESKTOP_TALK_ROW, requireGlobal } from "./desktopStopKeybinding";
import { APPEARANCE_SETTINGS_INDEX } from "./appearanceSettingsIndex";
import { PRIVACY_SETTINGS_INDEX } from "./privacySettingsIndex";
import { GENERAL_SETTINGS_INDEX } from "./generalSettingsIndex";
import {
  INTEGRATIONS_CONTROL_LABELS,
  INTEGRATIONS_SETTINGS_INDEX,
} from "./integrationsSettingsIndex";
const SECTION_KEY = "bycoda.settingsSection";
export type StreamingTextMode = "paced" | "adaptive";
const streamingTextModeSetting = createStoredSetting<StreamingTextMode>({
  key: "bycoda.streamingTextMode",
  fallback: "paced",
  event: "bycoda:streaming-text-mode-change",
  storageEvents: true,
  parse: (value) => (value === "adaptive" ? "adaptive" : "paced"),
  serialize: String,
});
export const loadStreamingTextMode = streamingTextModeSetting.load;
export const subscribeStreamingTextMode = streamingTextModeSetting.subscribe;
export function saveStreamingTextMode(value: StreamingTextMode) {
  streamingTextModeSetting.save(value === "adaptive" ? "adaptive" : "paced");
}

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
  | "voice"
  | "providers"
  | "models"
  | "crews"
  | "usage"
  | "limits"
  | "mcp"
  | "skills"
  | "integrations"
  | "account"
  | "secrets"
  /** Retired home of the Inbox credential cards; opening it lands on Integrations. */
  | "inbox"
  | "worktrees"
  | "groupLock"
  | "archive";

export type { SettingsGroupId };

export type SettingsSection = {
  id: SettingsSectionId;
  group: SettingsGroupId;
  label: string;
  description: string;
  /** Extra words search matches the section on, beyond its label. */
  keywords?: string;
};

export const SETTINGS_SECTIONS: SettingsSection[] = [
  ACCOUNT_SECTION,
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
    id: "keybindings",
    group: "app",
    get label() {
      return t("Keybindings");
    },
    get description() {
      return t("Application shortcuts and the global quick composer shortcut.");
    },
    keywords: "shortcut hotkey keyboard binding",
  },
  {
    id: "groupLock",
    group: "app",
    get label() {
      return t("Privacy and security");
    },
    get description() {
      return t(
        "File access, startup privacy and project group protection. Hidden projects stay on disk.",
      );
    },
    keywords:
      "email file access password privacy hide hidden restore private protect secure passcode gizli gizle geri getir görünür",
  },
  {
    id: "workspace",
    group: "code",
    get label() {
      return t("Workspace");
    },
    get description() {
      return t("Workspace tools, file tabs and editing.");
    },
    keywords: "notes agents rail editor files format save explorer",
  },
  {
    id: "terminal",
    group: "app",
    get label() {
      return t("Terminal");
    },
    get description() {
      return t("Default shells for this computer, synced sessions and remote hosts.");
    },
    keywords: "shell profile bash git bash powershell pwsh cmd command prompt wsl zsh fish default",
  },
  {
    id: "connections",
    group: "connections",
    get label() {
      return t("Connections");
    },
    get description() {
      return t("Manage your computers, phone access, and tunnels.");
    },
    keywords: "ssh remote host machine server environment always on",
  },
  {
    id: "worktrees",
    group: "code",
    get label() {
      return t("Source control");
    },
    get description() {
      return t("Commit and pull request generation, code review and project worktrees.");
    },
    keywords:
      "git branch worktree working copy project create delete commit pull request generation diff review retention pin cleanup disk budget storage kaynak kontrolü",
  },
  {
    id: "integrations",
    group: "connections",
    get label() {
      return t("Integrations");
    },
    get description() {
      return t("Connect the services {p0} reads from and replies through.", {
        p0: PRODUCT_IDENTITY.displayName,
      });
    },
    keywords:
      "inbox github gitlab azure devops jira atlassian linear slack discord teams email gmail outlook hotmail yahoo icloud imap smtp connect token integration",
  },
  {
    id: "archive",
    group: "about",
    get label() {
      return t("Archive settings");
    },
    get description() {
      return t("Projects and conversations you have archived.");
    },
    keywords: "archived restore delete hidden",
  },
  {
    id: "crews",
    group: "agents",
    get label() {
      return t("Crews");
    },
    get description() {
      return t("Reusable agent teams, project crews and model allocation policies.");
    },
    keywords:
      "crew team coordinator specialist reviewer advisor orchestration model cost quality capability",
  },
  {
    id: "chat",
    group: "app",
    get label() {
      return t("Chat");
    },
    get description() {
      return t("Conversation layout, text display, translation, follow-ups and prompt templates.");
    },
    keywords: "transcript composer prompt message layout template snippet trigger queue",
  },
  {
    id: "voice",
    group: "app",
    get label() {
      return t("Voice assistant");
    },
    get description() {
      return t("Dictation, voice companion, speakers and conversation style.");
    },
    keywords:
      "voice speech dictation microphone companion speaker whisper realtime grok openai ses dikte mikrofon",
  },
  {
    id: "providers",
    group: "agents",
    get label() {
      return t("Providers");
    },
    get description() {
      return t("Provider accounts, agent CLIs and ACP agents for {p0}.", {
        p0: PRODUCT_IDENTITY.displayName,
      });
    },
    keywords: "account sign in login model harness claude codex cli default hooks",
  },
  {
    id: "models",
    group: "agents",
    get label() {
      return t("Models");
    },
    get description() {
      return t("Model order, assignments, chat defaults and subagents.");
    },
    keywords:
      "order routing pools roles limits default provider model effort permissions fast subagents advisor image models",
  },
  {
    id: "usage",
    group: "agents",
    get label() {
      return t("Provider usage");
    },
    get description() {
      return t("Provider limits, remaining capacity and usage by project.");
    },
    keywords: "quota limits weekly session tokens cost",
  },
  {
    id: "limits",
    group: "agents",
    get label() {
      return t("Limits & budgets");
    },
    get description() {
      return t(
        "Manage account limits and add usage budgets for projects, sessions and workspaces.",
      );
    },
    keywords: "quota limit budget spending cost token threshold allocation",
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
      return t("Discover and manage skills on this computer and connected machines.");
    },
    keywords: "skill instructions prompt",
  },
  SECRETS_SECTION,
  {
    id: "policies",
    group: "about",
    get label() {
      return t("Policies");
    },
    get description() {
      return t("Privacy, terms of use, third-party services and software license.");
    },
    keywords:
      "privacy policy terms legal license data deletion tracking gizlilik politika koşullar lisans veri silme takip",
  },
];

export function settingsSectionsByGroup(): {
  id: SettingsGroupId;
  label: string;
  sections: SettingsSection[];
}[] {
  return SETTINGS_GROUPS.map((group) => ({
    ...group,
    sections: SETTINGS_SECTIONS.filter((section) => section.group === group.id).sort(
      (a, b) => SETTINGS_SECTION_ORDER.indexOf(a.id) - SETTINGS_SECTION_ORDER.indexOf(b.id),
    ),
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
  ...GENERAL_SETTINGS_INDEX,
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
      return t("Files, projects and skills");
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
      return t("Automatic locking");
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
    id: "external-mcp-access",
    section: "mcp",
    get label() {
      return t("External MCP access");
    },
    keywords: "mcp external token bearer scopes read write revoke dış erişim yetki iptal",
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
    id: "workspace-policy",
    section: "worktrees",
    get label() {
      return t("Workspace policy");
    },
    keywords: "default workspace mode current checkout worktree host project policy",
  },
  {
    id: "default-workspace-mode",
    section: "worktrees",
    get label() {
      return t("Default workspace");
    },
    keywords: "current checkout worktree new session default mode",
  },
  {
    id: "workspace-pinning",
    section: "worktrees",
    get label() {
      return t("Pin workspaces");
    },
    keywords: "pin new workspaces retention automatic cleanup keep never",
  },
  {
    id: "workspace-retention",
    section: "worktrees",
    get label() {
      return t("Automatic cleanup");
    },
    keywords: "directory retention cleanup lifecycle active idle finished merged closed never days",
  },
  {
    id: "workspace-disk-policy",
    section: "worktrees",
    get label() {
      return t("Storage limits");
    },
    keywords: "disk budget warning free space gib directories cleanup",
  },
  {
    id: "workspace-storage-status",
    section: "worktrees",
    get label() {
      return t("Workspace storage");
    },
    keywords: "disk usage cache recovery blocked paused free space",
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
    id: "update-channel",
    section: "general",
    get label() {
      return t("Preview updates");
    },
    keywords: "update channel preview beta early insider stable feed",
  },
  {
    id: "import-history",
    section: "general",
    get label() {
      return t("Import history");
    },
    keywords: "history conversations terminal resume migrate existing claude codex",
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
    id: "send-feedback",
    section: "general",
    get label() {
      return t("Send feedback");
    },
    keywords: "feedback report bug problem suggestion idea contact support help geri bildirim",
  },
  {
    id: "star-github",
    section: "general",
    get label() {
      return t("Star on GitHub");
    },
    keywords: "github star repository open source contribute project support yıldız",
  },
  {
    id: "contribute",
    section: "general",
    get label() {
      return t("Contribute to bycoda");
    },
    keywords: "open source clone repository github contribution about",
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
    id: "exact-git-rewind",
    section: "workspace",
    get label() {
      return t("Exact Git rewind (experimental)");
    },
    keywords: "experimental exact git rewind snapshot managed worktree host capture turn",
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
    id: "streaming-text-mode",
    section: "chat",
    get label() {
      return t("Streaming text animation");
    },
    keywords: "stream text animation paced adaptive fade cadence immediate",
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
    id: "chat-width",
    section: "chat",
    get label() {
      return t("Chat width");
    },
    keywords: "comfortable wide full messages composer",
  },
  {
    id: "code-word-wrap",
    section: "chat",
    get label() {
      return t("Word wrap");
    },
    keywords: "code long lines wrapping",
  },
  // Linux has no window glass row; its main pane glass covers translucency.
  ...(IS_LINUX
    ? []
    : [
        {
          id: "window-glass",
          section: "appearance" as const,
          get label() {
            return t("Window glass");
          },
          keywords: "acrylic mica vibrancy transparent opaque performance gpu",
        },
      ]),
  {
    id: "show-excluded-files",
    section: "workspace",
    get label() {
      return t("Show excluded files");
    },
    keywords: "explorer gitignore ignored hidden files tree",
  },
  {
    id: "helper-models",
    section: "chat",
    get label() {
      return t("Translation, reprompt and title models");
    },
    keywords:
      "helper default translation translate reprompt rewrite title conversation model provider çeviri başlık yeniden yaz varsayılan",
  },
  {
    id: "git-generation-default",
    section: "worktrees",
    get label() {
      return t("Commit and pull request generation");
    },
    keywords: "git commit pull request generation model provider default varsayılan mesaj",
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
    id: "dictation-enabled",
    section: "voice",
    get label() {
      return t("Enable dictation");
    },
    keywords: "dictate dictation speech to text microphone diktate dikte yazdır mikrofon",
  },
  {
    id: "speech-microphone",
    section: "voice",
    get label() {
      return t("Microphone access");
    },
    keywords: "microphone permission privacy macos windows linux mikrofon izin",
  },
  {
    id: "voice-companion",
    section: "voice",
    get label() {
      return t("Voice companion");
    },
    keywords:
      "voice speech microphone whisper voxcpm python models ses konuşma mikrofon sesli model kurulum",
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
    id: "composer-spelling",
    section: "chat",
    get label() {
      return t("Spelling and autocorrect");
    },
    keywords:
      "spellcheck spelling autocorrect correction yazım düzeltme queue steer interrupt send while running",
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
    id: "auto-save",
    section: "workspace",
    get label() {
      return t("Autosave");
    },
    keywords: "autosave auto save automatic saving editor file files unsaved otomatik kaydet",
  },
  {
    id: "format-on-save",
    section: "workspace",
    get label() {
      return t("Format on save");
    },
    keywords: "oxfmt biome prettier formatter quotes editor save format",
  },
  {
    id: "diff-view",
    section: "worktrees",
    get label() {
      return t("Diff view");
    },
    keywords: "unified editor review changes working tree",
  },
  ...modelsSettingsEntries,
  {
    id: "agent-clis",
    section: "models",
    get label() {
      return t("Chat defaults");
    },
    get keywords() {
      return `codex opencode cursor grok pi omp fx hermes antigravity google default model effort reasoning permissions fast compact ${t("Default provider")} ${t("Default model")}`;
    },
  },
  {
    id: "enabled-models",
    section: "providers",
    get label() {
      return t("Catalog");
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
    id: "decision-models",
    section: "providers",
    get label() {
      return t("Decision models");
    },
    keywords: "local model ollama classifier routing threshold scan privacy decision source",
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
    id: "provider-usage",
    section: "usage",
    get label() {
      return t("Provider usage");
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
    id: "show-archived",
    section: "archive",
    get label() {
      return t("Show archived in the sidebar");
    },
    keywords: "hidden conversations list",
  },
  ...[
    {
      id: "mcp-scopes",
      section: "mcp",
      label: "Advanced: scopes and connection status",
      keywords: "scope personal user project local configuration status kapsam kişisel proje yerel",
    },
    {
      id: "file-access-permissions",
      section: "groupLock",
      label: "Advanced: file access and agent permissions",
      keywords: "file access permission approval rules native consent dosya erişim izin onay",
    },
    {
      id: "worktree-location",
      section: "worktrees",
      label: "Advanced: worktree location and deletion",
      keywords: "worktree folder path location delete root konum klasör yol silme",
    },
    {
      id: "archived-projects",
      section: "archive",
      label: "Archived projects",
      keywords: "restore delete archived project geri yükle sil arşiv proje",
    },
    {
      id: "archived-conversations",
      section: "archive",
      label: "Archived conversations",
      keywords: "restore delete archived conversation session geri yükle sil arşiv sohbet oturum",
    },
    {
      id: "keep-awake-duration",
      section: "general",
      label: "After agents finish",
      keywords: "sleep awake duration hold minutes uyku süre",
    },
    {
      id: "policy-language",
      section: "policies",
      label: "Policy language",
      keywords: "documents language offline english turkish politika belge dil",
    },
    {
      id: "theme-palettes",
      section: "appearance",
      label: "Theme palettes",
      keywords: "theme palette colors preset tint lightness accent tema palet renk hazır",
    },
    {
      id: "saved-themes",
      section: "appearance",
      label: "Saved themes",
      keywords: "save look appearance preset custom theme name restore tema kaydet görünüm",
    },
    {
      id: "background-library",
      section: "appearance",
      label: "Background image library",
      keywords: "images generated history gallery wallpaper saved again kütüphane görsel arka plan",
    },
    {
      id: "getting-started",
      section: "general",
      label: "Getting started",
      keywords: "setup onboarding guide help kurulum başlangıç",
    },
    {
      id: "group-lock-startup",
      section: "groupLock",
      label: "Lock on startup",
      keywords: "privacy password launch gizlilik parola başlangıç",
    },
    {
      id: "group-lock-idle",
      section: "groupLock",
      label: "Lock when idle",
      keywords: "inactivity timeout password boşta süre parola",
    },
    {
      id: "group-unlock-together",
      section: "groupLock",
      label: "Unlock groups together",
      keywords: "unlock all password gruplar kilit birlikte",
    },
    {
      id: "terminal-available-shells",
      section: "terminal",
      label: "Advanced terminal settings",
      keywords: "local available shells discovery advanced gelişmiş kabuk keşif",
    },
    {
      id: "host-shells",
      section: "terminal",
      label: "Default shell",
      keywords: "remote server local sync host shell ssh uzak sunucu kabuk",
    },
    {
      id: "acp-agents",
      section: "providers",
      label: "ACP agents",
      keywords: "generic executable command agent id name acp ajan çalıştırılabilir",
    },
    {
      id: "acp-advanced",
      section: "providers",
      label: "ACP arguments, environment and model context",
      keywords:
        "json arguments environment authentication context tokens argüman ortam kimlik bağlam",
    },
    {
      id: "acp-registry",
      section: "providers",
      label: "Browse ACP Registry",
      keywords: "registry install discover acp katalog keşfet kur",
    },
    {
      id: "account-limits",
      section: "usage",
      label: "Provider account limit",
      keywords: "quota weekly session reset account limits kota hafta oturum hesap sınır",
    },
    {
      id: "cost-overview",
      section: "usage",
      label: "Cost by project and day",
      keywords:
        "range cost tokens input output cache api estimates dates project model provider maliyet gün tarih aralık tahmin token",
    },
    {
      id: "terminal-account-profiles",
      section: "providers",
      label: "Terminal account profiles",
      keywords:
        "discover connect directory folder cli sign in profile terminal hesap profil klasör keşfet",
    },
    {
      id: "code-theme",
      section: "appearance",
      label: "Code theme",
      keywords: "syntax highlighting github dark dracula code theme kod tema renk",
    },
    {
      id: "code-font-size",
      section: "appearance",
      label: "Code font size",
      keywords: "code text size px kod yazı boyut",
    },
    {
      id: "terminal-font",
      section: "appearance",
      label: "Terminal font",
      keywords:
        "terminal font family typeface yazı tipi monospace cascadia jetbrains same as code font",
    },
    {
      id: "terminal-font-size",
      section: "appearance",
      label: "Terminal font size",
      keywords: "terminal zoom ctrl wheel size büyüt küçült tekerlek boyut",
    },
    {
      id: "terminal-font-weight",
      section: "appearance",
      label: "Terminal font weight",
      keywords: "terminal weight bold regular medium kalınlık stil",
    },
    {
      id: "terminal-line-height",
      section: "appearance",
      label: "Terminal line spacing",
      keywords: "terminal line height spacing satır aralık",
    },
    {
      id: "skill-folders",
      section: "skills",
      label: "Advanced: catalog visibility and skill folders",
      keywords: "skills personal project folders hidden catalog beceri kişisel proje klasör gizli",
    },
  ].map((item) => ({
    id: item.id,
    section: item.section as SettingsSectionId,
    get label() {
      return t(item.label);
    },
    keywords: item.keywords,
  })),
  {
    id: "terminal-account-profiles-codex",
    section: "providers",
    get label() {
      return `Codex · ${t("Terminal account profiles")}`;
    },
    keywords:
      "codex discover connect directory folder cli sign in profile terminal hesap profil klasör keşfet",
  },
  ...HARNESSES.map((harness) => ({
    id: `cli-path-${harness}`,
    section: "providers" as const,
    get label() {
      return t("{p0} CLI path and installation", { p0: HARNESS_TITLE[harness] });
    },
    keywords: `${harness} ${HARNESS_TITLE[harness]} executable binary path install cli yol kurulum`,
  })),
  ...[
    { id: "finished", label: "Agent finished", keywords: "finished complete done ajan tamamlandı" },
    { id: "input", label: "Needs your input", keywords: "approval question input onay soru" },
    {
      id: "failed",
      label: "Failed or usage limit",
      keywords: "failure error quota limit hata sınır",
    },
    {
      id: "taskbar",
      label: "Taskbar badge and flash",
      keywords: "windows badge flash taskbar rozet görev çubuğu",
    },
  ].map((item) => ({
    id: `notification-event-${item.id}`,
    section: "notifications" as const,
    get label() {
      return t(item.label);
    },
    keywords: item.keywords,
  })),
  ...APPEARANCE_SETTINGS_INDEX,
  ...PRIVACY_SETTINGS_INDEX,
  ...INTEGRATIONS_SETTINGS_INDEX,
];

export type SettingsSearchResult = {
  section: SettingsSectionId;
  sectionLabel: string;
  /** Row to scroll to, or `null` when the whole section matched. */
  settingId: string | null;
  label: string;
};

/** A stable setting anchor follows its current category, including older callers. */
export function settingsSectionForAnchor(
  section: SettingsSectionId | undefined,
  anchor?: string | null,
): SettingsSectionId | undefined {
  const target =
    (anchor && SETTINGS_INDEX.find((entry) => entry.id === anchor)?.section) || section;
  return target === "inbox" ? "integrations" : target;
}

/** Shared with shortcut rows so search uses the same stable anchor. */
export const keybindingSettingId = (command: string) => `keybinding-${encodeURIComponent(command)}`;

/** Labels of controls inside a group target, searched in both UI and source language. */
const SETTINGS_CONTROL_LABELS: Record<string, readonly string[]> = {
  "git-generation-default": ["Default generation model"],
  theme: ["Theme and colors", "System", "Light", "Dark"],
  "theme-palettes": ["Blue", "Violet", "Pink", "Red", "Orange", "Green"],
  "canvas-background": ["Pure", "Tinted"],
  "file-access": ["File access", "Change file access"],
  "file-access-permissions": ["File access"],
  "import-history": ["Import Claude Code and Codex sessions"],
  "file-tabs": ["Beside chat", "Top bar"],
  "collapsed-project-rail": ["Icon rail", "Hidden"],
  "session-list": [
    "Row density",
    "Compact",
    "Standard",
    "Detailed",
    "Show model",
    "Show branch",
    "Group after holding",
  ],
  "diff-colors": ["Red & green", "Blue & orange", "Blue & orange · stronger"],
  "chat-width": ["Comfortable", "Wide", "Full width"],
  "interface-font": ["System default"],
  "transcript-layout": ["Full width", "Chat"],
  "composer-spelling": ["Queue", "Steer"],
  "model-controls": [
    "Compact",
    "Show active choices",
    "Advanced conversation settings",
    "Continuation and model options",
  ],
  "streaming-text-mode": ["Paced (default)", "Immediate with adaptive fade"],
  "crew-growth": ["Color with context", "Grow with context"],
  "chat-background": ["Empty only", "All sessions"],
  "live-background": ["Neural tree", "Latent face", "Thought weaver", "ASCII mask"],
  "format-on-save": ["Editor", "Advanced editor settings"],
  "diff-view": ["Editor", "Unified", "Code review"],
  "models-delegation": ["Subagents", "Advisor", "Subagent max effort", "Image models"],
  "agent-clis": [
    "Agent CLIs",
    "Model",
    "Default provider",
    "Default model",
    "Effort",
    "Permissions",
    "Default extras",
    "Show in picker",
    "Apply defaults to",
    "Global",
  ],
  "provider-accounts": [
    "Accounts",
    "Default account",
    "Provider CLI profile",
    "Shared CLI profile",
    "Isolated profile",
  ],
  "acp-agents": ["Agent id", "Name", "Executable path"],
  "acp-advanced": [
    "Arguments (JSON array)",
    "Environment (JSON object; blank preserves stored values)",
    "ACP authentication method id (optional)",
    "Context window tokens (optional)",
  ],
  "prompt-templates": ["Template name", "Template trigger", "Template text"],
  "cost-overview": ["Cost range", "Estimated cost", "Input", "Output", "Cache"],
  "daily-summary": ["Daily summary time"],
  "mcp-scopes": ["Scope", "Personal", "Project", "Local project"],
  "terminal-available-shells": ["Advanced terminal settings", "This computer · Available shells"],
  "group-lock-options": ["Advanced: automatic locking"],
  "claude-hooks": ["Advanced provider options"],
  "archived-projects": ["Restore", "Delete"],
  "archived-conversations": ["Restore", "Delete"],
  "project-notifications": [
    "Mute",
    "Reminders",
    "Pull requests / Merge requests",
    "Issues and Linear tasks",
    "Agent approvals and questions",
    "Agent failures and usage limits",
  ],
  ...INTEGRATIONS_CONTROL_LABELS,
  "group-lock-password": [
    "Change password…",
    "Remove password…",
    "Forgot password…",
    "Set lock password…",
  ],
};

/** Ranks a label/keyword pair against a lowercased needle; `null` means no match. */
function matchScore(needle: string, label: string, keywords?: string): number | null {
  const labels = [label, ...sourceMessages(label)].map((value) => value.toLowerCase());
  if (labels.some((value) => value === needle)) return 0;
  if (labels.some((value) => value.startsWith(needle))) return 1;
  if (labels.some((value) => value.includes(needle))) return 2;
  if (keywords?.toLowerCase().includes(needle)) return 3;
  return null;
}

/** Individual settings first, then whole sections, so a row wins its own name. */
export function searchSettings(query: string, limit = 8): SettingsSearchResult[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const scored: { score: number; result: SettingsSearchResult }[] = [];

  const entries: SettingsEntry[] = [
    ...SETTINGS_INDEX,
    ...currentKeybindings().map((row) => ({
      id: keybindingSettingId(row.command),
      section: "keybindings" as const,
      label: t(row.command),
      keywords: `${row.command} ${row.keys ?? ""} ${t(row.when)} ${row.when}`,
    })),
  ];
  for (const entry of entries) {
    const controls = entry.id.startsWith("cli-path-")
      ? ["CLI path and installation", "Executable path", "Installation help"]
      : (SETTINGS_CONTROL_LABELS[entry.id] ?? []);
    const scores = [
      matchScore(needle, entry.label, entry.keywords),
      ...controls.map((label) => matchScore(needle, t(label))),
    ].filter((score): score is number => score != null);
    if (scores.length === 0) continue;
    const score = Math.min(...scores);
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
      `${section.description} ${sourceMessages(section.description).join(" ")} ${section.keywords ?? ""}`,
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

  const seen = new Set<string>();
  return scored
    .sort((a, b) => a.score - b.score || a.result.label.localeCompare(b.result.label))
    .filter(({ result }) => {
      const target = `${result.section}:${result.settingId ?? "*"}`;
      if (seen.has(target)) return false;
      seen.add(target);
      return true;
    })
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

/**
 * How a page wants to be presented. `bounded`: short preferences and forms in a readable
 * track over the work context. `wide`: collections, tables and analytics that need a
 * usable width. `workspace`: list/detail libraries that own the full height and are
 * the pages worth maximizing. A hint only: the embedding surface decides the geometry
 * and a page never remounts when it changes.
 */
export type SettingsPresentation = "bounded" | "wide" | "workspace";

/** Pages that persist every change themselves; the header says so once. */
export const AUTOMATIC_SAVE_SECTIONS: readonly string[] = [
  "general",
  "appearance",
  "workspace",
  "chat",
  "voice",
  "terminal",
];

const SETTINGS_PRESENTATION: Record<SettingsSectionId, SettingsPresentation> = {
  general: "bounded",
  appearance: "bounded",
  workspace: "bounded",
  terminal: "bounded",
  chat: "bounded",
  voice: "bounded",
  notifications: "bounded",
  groupLock: "bounded",
  policies: "bounded",
  providers: "wide",
  models: "wide",
  mcp: "wide",
  connections: "wide",
  inbox: "bounded",
  integrations: "bounded",
  account: "bounded",
  secrets: "bounded",
  crews: "wide",
  keybindings: "wide",
  usage: "wide",
  limits: "wide",
  skills: "workspace",
  archive: "bounded",
  worktrees: "workspace",
};

export function settingsSectionPresentation(id: SettingsSectionId): SettingsPresentation {
  return SETTINGS_PRESENTATION[id] ?? "bounded";
}

export function loadSettingsSection(): SettingsSectionId {
  try {
    const raw = localStorage.getItem(SECTION_KEY);
    if (raw === "inbox") return "integrations";
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

const COMPOSER_EFFORT_VISIBLE_KEY = "bycoda.composerEffortVisible";

const MODEL_CONTROLS_KEY = "bycoda.modelControls";

const FILE_TAB_MODE_KEY = "bycoda.fileTabMode";
const FILE_TAB_MODE_CHANGE_EVENT = "bycoda:file-tab-mode-change";

const TAB_ANIMATIONS_ENABLED_KEY = "bycoda.tabAnimationsEnabled";

const COLLAPSED_PROJECT_RAIL_MODE_KEY = "bycoda.collapsedProjectRailMode";

export type FollowUpBehavior = "steer" | "queue";

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
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(FILE_TAB_MODE_CHANGE_EVENT));
  }
}

export const subscribeFileTabMode = (onChange: () => void) =>
  subscribePreferenceChanges([FILE_TAB_MODE_KEY], FILE_TAB_MODE_CHANGE_EVENT, onChange);

export const TAB_ANIMATIONS_ENABLED_DEFAULT = false;

export function loadTabAnimationsEnabled(): boolean {
  return readFlag(TAB_ANIMATIONS_ENABLED_KEY) ?? TAB_ANIMATIONS_ENABLED_DEFAULT;
}

export function saveTabAnimationsEnabled(value: boolean) {
  writeFlag(TAB_ANIMATIONS_ENABLED_KEY, value);
  if (typeof window !== "undefined")
    window.dispatchEvent(new CustomEvent("bycoda:tab-animations-change"));
}

export const subscribeTabAnimationsEnabled = (onChange: () => void) =>
  subscribePreferenceChanges(
    [TAB_ANIMATIONS_ENABLED_KEY],
    "bycoda:tab-animations-change",
    onChange,
  );

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
  storageEvents: true,
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
  return subscribePreferenceChanges(
    [MODEL_CONTROLS_KEY, COMPOSER_EFFORT_VISIBLE_KEY],
    MODEL_CONTROLS_CHANGE_EVENT,
    onStoreChange,
  );
}

const NOTES_ENABLED_KEY = "bycoda.notesEnabled";

export const NOTES_ENABLED_DEFAULT = true;

/** Fired on `window` when the Notes UI setting flips. */
export const NOTES_ENABLED_CHANGE_EVENT = "bycoda:notes-enabled-change";

const notesEnabledSetting = storedFlag(
  NOTES_ENABLED_KEY,
  NOTES_ENABLED_DEFAULT,
  NOTES_ENABLED_CHANGE_EVENT,
  true,
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
  "bycoda:quick-composer-enabled-change",
  true,
);

export function loadQuickComposerEnabled(): boolean {
  return quickComposerEnabledSetting.load() ?? QUICK_COMPOSER_ENABLED_DEFAULT;
}

export function saveQuickComposerEnabled(value: boolean): boolean {
  try {
    localStorage.setItem(QUICK_COMPOSER_ENABLED_KEY, value ? "1" : "0");
    if (localStorage.getItem(QUICK_COMPOSER_ENABLED_KEY) !== (value ? "1" : "0")) return false;
  } catch {
    return false;
  }
  if (typeof window !== "undefined")
    window.dispatchEvent(new CustomEvent("bycoda:quick-composer-enabled-change"));
  return true;
}

export const subscribeQuickComposerEnabled = quickComposerEnabledSetting.subscribe;

export function loadQuickComposerShortcut(): string {
  try {
    const value = localStorage.getItem(QUICK_COMPOSER_SHORTCUT_KEY);
    return value && isGlobalShortcut(value) ? value : QUICK_COMPOSER_DEFAULT_SHORTCUT;
  } catch {
    return QUICK_COMPOSER_DEFAULT_SHORTCUT;
  }
}

export const QUICK_COMPOSER_SHORTCUT_CHANGE_EVENT = "bycoda:quick-composer-shortcut-change";
export const subscribeQuickComposerShortcut = (onChange: () => void) =>
  subscribePreferenceChanges(
    [QUICK_COMPOSER_SHORTCUT_KEY],
    QUICK_COMPOSER_SHORTCUT_CHANGE_EVENT,
    onChange,
  );

export function saveQuickComposerShortcut(value: string): boolean {
  if (!isGlobalShortcut(value)) return false;
  // Same conflict rules as every other row, so the separately stored Quick
  // Composer chord cannot claim a combination another command already owns.
  const shortcut = validateKeybindingShortcut(QUICK_COMPOSER_COMMAND, value);
  try {
    localStorage.setItem(QUICK_COMPOSER_SHORTCUT_KEY, shortcut);
    if (localStorage.getItem(QUICK_COMPOSER_SHORTCUT_KEY) !== shortcut) return false;
  } catch {
    return false;
  }
  if (typeof window !== "undefined")
    window.dispatchEvent(new CustomEvent(QUICK_COMPOSER_SHORTCUT_CHANGE_EVENT));
  return true;
}

const LIVE_AGENTS_ENABLED_KEY = "bycoda.liveAgentsEnabled";

export const LIVE_AGENTS_ENABLED_DEFAULT = true;

/** Fired on `window` when the working-agents rail card setting flips. */
export const LIVE_AGENTS_ENABLED_CHANGE_EVENT = "bycoda:live-agents-enabled-change";

const liveAgentsEnabledSetting = storedFlag(
  LIVE_AGENTS_ENABLED_KEY,
  LIVE_AGENTS_ENABLED_DEFAULT,
  LIVE_AGENTS_ENABLED_CHANGE_EVENT,
  true,
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
  if (typeof window !== "undefined") window.dispatchEvent(new Event("bycoda:close-to-tray-change"));
}
export const subscribeCloseToTray = (onChange: () => void) =>
  subscribePreferenceChanges([CLOSE_TO_TRAY_KEY], "bycoda:close-to-tray-change", onChange);

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
  return subscribePreferenceChanges(
    [CREW_SCENE_ENABLED_KEY, LEGACY_CREW_SCENE_ENABLED_KEY],
    CREW_SCENE_ENABLED_CHANGE_EVENT,
    onStoreChange,
  );
}

const CREW_GROWTH_ENABLED_KEY = "bycoda.crewGrowthEnabled";

export type CrewTheme = "classic" | "star-wars" | "lotr" | "matrix";
const parseCrewTheme = (value: unknown): CrewTheme =>
  value === "star-wars" || value === "lotr" || value === "matrix" ? value : "classic";
const crewThemeSetting = createStoredSetting<CrewTheme>({
  key: "bycoda.crewTheme",
  fallback: "classic",
  event: "bycoda:crew-theme-change",
  storageEvents: true,
  parse: parseCrewTheme,
  serialize: String,
});
export const loadCrewTheme = crewThemeSetting.load;
export const subscribeCrewTheme = crewThemeSetting.subscribe;
export function saveCrewTheme(value: CrewTheme) {
  crewThemeSetting.save(parseCrewTheme(value));
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
  return subscribePreferenceChanges(
    [CREW_GROWTH_ENABLED_KEY],
    CREW_GROWTH_ENABLED_CHANGE_EVENT,
    onStoreChange,
  );
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
  storageEvents: true,
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
export type DiffLayout = "auto" | "inline" | "split";

export const DIFF_LAYOUT_DEFAULT: DiffLayout = "auto";

/** Fired on `window` when the single-file diff layout flips. */
export const DIFF_LAYOUT_CHANGE_EVENT = "bycoda:diff-layout-change";

function isDiffLayout(value: unknown): value is DiffLayout {
  return value === "auto" || value === "inline" || value === "split";
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
const resumeAtResetSetting = storedFlag(
  RESUME_AT_RESET_KEY,
  RESUME_AT_RESET_DEFAULT,
  "bycoda:resume-at-reset-change",
  true,
);
export const subscribeResumeAtReset = resumeAtResetSetting.subscribe;

function saveChatFlag(key: string, value: boolean, event: string): boolean {
  try {
    const raw = value ? "1" : "0";
    localStorage.setItem(key, raw);
    if (localStorage.getItem(key) !== raw) return false;
  } catch {
    return false;
  }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(event));
  return true;
}

export function loadResumeAtReset(): boolean {
  return resumeAtResetSetting.load() ?? RESUME_AT_RESET_DEFAULT;
}

export function saveResumeAtReset(value: boolean) {
  return saveChatFlag(RESUME_AT_RESET_KEY, value, "bycoda:resume-at-reset-change");
}

const FORMAT_ON_SAVE_KEY = "bycoda.formatOnSave";
const FORMAT_ON_SAVE_CHANGE_EVENT = "bycoda:format-on-save-change";

export const FORMAT_ON_SAVE_DEFAULT = true;

const formatOnSaveSetting = storedFlag(
  FORMAT_ON_SAVE_KEY,
  FORMAT_ON_SAVE_DEFAULT,
  FORMAT_ON_SAVE_CHANGE_EVENT,
  true,
);

export function loadFormatOnSave(): boolean {
  return formatOnSaveSetting.load() ?? FORMAT_ON_SAVE_DEFAULT;
}

export function saveFormatOnSave(value: boolean) {
  formatOnSaveSetting.save(value);
}

export const subscribeFormatOnSave = formatOnSaveSetting.subscribe;

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

const claudeHooksSetting = storedFlag(
  CLAUDE_HOOKS_KEY,
  CLAUDE_HOOKS_DEFAULT,
  "bycoda:claude-hooks-change",
  true,
);
export const subscribeClaudeHooks = claudeHooksSetting.subscribe;

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
 * Mirrors the bindings we handle: native menu accelerators (`src-tauri/src/menu.rs`), `tabCommand`,
 * the window key handler in App and focused surface handlers such as the draft composer toggle.
 */
export const KEYBINDINGS: KeybindingRow[] = [
  { command: "Voice: Push to Talk", keys: "", when: "Voice connected and microphone paused" },
  { command: "Voice: Open Companion", keys: `${MOD}${SHIFT}K`, when: "Voice companion closed" },
  DESKTOP_TALK_ROW,
  { command: DESKTOP_STOP_COMMAND, keys: `${CTRL}${IS_MAC ? "⌥" : "Alt+"}Esc`, when: "Anywhere" },
  { command: "App: Settings", keys: `${MOD},`, when: "Always" },
  { command: "App: Search", keys: `${MOD}K`, when: "Always" },
  { command: "App: Go to File", keys: `${MOD}P`, when: "Always" },
  { command: "App: Command Palette", keys: `${MOD}${SHIFT}P`, when: "Always" },
  { command: "App: Find in Files", keys: `${MOD}${SHIFT}F`, when: "Always" },
  { command: "App: Open Project", keys: `${MOD}O`, when: "Always" },
  { command: "App: New Window", keys: `${MOD}${SHIFT}N`, when: "Always" },
  { command: "App: Open Inbox", keys: `${MOD}${SHIFT}I`, when: "Always" },
  { command: "App: Open Notes", keys: `${MOD}${SHIFT}L`, when: "Always" },
  { command: "App: Open Tasks", keys: `${MOD}${SHIFT}Y`, when: "Always" },
  { command: "App: Open Automations", keys: `${MOD}${SHIFT}U`, when: "Always" },
  { command: "App: Open Crews", keys: `${MOD}${SHIFT}E`, when: "Always" },
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
  { command: "App: Switch Model", keys: `${MOD}${SHIFT}.`, when: "Always" },
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
  { command: "Session: New", keys: `${MOD}N`, when: "Always" },
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
    keys: `${MOD}${ALT}N`,
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
  { command: "Pane: Arrange Columns", keys: "", when: "workspaceFocus" },
  { command: "Pane: Arrange Rows", keys: "", when: "workspaceFocus" },
  { command: "Pane: Arrange Grid", keys: "", when: "workspaceFocus" },
  { command: "Pane: Arrange Main Left", keys: "", when: "workspaceFocus" },
  { command: "Pane: Arrange Main Top", keys: "", when: "workspaceFocus" },
  { command: "Pane: Equalize Sizes", keys: "", when: "workspaceFocus" },
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
  { command: "Editor: Replace", keys: IS_MAC ? `${MOD}${ALT}F` : "Ctrl+H", when: "editorFocus" },
  ...[
    "General",
    "Providers",
    "Connections",
    "Appearance",
    "Workspace",
    "Terminal",
    "Keybindings",
    "Notifications",
    "Inbox",
  ].map((section) => ({ command: `Settings: ${section}`, keys: "", when: "Always" })),
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
  Esc: "Escape",
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
  requireGlobal(command, isGlobalShortcut(canonical));
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

export function prepareKeybindingOverride(
  command: string,
  override: KeybindingOverride,
): KeybindingOverrides {
  const next = loadKeybindingOverrides();
  if (override.disabled) next[command] = { disabled: true };
  else if (override.shortcut) {
    const shortcut = validateKeybindingShortcut(command, override.shortcut);
    next[command] = { shortcut };
  } else delete next[command];
  return next;
}

export function saveKeybindingOverride(
  command: string,
  override: KeybindingOverride,
): KeybindingOverrides {
  const next = prepareKeybindingOverride(command, override);
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
      t(row.command).toLowerCase().includes(needle) ||
      row.keys.toLowerCase().includes(needle) ||
      row.when.toLowerCase().includes(needle) ||
      t(row.when).toLowerCase().includes(needle),
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
  return saveChatFlag(
    AUTO_CONTINUE_INTERRUPTED_KEY,
    value,
    "bycoda:auto-continue-interrupted-change",
  );
}

export const subscribeAutoContinueInterrupted = (onChange: () => void) =>
  subscribePreferenceChanges(
    [AUTO_CONTINUE_INTERRUPTED_KEY],
    "bycoda:auto-continue-interrupted-change",
    onChange,
  );
