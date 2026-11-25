import { useState } from "react";
import { formatNumber, t } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { DescriptionItem, DescriptionList } from "../../../../../shared/ui/DescriptionList";
import { Disclosure } from "../../../../../shared/ui/Disclosure";
import { FieldGroup } from "../../../../../shared/ui/FieldGroup";
import { InlineError, InlineMessage } from "../../../../../shared/ui/InlineError";
import { LoadingText } from "../../../../../shared/ui/LoadingText";
import { Select } from "../../../../../shared/ui/Select";
import { Text } from "../../../../../shared/ui/Text";
import { TextField } from "../../../../../shared/ui/TextField";
import type {
  InstagramInsightInput,
  InstagramInsightResult,
} from "../../../../../integrations/social/adapters/instagram-insights";
import type { SocialClient } from "../../../model/socialClient";
import { useAccountWrite } from "../useAccountWrite";
import "./instagram.css";

export function InstagramInsightsPanel({
  client,
  accountId,
  disabled,
}: {
  client: SocialClient;
  accountId: string;
  disabled: boolean;
}) {
  const { write, is, error } = useAccountWrite(t("Instagram could not complete this action."));
  const [mediaId, setMediaId] = useState("");
  const [demographics, setDemographics] = useState<InstagramInsightInput["demographics"]>();
  const [insights, setInsights] = useState<InstagramInsightResult>();
  const read = () => {
    void write("insights", async () => {
      const id = mediaId.trim();
      setInsights(
        await client.request<InstagramInsightResult>("instagram.insights", {
          accountId,
          ...(id ? { mediaId: id } : demographics ? { demographics } : {}),
        }),
      );
    }).catch(() => undefined);
  };
  return (
    <FieldGroup legend={t("Instagram insights")} hideLegend disabled={disabled || is("insights")}>
      <div className="instagram-head">
        <Select
          label={t("Audience breakdown")}
          value={demographics ?? ""}
          disabled={!!mediaId.trim()}
          options={[
            { value: "", label: t("Overview") },
            { value: "age", label: t("Age") },
            { value: "gender", label: t("Gender") },
            { value: "country", label: t("Country") },
            { value: "city", label: t("City") },
          ]}
          onValueChange={(value) => {
            setDemographics((value || undefined) as InstagramInsightInput["demographics"]);
            setInsights(undefined);
          }}
        />
        <Button size="sm" variant="secondary" loading={is("insights")} onClick={read}>
          {insights ? t("Refresh") : t("Read Instagram insights")}
        </Button>
      </div>
      <Disclosure variant="plain" summary={t("Insights for one post")}>
        <TextField
          label={t("Instagram media ID (optional)")}
          value={mediaId}
          onChange={(event) => {
            setMediaId(event.target.value);
            setInsights(undefined);
          }}
        />
      </Disclosure>
      {is("insights") && !insights ? <LoadingText /> : null}
      {insights ? (
        <DescriptionList size="sm">
          {Object.entries(insights.metrics).map(([key, metric]) => (
            <DescriptionItem key={key} term={key.replace(/_/g, " ")}>
              {metric.value !== undefined ? formatNumber(metric.value) : null}
              {metric.points?.map((point, index) => (
                <Text key={index} as="p" size="caption" tone="secondary">
                  {point.endTime} {formatNumber(point.value)}
                </Text>
              ))}
              {metric.breakdown?.map((entry) => (
                <Text key={entry.dimensions.join("|")} as="p" size="caption" tone="secondary">
                  {entry.dimensions.join(" · ")} {formatNumber(entry.value)}
                </Text>
              ))}
            </DescriptionItem>
          ))}
        </DescriptionList>
      ) : null}
      {insights?.unavailable.length ? (
        <InlineMessage tone="info">
          {t("Unavailable metrics: {p0}", { p0: insights.unavailable.join(", ") })}
        </InlineMessage>
      ) : null}
      {error ? <InlineError>{error}</InlineError> : null}
    </FieldGroup>
  );
}
