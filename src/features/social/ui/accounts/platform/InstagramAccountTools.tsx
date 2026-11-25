import { useState } from "react";
import { t } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { Disclosure } from "../../../../../shared/ui/Disclosure";
import { FieldGroup } from "../../../../../shared/ui/FieldGroup";
import { InlineError, InlineMessage } from "../../../../../shared/ui/InlineError";
import { SubTabs } from "../../../../../shared/ui/SubTabs";
import { Text } from "../../../../../shared/ui/Text";
import type { Capability, SocialAccount } from "../../../model/social";
import type { HostProject } from "../../../../connections/public/protocol";
import type { SocialBrowserIntent } from "../../../model/socialBrowser";
import type { SocialClient } from "../../../model/socialClient";
import { useAccountWrite } from "../useAccountWrite";
import { InstagramAccountMentions } from "./InstagramAccountMentions";
import { InstagramDirectComposer, prefillInstagramDirect } from "./InstagramDirectComposer";
import { InstagramEarningsPanel } from "./InstagramEarningsPanel";
import { InstagramFollowersPanel } from "./InstagramFollowersPanel";
import { InstagramHighlightsPanel } from "./InstagramHighlightsPanel";
import { InstagramInsightsPanel } from "./InstagramInsightsPanel";
import { InstagramLiveProducer } from "./InstagramLiveProducer";
import { InstagramManagementRequests } from "./InstagramManagementRequests";
import { InstagramPostsPanel } from "./InstagramPostsPanel";
import { InstagramProfileEditor } from "./InstagramProfileEditor";
import "./instagram.css";

type Group = "overview" | "content" | "messages" | "account" | "live" | "requests";
type Section =
  | "insights"
  | "mentions"
  | "messages"
  | "posts"
  | "followers"
  | "highlights"
  | "profile"
  | "earnings"
  | "requests"
  | "live"
  | "browser";

export function InstagramAccountTools({
  client,
  account,
  capabilities,
  projects,
  disabled,
}: {
  client: SocialClient;
  account: SocialAccount;
  capabilities: Capability[];
  projects: readonly HostProject[];
  disabled: boolean;
}) {
  const { write, is, error, details } = useAccountWrite(
    t("Instagram could not complete this action."),
  );
  const [notice, setNotice] = useState("");
  const [chosen, setChosen] = useState<Section>();
  const browser = account.connection === "browser" && account.connected;
  const available = (operation: Capability["operation"]) =>
    capabilities.some((row) => row.operation === operation && row.status === "available");
  const analytics = available("analytics");
  const signedMentions = available("webhook");
  const messageStart = available("message.start");
  const sections: { value: Section; label: string; group: Group }[] = [
    ...(analytics
      ? [
          {
            value: "insights" as const,
            label: t("Insights"),
            group: "overview" as const,
          },
        ]
      : []),
    ...(browser || signedMentions
      ? [
          {
            value: "mentions" as const,
            label: t("Mentions"),
            group: "overview" as const,
          },
        ]
      : []),
    ...(browser
      ? [
          {
            value: "followers" as const,
            label: t("Followers"),
            group: "overview" as const,
          },
        ]
      : []),
    ...(browser
      ? [
          {
            value: "posts" as const,
            label: t("Posts"),
            group: "content" as const,
          },
          {
            value: "highlights" as const,
            label: t("Highlights"),
            group: "content" as const,
          },
        ]
      : []),
    ...(browser && messageStart
      ? [
          {
            value: "messages" as const,
            label: t("Messages"),
            group: "messages" as const,
          },
        ]
      : []),
    ...(browser
      ? [
          {
            value: "profile" as const,
            label: t("Profile"),
            group: "account" as const,
          },
          {
            value: "earnings" as const,
            label: t("Earnings"),
            group: "account" as const,
          },
        ]
      : []),
    ...(account.connection === "browser"
      ? [
          {
            value: "browser" as const,
            label: t("Browser"),
            group: "account" as const,
          },
        ]
      : []),
    ...(browser
      ? [
          { value: "live" as const, label: t("Live"), group: "live" as const },
          {
            value: "requests" as const,
            label: t("Requests"),
            group: "requests" as const,
          },
        ]
      : []),
  ];
  const section = sections.some(({ value }) => value === chosen) ? chosen : sections[0]?.value;
  const groupLabels: Record<Group, string> = {
    overview: t("Overview"),
    content: t("Content"),
    messages: t("Messages"),
    account: t("Account"),
    live: t("Live"),
    requests: t("Requests"),
  };
  // One strip of groups, then a second strip only inside a group with several sections, so the
  // tab row stays on one line in a narrow drawer.
  const groups = [...new Set(sections.map(({ group }) => group))].map((value) => ({
    value,
    label: groupLabels[value],
  }));
  const group = sections.find(({ value }) => value === section)?.group;
  const inGroup = sections.filter((row) => row.group === group);
  const openWorkflow = (intent: SocialBrowserIntent) => {
    setNotice("");
    void write(intent, async () => {
      const workflow = await client.browserWorkflowBegin(account.id, intent);
      if (workflow.status !== "awaiting_owner")
        throw new Error(workflow.error ?? t("Instagram could not complete this action."));
      setNotice(t("Continue in the Instagram browser window."));
    }).catch(() => undefined);
  };
  const workflows: { intent: SocialBrowserIntent; label: string }[] = [
    {
      intent: "instagram-professional",
      label: t("Switch to professional account"),
    },
    {
      intent: "instagram-profile",
      label: t("Open Instagram profile settings"),
    },
    { intent: "instagram-highlights", label: t("Manage Instagram Highlights") },
    {
      intent: "instagram-monetization",
      label: t("Open Instagram monetization"),
    },
    ...(browser
      ? []
      : [
          {
            intent: "instagram-live" as const,
            label: t("Open Instagram Live Producer"),
          },
        ]),
  ];
  const panel = (value: Section, children: React.ReactNode) => (
    <div hidden={section !== value}>{children}</div>
  );
  return (
    <Disclosure summary={t("Instagram tools")}>
      <div className="instagram-tools">
        {groups.length && group ? (
          <SubTabs
            wrap
            label={t("Instagram tools")}
            value={group}
            items={groups}
            onValueChange={(next) => setChosen(sections.find((row) => row.group === next)?.value)}
          />
        ) : null}
        {inGroup.length > 1 ? (
          <SubTabs
            wrap
            label={t("Instagram section")}
            value={section ?? inGroup[0]!.value}
            items={inGroup}
            onValueChange={setChosen}
          />
        ) : null}
        {analytics
          ? panel(
              "insights",
              <InstagramInsightsPanel client={client} accountId={account.id} disabled={disabled} />,
            )
          : null}
        {browser || signedMentions
          ? panel(
              "mentions",
              <InstagramAccountMentions
                client={client}
                accountId={account.id}
                browser={browser}
                disabled={disabled}
              />,
            )
          : null}
        {browser && messageStart
          ? panel(
              "messages",
              <InstagramDirectComposer
                client={client}
                account={account}
                projects={projects}
                disabled={disabled}
              />,
            )
          : null}
        {browser ? (
          <>
            {panel(
              "posts",
              <InstagramPostsPanel client={client} accountId={account.id} disabled={disabled} />,
            )}
            {panel(
              "followers",
              <InstagramFollowersPanel
                client={client}
                accountId={account.id}
                disabled={disabled}
              />,
            )}
            {panel(
              "highlights",
              <InstagramHighlightsPanel
                key={`highlights:${account.id}`}
                client={client}
                accountId={account.id}
                disabled={disabled}
              />,
            )}
            {panel(
              "profile",
              <InstagramProfileEditor client={client} accountId={account.id} disabled={disabled} />,
            )}
            {panel(
              "earnings",
              <InstagramEarningsPanel
                key={`earnings:${account.id}`}
                client={client}
                accountId={account.id}
                disabled={disabled}
              />,
            )}
            {panel(
              "requests",
              <InstagramManagementRequests
                key={`requests:${account.id}`}
                client={client}
                accountId={account.id}
                disabled={disabled}
                onReviewMessage={(input) => {
                  const loaded = messageStart && prefillInstagramDirect(client, account, input);
                  if (loaded) setChosen("messages");
                  return loaded;
                }}
              />,
            )}
            {panel(
              "live",
              <InstagramLiveProducer
                key={account.id}
                client={client}
                accountId={account.id}
                disabled={disabled}
              />,
            )}
          </>
        ) : null}
        {account.connection === "browser"
          ? panel(
              "browser",
              <FieldGroup
                legend={t("Instagram in browser")}
                hideLegend
                layout="row"
                gap="sm"
                disabled={disabled}
              >
                <Text size="caption" tone="secondary">
                  {t("These open Instagram in your browser window to finish a step there.")}
                </Text>
                <div className="instagram-actions">
                  {workflows.map(({ intent, label }) => (
                    <Button
                      key={intent}
                      size="sm"
                      variant="secondary"
                      loading={is(intent)}
                      onClick={() => openWorkflow(intent)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </FieldGroup>,
            )
          : null}
        {notice ? <InlineMessage>{notice}</InlineMessage> : null}
        {error ? <InlineError details={details}>{error}</InlineError> : null}
      </div>
    </Disclosure>
  );
}
