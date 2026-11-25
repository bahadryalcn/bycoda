import { useState } from "react";
import { formatNumber, t } from "../../../../../shared/i18n";
import { Badge } from "../../../../../shared/ui/Badge";
import { Button } from "../../../../../shared/ui/Button";
import { EmptyState } from "../../../../../shared/ui/EmptyState";
import { InlineError } from "../../../../../shared/ui/InlineError";
import { SectionLabel } from "../../../../../shared/ui/SectionLabel";
import { StatRow, StatTile } from "../../../../../shared/ui/StatTile";
import { Surface } from "../../../../../shared/ui/Surface";
import { Text } from "../../../../../shared/ui/Text";
import type { xReadInsights } from "../../../../../integrations/social/adapters/x-insights";
import type { xListOwnSpaces } from "../../../../../integrations/social/adapters/x-spaces";
import type { SocialAccount } from "../../../model/social";
import type { SocialClient } from "../../../model/socialClient";
import { useAccountWrite } from "../useAccountWrite";
import { XListActions } from "./XListActions";
import { XPostActions } from "./XPostActions";
import "./x.css";

type Props = { account: SocialAccount; client: SocialClient; disabled: boolean };

/** Paid X API tools: reviewed writes on posts, accounts and lists, then insights and Spaces. */
export function XApiActions({ account, client, disabled }: Props) {
  return (
    <div className="social-x-stack">
      <XPostActions account={account} client={client} disabled={disabled} />
      <XListActions account={account} client={client} disabled={disabled} />
      <XReadouts account={account} client={client} disabled={disabled} />
    </div>
  );
}

function XReadouts({ account, client, disabled }: Props) {
  const [insights, setInsights] = useState<Awaited<ReturnType<typeof xReadInsights>>>();
  const [spaces, setSpaces] = useState<Awaited<ReturnType<typeof xListOwnSpaces>>>();
  const { error, is, write } = useAccountWrite(t("Could not load data."));
  const read = (operation: string, fetch: () => Promise<void>) => void write(operation, fetch);
  const enterprise = account.xApiProduct === "enterprise";
  const spaceStates: Record<string, string> = {
    live: t("Live"),
    scheduled: t("Scheduled"),
    ended: t("Ended"),
  };
  return (
    <div className="social-x-group">
      <SectionLabel variant="inline" size="secondary" as="h4">
        {t("Insights and Spaces")}
      </SectionLabel>
      <div className="social-x-toolbar">
        {enterprise ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled}
            loading={is("analytics")}
            onClick={() =>
              read("analytics", async () => {
                setInsights(await client.request("x.insights", { accountId: account.id }));
              })
            }
          >
            {t("Analytics")}
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="secondary"
          disabled={disabled}
          loading={is("spaces")}
          onClick={() =>
            read("spaces", async () => {
              setSpaces(await client.request("x.spaces", { accountId: account.id }));
            })
          }
        >
          {t("Spaces")}
        </Button>
      </div>
      {enterprise && insights ? (
        <StatRow label={t("Analytics")}>
          <StatTile
            label={t("Posts measured")}
            value={formatNumber(insights.coverage.requestedPosts)}
          />
          <StatTile
            label={t("Impressions")}
            value={formatNumber(
              insights.daily.reduce((sum, day) => sum + (day.metrics.impressions ?? 0), 0),
            )}
          />
        </StatRow>
      ) : null}
      {spaces && !spaces.spaces.length ? (
        <EmptyState size="inline" description={t("No Spaces found for this account.")} />
      ) : null}
      {spaces?.spaces.length ? (
        <ul className="social-x-list">
          {spaces.spaces.map((space) => (
            <Surface key={space.id} as="li" variant="card" padding="sm" className="social-x-item">
              <div className="social-x-item-head">
                <Text as="span" weight="medium" className="social-x-item-title">
                  {space.title ?? t("Untitled Space")}
                </Text>
                {space.state ? (
                  <Badge tone={space.state === "live" ? "success" : "neutral"}>
                    {spaceStates[space.state] ?? space.state}
                  </Badge>
                ) : null}
              </div>
              {space.participantCount !== undefined ? (
                <Text as="p" size="caption" tone="muted">
                  {t("{p0} participants", { p0: formatNumber(space.participantCount) })}
                </Text>
              ) : null}
            </Surface>
          ))}
        </ul>
      ) : null}
      {error ? <InlineError>{error}</InlineError> : null}
    </div>
  );
}
