import type { ReactNode } from "react";
import { t } from "../../../../shared/i18n";
import { Meter } from "../../../../shared/ui/Meter";
import { Surface } from "../../../../shared/ui/Surface";
import { Check, Clock, MessageSquare, UserRound } from "../../../../shared/ui/icons";
import type { AiSummary } from "../../model/socialActions";
import { summaryCards, type SummaryCard } from "./commandModel";

const ICON_PROPS = { className: "icon-sm", strokeWidth: 1.75, "aria-hidden": true } as const;

const ICONS: Record<SummaryCard["key"], ReactNode> = {
  sent: <Check {...ICON_PROPS} />,
  pending: <Clock {...ICON_PROPS} />,
  people: <UserRound {...ICON_PROPS} />,
  reply: <MessageSquare {...ICON_PROPS} />,
};

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
        <Surface key={card.key} variant="card" className="command-card">
          <span className="command-card-icon">{ICONS[card.key]}</span>
          <div className="command-card-body">
            <span className="command-card-label">{card.label}</span>
            <span className="command-card-value">{card.value}</span>
            {card.key === "reply" && card.percent !== undefined ? (
              <Meter label={card.label} value={card.percent} tone="accent" />
            ) : null}
            {card.key === "pending" && approvalCount > 0 ? (
              <span className="command-card-note">
                {t("{p0} waiting for approval", { p0: approvalCount })}
              </span>
            ) : null}
          </div>
        </Surface>
      ))}
    </div>
  );
}
