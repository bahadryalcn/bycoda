import { useState } from "react";
import { formatNumber, t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { DescriptionItem, DescriptionList } from "../../../../shared/ui/DescriptionList";
import { Disclosure } from "../../../../shared/ui/Disclosure";
import { EmptyState } from "../../../../shared/ui/EmptyState";
import { FieldGroup } from "../../../../shared/ui/FieldGroup";
import { InlineError } from "../../../../shared/ui/InlineError";
import { Select } from "../../../../shared/ui/Select";
import { Text } from "../../../../shared/ui/Text";
import type { LinkedInAnalyticsResult } from "../../../../integrations/social/adapters/linkedin-analytics";
import type { SocialAccount } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import { useAccountWrite } from "../accounts/useAccountWrite";
import "./linkedin.css";

export function LinkedInAnalytics({
  account,
  client,
  disabled,
}: {
  account: SocialAccount;
  client: SocialClient;
  disabled: boolean;
}) {
  const [selection, setSelection] = useState("posts");
  const [result, setResult] = useState<{ kind: string; data: LinkedInAnalyticsResult }>();
  const { error, is, write } = useAccountWrite(t("Could not load analytics."));
  const browser = account.connection === "browser";
  if (browser && account.accountType !== "member") return null;
  const kind = browser ? "profile" : selection;
  const data = result?.kind === kind ? result.data : undefined;
  const load = () =>
    write("analytics", async () => {
      const data = browser
        ? await client.linkedInProfileAnalytics(account.id)
        : await client.request<LinkedInAnalyticsResult>("linkedin.analytics", {
            accountId: account.id,
            kind,
          });
      setResult({ kind, data });
    });
  const names: Record<string, string> = {
    impressions: t("Impressions"),
    membersReached: t("Members reached"),
    reshares: t("Reshares"),
    reactions: t("Reactions"),
    comments: t("Comments"),
    postSaves: t("Post saves"),
    postSends: t("Post sends"),
    linkClicks: t("Link clicks"),
    premiumCtaClicks: t("Premium button clicks"),
    followersFromContent: t("Followers from content"),
    profileViewsFromContent: t("Profile views from content"),
    clicks: t("Clicks"),
    likes: t("Likes"),
    engagementRate: t("Engagement rate"),
    pageViews: t("Page views"),
    uniquePageViews: t("Unique Page views"),
    followers: t("Followers"),
    profileViews: t("Profile views"),
    searchAppearances: t("Search appearances"),
    profileAppearances: t("Profile appearances"),
  };
  return (
    <Disclosure summary={t("Analytics")} variant="row">
      <div className="social-li-stack">
        <div className="social-li-toolbar">
          {browser ? null : (
            <FieldGroup variant="bare" disabled={disabled || is("analytics")}>
              <Select
                label={t("Analytics")}
                value={selection}
                options={[
                  { value: "posts", label: t("Post") },
                  ...(account.accountType === "organization"
                    ? [{ value: "page", label: t("Page") }]
                    : []),
                  { value: "followers", label: t("Followers") },
                ]}
                onValueChange={(value) => {
                  setSelection(value);
                  setResult(undefined);
                }}
              />
            </FieldGroup>
          )}
          <Button
            variant={data ? "secondary" : "primary"}
            size="sm"
            disabled={disabled}
            loading={is("analytics")}
            onClick={() => void load().catch(() => undefined)}
          >
            {t("Refresh")}
          </Button>
        </div>
        {error ? <InlineError>{error}</InlineError> : null}
        {!data && !is("analytics") && !error ? (
          <Text as="p" size="secondary" tone="muted">
            {t("Refresh to read the latest numbers from LinkedIn.")}
          </Text>
        ) : null}
        {data && !Object.keys(data.metrics).length ? (
          <EmptyState
            size="inline"
            description={t("LinkedIn returned no numbers for this view.")}
          />
        ) : null}
        {data && Object.keys(data.metrics).length ? (
          <DescriptionList size="sm" columns="auto">
            {Object.entries(data.metrics).map(([key, value]) => (
              <DescriptionItem key={key} term={names[key] ?? key}>
                {key === "engagementRate"
                  ? formatNumber(value, { style: "percent", maximumFractionDigits: 2 })
                  : formatNumber(value)}
              </DescriptionItem>
            ))}
          </DescriptionList>
        ) : null}
      </div>
    </Disclosure>
  );
}
