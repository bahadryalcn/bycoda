import { useRef } from "react";
import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { applyThemePreference } from "../../../src/features/settings/model/appearance";
import { IntegrationsPage } from "../../../src/features/settings/ui/integrations/IntegrationsSettings";
import { RevealedSetting } from "../../../src/features/settings/ui/settingsControls";
import { InboxSourceRow } from "../../../src/features/inbox/ui/InboxSourceRow";
import { MessagesPanel } from "../../../src/features/messaging";
import type {
  MessageThread,
  MessagingAccount,
  ThreadMessage,
} from "../../../src/features/messaging/model/messagingTypes";
import {
  replyDraftKey,
  writeReplyDraftBody,
} from "../../../src/features/messaging/model/replyDrafts";
import { languageReady } from "../../../src/shared/i18n";
import "../../../src/features/inbox/ui/InboxView.css";
import "../../../src/styles/index.css";

// tests/ is outside the Tailwind sources: fixture-only layout uses inline styles.
// Memory-only fixture: synthetic accounts, threads and messages. No Host, provider,
// mailbox, credential store or Microsoft endpoint is reachable; unknown commands fail.
// ?view=settings&tab=email|slack renders Settings > Integrations (Discord and Teams are
// paused, so their saved accounts appear only in Messages),
// ?view=messages renders the Inbox Messages source. ?theme=light|dark.
const params = new URLSearchParams(location.search);
const view = params.get("view") === "messages" ? "messages" : "settings";
const tab = params.get("tab") ?? "email";
applyThemePreference(params.get("theme") === "light" ? "light" : "dark");

const now = Date.now();
const minutes = (count: number) => now - count * 60_000;

const account = (
  id: string,
  provider: MessagingAccount["provider"],
  label: string,
  identity: string,
  config: Record<string, unknown>,
): MessagingAccount => ({
  id,
  provider,
  label,
  identity,
  config,
  connected: true,
  createdAt: minutes(60 * 24 * 30),
  updatedAt: minutes(60 * 24),
});

const emailConfig = (preset: string, address: string, auth: "password" | "microsoft") => ({
  preset,
  address,
  displayName: "Fixture User",
  username: "",
  imapHost: preset === "gmail" ? "imap.gmail.com" : "outlook.office365.com",
  imapPort: 993,
  imapSecurity: "tls",
  smtpHost: preset === "gmail" ? "smtp.gmail.com" : "smtp.office365.com",
  smtpPort: preset === "gmail" ? 465 : 587,
  smtpSecurity: preset === "gmail" ? "tls" : "starttls",
  auth,
});

const settingsAccounts: MessagingAccount[] = [
  account("email-work", "email", "Work", "work@example.com", {
    ...emailConfig("outlook", "work@example.com", "microsoft"),
  }),
  account(
    "email-me",
    "email",
    "",
    "me@example.org",
    emailConfig("gmail", "me@example.org", "password"),
  ),
  account("slack-acme", "slack", "Acme", "Acme Corp", {}),
];

const messagingAccounts: MessagingAccount[] = [
  ...settingsAccounts,
  account("discord-guild", "discord", "Release bot", "release-bot#4821", {
    channelIds: ["1098765432101234567", "1098765432101234568", "1098765432101234569"],
  }),
  account("teams-work", "teams", "", "fixture.user@contoso.example", { tenant: "common" }),
  account(
    "email-old",
    "email",
    "Archive",
    "old@example.net",
    emailConfig("custom", "old@example.net", "password"),
  ),
];

const thread = (
  id: string,
  accountId: string,
  provider: MessageThread["provider"],
  title: string,
  participants: string[],
  preview: string,
  ago: number,
  extra: Partial<MessageThread> = {},
): MessageThread => ({
  id,
  accountId,
  provider,
  title,
  participants,
  preview,
  updatedAt: minutes(ago),
  unread: false,
  ...extra,
});

const threads: MessageThread[] = [
  thread(
    "roadmap",
    "email-work",
    "email",
    "Q4 roadmap review — action items",
    ["Priya Raman"],
    "Attached the final deck. Can you confirm the timeline before Friday?",
    4,
    { url: "https://mail.example.com/thread/roadmap" },
  ),
  thread(
    "shipped",
    "email-me",
    "email",
    "Your order has shipped",
    ["Example Store"],
    "Good news: order #48213 is on its way and should arrive Tuesday.",
    11,
    { unread: true },
  ),
  thread(
    "design",
    "slack-acme",
    "slack",
    "#design-reviews",
    ["Lena Fischer", "Marco Rossi"],
    "Pushed the new empty states; feedback welcome before standup.",
    26,
  ),
  thread(
    "kenji",
    "slack-acme",
    "slack",
    "Kenji Watanabe",
    ["Kenji Watanabe"],
    "明日の打ち合わせは10時からでお願いします。資料は共有フォルダにあります。",
    48,
  ),
  thread(
    "contract",
    "email-work",
    "email",
    "Re: Re: Fwd: Contract renewal for the enterprise analytics platform including the updated data processing addendum and revised pricing tiers for 2027",
    ["Legal Operations", "Daniel Okafor", "Sofia Martínez", "Procurement Team"],
    "Please review the redlines in section 4.2 and section 7 before we send the countersigned copy back to the vendor.",
    95,
  ),
  thread(
    "release",
    "discord-guild",
    "discord",
    "#release-notes",
    ["buildbot"],
    "v2.14.0 is live: faster sync, fixed reconnect loop, new keyboard shortcuts.",
    180,
  ),
  thread(
    "oncall",
    "teams-work",
    "teams",
    "Platform on-call",
    ["Ahmet Yılmaz", "Zeynep Kaya"],
    "Gece nöbetinde iki uyarı geldi, ikisi de çözüldü. Ayrıntılar paylaşılan notta.",
    320,
  ),
  thread(
    "olga",
    "teams-work",
    "teams",
    "Ольга Петрова",
    ["Ольга Петрова"],
    "Привет! Можешь посмотреть последний черновик до обеда?",
    60 * 26,
  ),
  thread(
    "general",
    "discord-guild",
    "discord",
    "#عام",
    ["Layla Haddad"],
    "مرحبا بالجميع، الاجتماع القادم يوم الخميس الساعة الثالثة.",
    60 * 50,
  ),
];

const roadmapMessages: ThreadMessage[] = [
  {
    id: "m1",
    threadId: "roadmap",
    author: "Priya Raman",
    authorAddress: "priya.raman@example.com",
    body: "Hi! Sharing the draft agenda for Thursday's roadmap review.\n\n1. Q3 retro\n2. Q4 priorities\n3. Staffing",
    at: minutes(60 * 22),
    outbound: false,
    attachments: [],
  },
  {
    id: "m2",
    threadId: "roadmap",
    author: "Fixture User",
    authorAddress: "work@example.com",
    body: "Looks good. Could we add 15 minutes for the migration risks?",
    at: minutes(60 * 21),
    outbound: true,
    attachments: [],
  },
  {
    id: "m3",
    threadId: "roadmap",
    author: "Priya Raman",
    authorAddress: "priya.raman@example.com",
    body: "Added. The board is here: https://example.com/roadmap/q4?view=board&team=platform — comments are open.",
    at: minutes(60 * 3),
    outbound: false,
    attachments: [],
  },
  {
    id: "m4",
    threadId: "roadmap",
    author: "Fixture User",
    authorAddress: "work@example.com",
    body: "Thanks. My notes from the planning session are attached.",
    at: minutes(40),
    outbound: true,
    attachments: [{ name: "planning-notes.md", size: 8_412 }],
  },
  {
    id: "m5",
    threadId: "roadmap",
    author: "Priya Raman",
    authorAddress: "priya.raman@example.com",
    body: "Attached the final deck. Can you confirm the timeline before Friday?",
    at: minutes(4),
    outbound: false,
    attachments: [{ name: "Q4-roadmap-review-final-v3-with-appendix.pdf", size: 2_516_582 }],
  },
];

function threadMessages(accountId: string, threadId: string): ThreadMessage[] {
  if (threadId === "roadmap") return roadmapMessages;
  const source = threads.find((item) => item.accountId === accountId && item.id === threadId);
  return [
    {
      id: `${threadId}-1`,
      threadId,
      author: source?.participants[0] ?? "Someone",
      body: source?.preview ?? "",
      at: source?.updatedAt ?? now,
      outbound: false,
      attachments: [],
    },
  ];
}

mockWindows("main");
mockIPC(
  (command, payload) => {
    const args = (payload ?? {}) as Record<string, unknown>;
    if (command.startsWith("plugin:event|")) return null;
    switch (command) {
      case "messaging_list_accounts":
        return view === "messages" ? messagingAccounts : settingsAccounts;
      case "messaging_list_threads":
        if (args.accountId === "email-old")
          throw new Error("IMAP login failed: the server rejected the saved app password.");
        return threads.filter((item) => item.accountId === args.accountId);
      case "messaging_thread_messages":
        return threadMessages(String(args.accountId), String(args.threadId));
      case "messaging_microsoft_device_start":
        return {
          handle: "fixture-device-handle",
          userCode: "K7QF2MXP",
          verificationUri: "https://microsoft.example/devicelogin",
          expiresIn: 900,
          interval: 5,
          message: "Fixture sign-in message",
        };
      case "messaging_microsoft_device_poll":
        return { status: "pending" };
      case "messaging_save_account":
      case "messaging_reply":
      case "messaging_remove_account":
        throw new Error("Unavailable in the messaging fixture.");
      case "git_github_status":
      case "gitlab_status":
      case "azure_devops_status":
      case "jira_status":
      case "linear_status":
        return {
          connected: false,
          installed: false,
          url: "",
          organization: "",
          site: "",
          email: "",
        };
      case "jira_list_projects":
      case "jira_list_boards":
      case "linear_list_teams":
        return [];
      default:
        throw new Error(`Unavailable in messaging fixture: ${command}`);
    }
  },
  { shouldMockEvents: true },
);

writeReplyDraftBody(
  replyDraftKey("email-work", "roadmap"),
  "Thanks Priya, the timeline works for us. I'll confirm the staffing numbers by Thursday.",
);

function SettingsFixture() {
  return (
    <div
      className="bycoda-settings bycoda-settings-workbench flex min-w-0 flex-col text-content"
      style={{ minHeight: "100vh" }}
    >
      <div className="bycoda-settings-body">
        {/* Placeholder for the real category navigation, so the content column has its real width. */}
        <nav className="bycoda-settings-categories" aria-label="Fixture settings categories" />
        <div className="bycoda-settings-panel">
          <div data-settings-scroller className="@container/settings min-h-0 flex-1">
            <header className="settings-page-bar">
              <div className="settings-page-bar-inner">
                <h1 className="settings-page-title">Integrations</h1>
              </div>
            </header>
            <div
              data-settings-section="integrations"
              className="bycoda-settings-content bycoda-settings-form min-w-0 w-full"
            >
              <RevealedSetting.Provider value={tab}>
                <IntegrationsPage />
              </RevealedSetting.Provider>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MessagesFixture() {
  const connectRef = useRef<HTMLButtonElement>(null);
  return (
    <div
      className="flex min-h-0"
      style={{ height: "100vh", background: "var(--ui-workspace-canvas)" }}
    >
      {/* Placeholder for the workspace sidebar, so the Inbox has its real width. */}
      <aside
        aria-label="Fixture workspace sidebar"
        className="shrink-0 border-r border-(--ui-pane-border)"
        style={{ width: 260, background: "var(--ui-workspace-panel)" }}
      />
      <div
        role="region"
        aria-label="Inbox"
        className="bycoda-inbox flex min-h-0 min-w-0 flex-1 flex-col text-(--ui-tone-neutral-fg)"
      >
        <MessagesPanel
          accounts={messagingAccounts}
          sourceRow={
            <InboxSourceRow
              sources={["github"]}
              source="github"
              messages
              messagesSelected
              onSelect={() => undefined}
              onSelectMessages={() => undefined}
              connectable
              connectOpen={false}
              connectButtonRef={connectRef}
              onToggleConnect={() => undefined}
            />
          }
        />
      </div>
    </div>
  );
}

void languageReady.then(() =>
  createRoot(document.getElementById("root")!).render(
    view === "messages" ? <MessagesFixture /> : <SettingsFixture />,
  ),
);
