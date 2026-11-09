import { useContext, useState, type ReactNode } from "react";
import { t, useLocale } from "../../../../shared/i18n";
import { Badge } from "../../../../shared/ui/Badge";
import { Tab, TabList, TabPanel, Tabs } from "../../../../shared/ui/Tabs";
import { isPausedMessagingProvider, MessagingProviderMark } from "../../../messaging";
import { INBOX_PROVIDERS, inboxProviderMark } from "../InboxSettings";
import { JiraSettings } from "../JiraSettings";
import { Group, RevealedSetting } from "../settingsControls";
import { DiscordSettings } from "./DiscordSettings";
import { EmailAccountsSettings } from "./EmailAccountsSettings";
import { SlackSettings } from "./SlackSettings";
import { TeamsSettings } from "./TeamsSettings";
import "./IntegrationsSettings.css";

type Integration = {
  /** Tab value and the `SETTINGS_INDEX` reveal id of the card. */
  id: string;
  name: string;
  capability: "inbox" | "messages";
  description: string;
  icon: ReactNode;
  render: (active: boolean) => ReactNode;
};

/**
 * Work-item sources first, then the accounts Messages reads and replies through. Paused messaging
 * providers keep their cards here but are not offered.
 */
const ALL_INTEGRATIONS: readonly Integration[] = [
  ...INBOX_PROVIDERS.map(({ id, name, description, Component }) => ({
    id,
    name,
    capability: "inbox" as const,
    description,
    icon: inboxProviderMark(id),
    render: (active: boolean) => (id === "jira" ? <JiraSettings active={active} /> : <Component />),
  })),
  {
    id: "email",
    name: "Email",
    capability: "messages",
    description: "Read and reply to mail from Gmail, Yahoo, iCloud or any IMAP/SMTP account.",
    icon: <MessagingProviderMark provider="email" className="icon-md shrink-0" />,
    render: () => <EmailAccountsSettings />,
  },
  {
    id: "slack",
    name: "Slack",
    capability: "messages",
    description: "Read your Slack channels and direct messages, and reply from bycoda.",
    icon: <MessagingProviderMark provider="slack" className="icon-md shrink-0" />,
    render: () => <SlackSettings />,
  },
  {
    id: "discord",
    name: "Discord",
    capability: "messages",
    description: "Read the Discord channels you list and reply as your bot.",
    icon: <MessagingProviderMark provider="discord" className="icon-md shrink-0" />,
    render: () => <DiscordSettings />,
  },
  {
    id: "teams",
    name: "Microsoft Teams",
    capability: "messages",
    description: "Read your Teams chats and reply with your Microsoft account.",
    icon: <MessagingProviderMark provider="teams" className="icon-md shrink-0" />,
    render: () => <TeamsSettings />,
  },
];

export const INTEGRATIONS = ALL_INTEGRATIONS.filter((item) => !isPausedMessagingProvider(item.id));

const integrationFor = (id: string | null) => INTEGRATIONS.find((item) => item.id === id)?.id;

export function IntegrationsPage() {
  useLocale();
  const revealed = useContext(RevealedSetting);
  // Cards stay mounted once opened, so their drafts survive tab changes.
  const [selection, setSelection] = useState(() => {
    const initial = integrationFor(revealed) ?? INTEGRATIONS[0]!.id;
    return { active: initial, revealed, visited: new Set([initial]) };
  });
  let active = selection.active;
  let visited = selection.visited;
  // Resolve an external Settings search before its scroll/focus effect runs.
  // Manual tab changes remain independent until the search target changes.
  if (selection.revealed !== revealed) {
    active = integrationFor(revealed) ?? active;
    visited = visited.has(active) ? visited : new Set([...visited, active]);
    setSelection({ active, revealed, visited });
  }
  const setActive = (next: string) =>
    setSelection((current) => ({
      ...current,
      active: next,
      visited: current.visited.has(next) ? current.visited : new Set([...current.visited, next]),
    }));

  return (
    <div className="inbox-settings integrations-settings">
      <Tabs value={active} onValueChange={setActive} size="md">
        <TabList label={t("Integrations")} className="inbox-provider-tabs">
          {INTEGRATIONS.map((item) => (
            <Tab key={item.id} value={item.id} stableWidth icon={item.icon}>
              {t(item.name)}
            </Tab>
          ))}
        </TabList>
        {INTEGRATIONS.map((item) => (
          <TabPanel key={item.id} value={item.id} keepMounted>
            <div className="settings-topics grid min-w-0 gap-6">
              <Group
                layout="full"
                scope={
                  item.capability === "inbox"
                    ? t("This computer · Inbox account")
                    : t("This computer · Messaging accounts")
                }
                id={item.id}
                title={t("Connection")}
                info={t(item.description)}
                action={
                  <Badge size="sm" appearance="subtle">
                    {item.capability === "inbox" ? t("Inbox") : t("Messages")}
                  </Badge>
                }
              >
                {active === item.id || visited.has(item.id)
                  ? item.render(active === item.id)
                  : null}
              </Group>
            </div>
          </TabPanel>
        ))}
      </Tabs>
    </div>
  );
}
