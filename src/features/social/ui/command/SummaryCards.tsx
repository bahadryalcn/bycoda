import { Meter } from "../../../../shared/ui/Meter";
import { StatRow, StatTile } from "../../../../shared/ui/StatTile";
import { t } from "../../../../shared/i18n";
import type { AiSummary } from "../../model/socialActions";
import { summaryCards } from "./commandModel";

/** Four stats: sent today, pending, new people and reply rate. */
export function SummaryCards({ summary }: { summary?: AiSummary }) {
  return (
    <StatRow label={t("Summary")}>
      {summaryCards(summary).map((card) => (
        <StatTile key={card.key} label={card.label} value={card.value}>
          {card.key === "reply" && card.percent !== undefined ? (
            <Meter label={card.label} value={card.percent} tone="accent" />
          ) : null}
        </StatTile>
      ))}
    </StatRow>
  );
}
