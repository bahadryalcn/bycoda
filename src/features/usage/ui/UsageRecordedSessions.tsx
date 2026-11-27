import type { ComponentProps } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Text } from "../../../shared/ui/Text";
import { Button } from "../../../shared/ui/Button";
import { Heading } from "../../../shared/ui/Heading";
import { InfoTooltip } from "../../../shared/ui/InfoPopover";
import { recordedSessionRows } from "../model/recordedSessionRows";
import type { UsageMetric, sessionUsage } from "../model/usageAnalytics";
import { ContinuousUsageTable } from "./UsageCharts";
import { UsageProviderIdentity } from "./UsageProviderIdentity";

/** Recorded-turn sessions; kept apart from provider-log totals by design. */
export function UsageRecordedSessions({
  unavailable,
  stateKey,
  sessionRows,
  turnRows,
  selectedSession,
  onSelectSession,
  metric = "duration",
}: {
  unavailable: boolean;
  stateKey: string;
  sessionRows: ReturnType<typeof sessionUsage>;
  turnRows: ComponentProps<typeof ContinuousUsageTable>["rows"];
  selectedSession: string | null;
  onSelectSession: (key: string | null) => void;
  /** The page's selected metric; sessions fall back to agent time when no session has it. */
  metric?: UsageMetric;
}) {
  useLocale();
  // A failed read of the session logs is reported once, in the notice above the results.
  if (unavailable) return null;
  const rows = recordedSessionRows(sessionRows);
  const tableMetric =
    metric !== "duration" && rows.some((row) => row[metric] != null) ? metric : "duration";
  return (
    <section className="usage-sessions">
      <ContinuousUsageTable
        stateKey={`${stateKey}:${tableMetric}`}
        caption={t("Recorded sessions")}
        metric={tableMetric}
        rows={rows}
        onSelect={onSelectSession}
        heading={
          <>
            <Heading size="item" level={3}>
              {t("Recorded sessions")}
            </Heading>
            <InfoTooltip label={t("Recorded sessions")}>
              {t(
                "Session tokens come from recorded turn metrics. Only whole turns inside the interval are included; these values are not added to provider-log totals.",
              )}
            </InfoTooltip>
          </>
        }
        actions={
          selectedSession ? (
            <Button variant="ghost" size="sm" onClick={() => onSelectSession(null)}>
              {t("All sessions")}
            </Button>
          ) : null
        }
      />
      {selectedSession &&
        sessionRows.map((row) => (
          <Text as="p" leading="inherit" className="usage-muted" key={row.key}>
            {row.title} · <UsageProviderIdentity provider={row.provider} /> · {row.timedTurns}/
            {row.turns} {t("turns with duration")} · {row.meteredTurns}/{row.turns}{" "}
            {t("turns with tokens")} · {row.unpricedTurns} {t("unpriced turns")}
          </Text>
        ))}
      {selectedSession && (
        <ContinuousUsageTable caption={t("Recorded turns")} rows={turnRows} metric={tableMetric} />
      )}
    </section>
  );
}
