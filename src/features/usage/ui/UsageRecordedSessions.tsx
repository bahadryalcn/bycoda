import type { ComponentProps } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { recordedSessionRows } from "../model/recordedSessionRows";
import type { sessionUsage } from "../model/usageAnalytics";
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
}: {
  unavailable: boolean;
  stateKey: string;
  sessionRows: ReturnType<typeof sessionUsage>;
  turnRows: ComponentProps<typeof ContinuousUsageTable>["rows"];
  selectedSession: string | null;
  onSelectSession: (key: string | null) => void;
}) {
  useLocale();
  if (unavailable)
    return (
      <Alert tone="info">
        {t("Session duration data is unavailable on this app version or could not be read.")}
      </Alert>
    );
  return (
    <section className="usage-sessions">
      <div className="usage-section-heading">
        <div className="flex items-center gap-2">
          <h3>{t("Recorded sessions")}</h3>
          <InfoPopover label={t("Recorded sessions")}>
            {t(
              "Session tokens come from recorded turn metrics. Only whole turns inside the interval are included; these values are not added to provider-log totals.",
            )}
          </InfoPopover>
        </div>
        {selectedSession && (
          <Button variant="ghost" size="sm" onClick={() => onSelectSession(null)}>
            {t("All sessions")}
          </Button>
        )}
      </div>
      <ContinuousUsageTable
        stateKey={stateKey}
        caption={t("Recorded sessions")}
        metric="duration"
        rows={recordedSessionRows(sessionRows)}
        onSelect={onSelectSession}
      />
      {selectedSession &&
        sessionRows.map((row) => (
          <p className="usage-muted" key={row.key}>
            {row.title} · <UsageProviderIdentity provider={row.provider} /> · {row.timedTurns}/
            {row.turns} {t("turns with duration")} · {row.meteredTurns}/{row.turns}{" "}
            {t("turns with tokens")} · {row.unpricedTurns} {t("unpriced turns")}
          </p>
        ))}
      {selectedSession && (
        <ContinuousUsageTable caption={t("Recorded turns")} rows={turnRows} metric="duration" />
      )}
    </section>
  );
}
