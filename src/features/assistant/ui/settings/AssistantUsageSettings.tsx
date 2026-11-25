import type { AssistantSnapshot } from "../../../../shared/model/host-contracts/assistant";
import { formatNumber, t } from "../../../../shared/i18n";
import { InfoPopover } from "../../../../shared/ui/InfoPopover";
import { LiveText } from "../../../../shared/ui/LiveText";
import { Text } from "../../../../shared/ui/Text";
import { Select } from "../../../../shared/ui/Select";
import { Row } from "../../../../shared/ui/settings";
import styles from "./costUsage.module.css";
import viewStyles from "../AssistantView.module.css";

/** Conversation retention draft and, when given, today's usage on the same row. Saved by the page footer. */
export function AssistantRetentionField({
  value,
  disabled,
  onChange,
  usage,
  dailyBudget,
}: {
  value: number;
  disabled: boolean;
  onChange: (days: number) => void;
  usage?: AssistantSnapshot["usage"];
  dailyBudget?: number;
}) {
  return (
    <>
      <Row
        label={t("Keep conversation messages")}
        info={
          <InfoPopover label={t("About conversation retention")}>
            <Text as="p" size="secondary">
              {t("Older messages move to Recently deleted for seven days.")}
            </Text>
            <Text
              as="p"
              size="micro"
              tone="secondary"
              leading="inherit"
              className={viewStyles.muted}
            >
              {t(
                "Summaries and unsent drafts are kept. Choosing Forever does not restore deleted messages.",
              )}
            </Text>
          </InfoPopover>
        }
      >
        <Select
          hideLabel
          label={t("Keep conversation messages")}
          value={String(value)}
          disabled={disabled}
          options={[
            [0, t("Forever")],
            [30, t("30 days")],
            [90, t("90 days")],
            [365, t("365 days")],
          ].map(([value, label]) => ({
            value: String(value),
            label: String(label),
          }))}
          onValueChange={(next) => onChange(Number(next))}
        />
      </Row>
      <Row label={t("Today's usage")}>
        {usage ? (
          <AssistantUsageSummary usage={usage} dailyBudget={dailyBudget} />
        ) : (
          <Text size="caption" tone="secondary">
            {t("Unavailable")}
          </Text>
        )}
      </Row>
    </>
  );
}

/** Local budget usage, with provider metrics in the details popover. */
export function AssistantUsageSummary({
  usage,
  dailyBudget = 0,
}: {
  usage: AssistantSnapshot["usage"];
  dailyBudget?: number;
}) {
  const cache = usage.cacheUsage;
  const unavailable = t("Unavailable");
  // Worker tokens already count cache reads at one tenth; the raw read count is its own chip.
  const details: [string, string][] = [
    [t("Supervisor tokens"), formatNumber(usage.chiefTokens)],
    [t("Worker tokens"), formatNumber(usage.workerTokens)],
  ];
  if (cache?.cacheReadTokens !== undefined)
    details.push([t("Cache read tokens"), formatNumber(cache.cacheReadTokens)]);
  if (cache?.cacheWriteTokens !== undefined)
    details.push([t("Cache write tokens"), formatNumber(cache.cacheWriteTokens)]);
  if (cache?.cacheHitPercent !== undefined)
    details.push([
      t("Mean reported cache hit"),
      `${formatNumber(cache.cacheHitPercent, { maximumFractionDigits: 1 })}%`,
    ]);
  return (
    <div className={styles.usage}>
      <Text size="secondary">
        {dailyBudget > 0
          ? t("{p0} of {p1} tokens", {
              p0: formatNumber(usage.total),
              p1: formatNumber(dailyBudget),
            })
          : t("{p0} tokens", { p0: formatNumber(usage.total) })}
      </Text>
      <LiveText
        size="micro"
        tone="secondary"
        leading="inherit"
        className={viewStyles.muted}
        text={
          usage.workerUsageIncomplete || (cache && !cache.complete)
            ? t("Some usage is unavailable.")
            : usage.estimated
              ? t("Estimated")
              : ""
        }
      />
      <InfoPopover label={t("Usage details")}>
        {details.map(([label, value]) => (
          <Text key={label} as="p" size="secondary">
            {label}: {value}
          </Text>
        ))}
        <Text as="p" size="secondary">
          {t("Local scheduling limits, not a provider billing cap.")}
        </Text>
        {cache ? (
          <>
            {usage.workerUsageIncomplete && (
              <Text as="p" size="secondary">
                {t("Usage unavailable. No zero usage is assumed.")}
              </Text>
            )}
            {!cache.complete && (
              <Text as="p" size="secondary">
                {t("Partial cache usage. Missing values are unavailable, not zero.")}
              </Text>
            )}
            {cache.cacheReadTokens === undefined && (
              <Text as="p" size="secondary">
                {t("Cache read tokens")}: {unavailable}
              </Text>
            )}
            {cache.cacheWriteTokens === undefined && (
              <Text as="p" size="secondary">
                {t("Cache write tokens")}: {unavailable}
              </Text>
            )}
            {cache.cacheHitPercent === undefined && (
              <Text as="p" size="secondary">
                {t("Mean reported cache hit")}: {unavailable}
              </Text>
            )}
            <Text
              as="p"
              size="micro"
              tone="secondary"
              leading="inherit"
              className={viewStyles.muted}
            >
              {t("{p0} of {p1} worker turns measured", {
                p0: formatNumber(cache.measuredTurns),
                p1: formatNumber(cache.totalTurns),
              })}
            </Text>
            <Text
              as="p"
              size="micro"
              tone="secondary"
              leading="inherit"
              className={viewStyles.muted}
            >
              {t(
                "Budgets count cache reads at one tenth of a new token. Cache reads re-read earlier context and cost far less than new tokens.",
              )}
            </Text>
            {cache.cacheHitPercent !== undefined && (
              <Text
                as="p"
                size="micro"
                tone="secondary"
                leading="inherit"
                className={viewStyles.muted}
              >
                {t(
                  "Average of {p0} provider-reported worker percentages. This is not a billing discount.",
                  { p0: formatNumber(cache.percentageTurns) },
                )}
              </Text>
            )}
          </>
        ) : (
          <Text as="p" size="secondary">
            {t("Cache usage unavailable")}
          </Text>
        )}
      </InfoPopover>
    </div>
  );
}
