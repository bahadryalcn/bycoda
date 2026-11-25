import { useState } from "react";
import { useFormat, useT } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { DescriptionItem, DescriptionList } from "../../../../../shared/ui/DescriptionList";
import { EmptyState } from "../../../../../shared/ui/EmptyState";
import { InlineError } from "../../../../../shared/ui/InlineError";
import { Text } from "../../../../../shared/ui/Text";
import type { readFacebookPageInsights } from "../../../../../integrations/social/adapters/facebook-insights";
import type { SocialAccount } from "../../../model/social";
import type { SocialClient } from "../../../model/socialClient";
import { useAccountWrite } from "../useAccountWrite";
import "./facebook.css";

type InsightsPage = Awaited<ReturnType<typeof readFacebookPageInsights>>;
type Dashboard = Awaited<ReturnType<SocialClient["facebookMonetization"]>>;

export function FacebookMonetization({
  client,
  account,
}: {
  client: SocialClient;
  account: SocialAccount;
}) {
  const t = useT();
  const format = useFormat();
  const work = useAccountWrite(t("Could not load this view."));
  const [insights, setInsights] = useState<InsightsPage>();
  const [dashboard, setDashboard] = useState<Dashboard>();
  const browser = account.connection === "browser";
  const programLabels = {
    stars: t("Facebook Stars"),
    in_stream_ads: t("In-stream ads"),
    bonuses: t("Bonuses"),
    content_monetization: t("Content monetization"),
  };
  const statusLabels: Record<string, string> = {
    active: t("Active"),
    eligible: t("Eligible"),
    ineligible: t("Ineligible"),
    invited: t("Invited"),
    unavailable: t("Unavailable"),
  };
  const load = async () => {
    if (browser) {
      const result = await work.write("load", () => client.facebookMonetization(account.id));
      if (result) setDashboard(result);
    } else {
      const result = await work.write("load", () =>
        client.request<InsightsPage>("facebook.earnings.read", { accountId: account.id }),
      );
      if (result) setInsights(result);
    }
  };
  const values = insights?.metrics[0]?.values ?? [];
  const estimate = values[values.length - 1]?.value;
  return (
    <section className="social-fb-stack" aria-label={t("Monetization")}>
      <div className="social-fb-toolbar">
        <Button
          size="sm"
          variant={dashboard || insights ? "secondary" : "primary"}
          loading={work.is("load")}
          onClick={() => void load().catch(() => undefined)}
        >
          {browser ? t("Read monetization status") : t("Read earnings estimates")}
        </Button>
      </div>
      {!dashboard && !insights && !work.is("load") && !work.error ? (
        <Text as="p" size="secondary" tone="muted">
          {browser
            ? t("Read the status of each Facebook monetization program for this account.")
            : t("Read the earnings Facebook estimates for this Page.")}
        </Text>
      ) : null}
      {work.error ? <InlineError>{work.error}</InlineError> : null}
      {dashboard?.programs.length || typeof estimate === "number" || estimate ? (
        <DescriptionList size="sm">
          {dashboard?.programs.map(({ program, status, earnings }) => (
            <DescriptionItem key={program} term={programLabels[program]}>
              {earnings ?? statusLabels[status ?? "unavailable"] ?? t("Unavailable")}
            </DescriptionItem>
          ))}
          {typeof estimate === "number" ? (
            <DescriptionItem term={t("Provider estimate")}>
              {format.formatNumber(estimate)}
            </DescriptionItem>
          ) : null}
          {estimate && typeof estimate === "object"
            ? Object.entries(estimate).map(([name, value]) => (
                <DescriptionItem
                  key={name}
                  term={
                    Object.hasOwnProperty.call(programLabels, name)
                      ? programLabels[name as keyof typeof programLabels]
                      : name
                  }
                >
                  {typeof value === "number" ? format.formatNumber(value) : t("Unavailable")}
                </DescriptionItem>
              ))
            : null}
        </DescriptionList>
      ) : null}
      {(dashboard && !dashboard.programs.length) || (insights && estimate === undefined) ? (
        <EmptyState size="inline" description={t("Facebook returned no monetization data.")} />
      ) : null}
    </section>
  );
}
