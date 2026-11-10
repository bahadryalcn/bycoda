import type { AssistantSnapshot } from "../../../../shared/model/host-contracts/assistant";
import { formatNumber, t } from "../../../../shared/i18n";
import { InfoPopover } from "../../../../shared/ui/InfoPopover";
import { LiveText } from "../../../../shared/ui/LiveText";
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
        description={t("Older messages move to Recently deleted for seven days.")}
        info={
          <InfoPopover label={t("About conversation retention")}>
            <p className={viewStyles.muted}>
              {t(
                "Summaries and unsent drafts are kept. Choosing Forever does not restore deleted messages.",
              )}
            </p>
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
  // Worker tokens include cache reads; split them out only when the read count is complete.
  const cacheReads = cache?.complete ? cache.cacheReadTokens : undefined;
  const chips: [string, string][] = [
    [t("Supervisor tokens"), formatNumber(usage.chiefTokens)],
    cacheReads === undefined
      ? [t("Worker tokens"), formatNumber(usage.workerTokens)]
      : [t("Worker new tokens"), formatNumber(Math.max(0, usage.workerTokens - cacheReads))],
  ];
  if (cache)
    chips.push(
      [
        t("Cache read tokens"),
        cache.cacheReadTokens === undefined ? unavailable : formatNumber(cache.cacheReadTokens),
      ],
      [
        t("Cache write tokens"),
        cache.cacheWriteTokens === undefined ? unavailable : formatNumber(cache.cacheWriteTokens),
      ],
      [
        t("Mean reported cache hit"),
        cache.cacheHitPercent === undefined
          ? unavailable
          : `${formatNumber(cache.cacheHitPercent, { maximumFractionDigits: 1 })}%`,
      ],
    );
  return (
    <div className={styles.usage}>
      <ul className={styles.chips} aria-label={t("Today's usage")}>
        {chips.map(([label, value]) => (
          <li key={label} className={styles.chip}>
            <span>{label}:</span> <strong>{value}</strong>
          </li>
        ))}
      </ul>
      <LiveText
        className={viewStyles.muted}
        text={usage.workerUsageIncomplete ? t("Usage unavailable. No zero usage is assumed.") : ""}
      />
      {cache ? (
        <>
          {!cache.complete && (
            <p className={`${viewStyles.muted} ${styles.note}`}>
              {t("Partial cache usage. Missing values are unavailable, not zero.")}
            </p>
          )}
          <InfoPopover label={t("About usage")}>
            <p className={viewStyles.muted}>
              {t("{p0} of {p1} worker turns measured", {
                p0: formatNumber(cache.measuredTurns),
                p1: formatNumber(cache.totalTurns),
              })}
            </p>
            {cacheReads !== undefined && (
              <p className={viewStyles.muted}>
                {t(
                  "Worker tokens total {p0}, including {p1} cache reads. Cache reads re-read earlier context and cost far less than new tokens.",
                  { p0: formatNumber(usage.workerTokens), p1: formatNumber(cacheReads) },
                )}
              </p>
            )}
            {cache.cacheHitPercent !== undefined && (
              <p className={viewStyles.muted}>
                {t(
                  "Average of {p0} provider-reported worker percentages. This is not a billing discount.",
                  { p0: formatNumber(cache.percentageTurns) },
                )}
              </p>
            )}
          </InfoPopover>
        </>
      ) : (
        <p className={`${viewStyles.muted} ${styles.note}`}>{t("Cache usage unavailable")}</p>
      )}
    </div>
  );
}
