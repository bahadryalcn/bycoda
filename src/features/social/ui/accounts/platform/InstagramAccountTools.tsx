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
import { InstagramDirectComposer } from "./InstagramDirectComposer";
import { InstagramEarningsPanel } from "./InstagramEarningsPanel";
import { InstagramFollowersPanel } from "./InstagramFollowersPanel";
import { InstagramHighlightsPanel } from "./InstagramHighlightsPanel";
import { InstagramInsightsPanel } from "./InstagramInsightsPanel";
import { InstagramLiveProducer } from "./InstagramLiveProducer";
import { InstagramManagementRequests } from "./InstagramManagementRequests";
import { InstagramPostsPanel } from "./InstagramPostsPanel";
import { InstagramProfileEditor } from "./InstagramProfileEditor";
import "./instagram.css";

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
  const { write, is, error } = useAccountWrite(t("Instagram could not complete this action."));
  const [notice, setNotice] = useState("");
  const [chosen, setChosen] = useState<Section>();
  const browser = account.connection === "browser" && account.connected;
  const available = (operation: Capability["operation"]) =>
    capabilities.some((row) => row.operation === operation && row.status === "available");
  const analytics = available("analytics");
  const signedMentions = available("webhook");
  const messageStart = available("message.start");
  const sections: { value: Section; label: string }[] = [
    ...(analytics ? [{ value: "insights" as const, label: t("Insights") }] : []),
    ...(browser || signedMentions ? [{ value: "mentions" as const, label: t("Mentions") }] : []),
    ...(browser && messageStart ? [{ value: "messages" as const, label: t("Messages") }] : []),
    ...(browser
      ? [
          { value: "posts" as const, label: t("Posts") },
          { value: "followers" as const, label: t("Followers") },
          { value: "highlights" as const, label: t("Highlights") },
          { value: "profile" as const, label: t("Profile") },
          { value: "earnings" as const, label: t("Earnings") },
          { value: "live" as const, label: t("Live") },
          { value: "requests" as const, label: t("Requests") },
        ]
      : []),
    ...(account.connection === "browser"
      ? [{ value: "browser" as const, label: t("Browser") }]
      : []),
  ];
  const section = sections.some(({ value }) => value === chosen) ? chosen : sections[0]?.value;
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
    { intent: "instagram-professional", label: t("Switch to professional account") },
    { intent: "instagram-profile", label: t("Open Instagram profile settings") },
    { intent: "instagram-highlights", label: t("Manage Instagram Highlights") },
    { intent: "instagram-monetization", label: t("Open Instagram monetization") },
    ...(browser
      ? []
      : [{ intent: "instagram-live" as const, label: t("Open Instagram Live Producer") }]),
  ];
  const panel = (value: Section, children: React.ReactNode) => (
    <div hidden={section !== value}>{children}</div>
  );
  return (
    <Disclosure summary={t("Instagram tools")}>
      <div className="instagram-tools">
        {sections.length ? (
          <SubTabs
            label={t("Instagram tools")}
            value={section ?? sections[0]!.value}
            items={sections}
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
        {error ? <InlineError>{error}</InlineError> : null}
      </div>
    </Disclosure>
  );
}
