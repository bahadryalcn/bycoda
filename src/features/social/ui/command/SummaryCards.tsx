import { Text } from "../../../../shared/ui/Text";
import { t } from "../../../../shared/i18n";
import { Meter } from "../../../../shared/ui/Meter";
import { Surface } from "../../../../shared/ui/Surface";
import type { AiSummary } from "../../model/socialActions";
import { summaryCards } from "./commandModel";

/** Four stat tiles: sent today, pending, new people and reply rate. */
export function SummaryCards({
  summary,
  approvalCount = 0,
}: {
  summary?: AiSummary;
  /** Actions waiting for approval; the Pending tile names them when above zero. */
  approvalCount?: number;
}) {
  return (
    <div className="command-cards">
      {summaryCards(summary).map((card) => (
        <Surface key={card.key} variant="canvas" padding="sm" className="command-card">
          <div className="command-card-body">
            <Text size="caption" tone="secondary" leading="inherit" className="command-card-label">
              {card.label}
            </Text>
            <Text
              as="span"
              size="title"
              tone="primary"
              weight="medium"
              leading="inherit"
              className="command-card-value"
            >
              {card.value}
            </Text>
            {card.key === "reply" && card.percent !== undefined ? (
              <Meter label={card.label} value={card.percent} tone="accent" />
            ) : null}
            {card.key === "pending" && approvalCount > 0 ? (
              <Text leading="inherit" size="caption" tone="warning" className="command-card-note">
                {t("{p0} waiting for approval", { p0: approvalCount })}
              </Text>
            ) : null}
          </div>
        </Surface>
      ))}
    </div>
  );
}
