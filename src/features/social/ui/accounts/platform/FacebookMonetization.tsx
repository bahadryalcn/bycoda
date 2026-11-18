import { useState } from "react";
import { useFormat, useT } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { EmptyState } from "../../../../../shared/ui/EmptyState";
import { InlineError } from "../../../../../shared/ui/InlineError";
import { Text } from "../../../../../shared/ui/Text";
import type { readFacebookPageInsights } from "../../../../../integrations/social/adapters/facebook-insights";
import type { SocialAccount } from "../../../model/social";
import type { SocialClient } from "../../../model/socialClient";
import { useAccountWrite } from "../useAccountWrite";

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
    <section className="social-card" aria-label={t("Monetization")}>
      <Button
        size="sm"
        variant="secondary"
        className="self-start"
        loading={work.is("load")}
        onClick={() => void load().catch(() => undefined)}
      >
        {browser ? t("Read monetization status") : t("Read earnings estimates")}
      </Button>
      {work.error ? <InlineError>{work.error}</InlineError> : null}
      {dashboard?.programs.map(({ program, status, earnings }) => (
        <Text as="p" key={program}>
          {programLabels[program]} ·{" "}
          {earnings ?? statusLabels[status ?? "unavailable"] ?? t("Unavailable")}
        </Text>
      ))}
      {typeof estimate === "number" ? (
        <Text as="p">
          {t("Provider estimate")} · {format.formatNumber(estimate)}
        </Text>
      ) : null}
      {estimate && typeof estimate === "object"
        ? Object.entries(estimate).map(([name, value]) => (
            <Text as="p" key={name}>
              {Object.hasOwnProperty.call(programLabels, name)
                ? programLabels[name as keyof typeof programLabels]
                : name}{" "}
              · {typeof value === "number" ? format.formatNumber(value) : t("Unavailable")}
            </Text>
          ))
        : null}
      {(dashboard && !dashboard.programs.length) || (insights && estimate === undefined) ? (
        <EmptyState size="inline" description={t("No results")} />
      ) : null}
    </section>
  );
}
