import { Badge } from "../../../../shared/ui/Badge";
import type { AssistantSnapshot } from "../../../../shared/model/host-contracts/assistant";
import { formatNumber, t } from "../../../../shared/i18n";
import { InfoPopover } from "../../../../shared/ui/InfoPopover";
import { LiveText } from "../../../../shared/ui/LiveText";
import { Text } from "../../../../shared/ui/Text";
import { Select } from "../../../../shared/ui/Select";
import { Row } from "../../../settings/public/settingsControls";
import styles from "./costUsage.module.css";
import viewStyles from "../AssistantView.module.css";

/** Conversation retention draft and, when given, today's usage on the same row. Saved by the page footer. */
export function AssistantRetentionField({
  value,
  disabled,
  onChange,
  usage,
}: {
  value: number;
  disabled: boolean;
  onChange: (days: number) => void;
  usage?: AssistantSnapshot["usage"];
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
      {usage && (
        <Row label={t("Today's usage")} stacked>
          <AssistantUsageChips usage={usage} />
        </Row>
      )}
    </>
  );
}

/** Measured usage as compact chips. Missing usage is stated once, never shown as zero. */
export function AssistantUsageChips({ usage }: { usage: AssistantSnapshot["usage"] }) {
  const cache = usage.cacheUsage;
  const unavailable = t("Unavailable");
  // Worker tokens already count cache reads at one tenth; the raw read count is its own chip.
  const chips: [string, string][] = [
    [t("Supervisor tokens"), formatNumber(usage.chiefTokens)],
    [t("Worker tokens"), formatNumber(usage.workerTokens)],
  ];
  if (cache?.cacheReadTokens !== undefined)
    chips.push([t("Cache read tokens"), formatNumber(cache.cacheReadTokens)]);
  if (cache?.cacheWriteTokens !== undefined)
    chips.push([t("Cache write tokens"), formatNumber(cache.cacheWriteTokens)]);
  if (cache?.cacheHitPercent !== undefined)
    chips.push([
      t("Mean reported cache hit"),
      `${formatNumber(cache.cacheHitPercent, { maximumFractionDigits: 1 })}%`,
    ]);
  return (
    <div className={styles.usage}>
      <ul className={styles.chips} aria-label={t("Today's usage")}>
        {chips.map(([label, value]) => (
          <li key={label}>
            <Badge size="sm" appearance="subtle">
              {label}: {value}
            </Badge>
          </li>
        ))}
      </ul>
      <LiveText
        size="micro"
        tone="secondary"
        leading="inherit"
        className={viewStyles.muted}
        text={
          usage.workerUsageIncomplete || !cache || !cache.complete
            ? t("Some usage is unavailable.")
            : ""
        }
      />
      {cache ? (
        <>
          <InfoPopover label={t("About usage")}>
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
          </InfoPopover>
        </>
      ) : (
        <InfoPopover label={t("About usage")}>
          <Text as="p" size="secondary">
            {t("Cache usage unavailable")}
          </Text>
          {usage.workerUsageIncomplete && (
            <Text as="p" size="secondary">
              {t("Usage unavailable. No zero usage is assumed.")}
            </Text>
          )}
        </InfoPopover>
      )}
    </div>
  );
}
