import { Timestamp } from "../../../../shared/ui/Timestamp";
import { t, useLocale } from "../../../../shared/i18n";
import { dayLabel, groupByDay, type MessageLine } from "./inboxModel";
import "./inbox.css";

/**
 * Messages as bubbles: incoming left, outgoing right, a centered day separator between days.
 * Message text is plain text only.
 */
export function MessageTimeline({ lines }: { lines: MessageLine[] }) {
  const locale = useLocale();
  const now = Date.now();
  return (
    <ol className="inbox-timeline" aria-label={t("Conversation")}>
      {groupByDay(lines).flatMap((group) => [
        <li key={`day-${group.key}`} className="inbox-day">
          <span className="inbox-day-label">{dayLabel(group.at, now, locale)}</span>
        </li>,
        ...group.lines.map((line) => (
          <li key={line.id} className="inbox-line" data-direction={line.direction}>
            <div className="inbox-bubble">
              <p className="inbox-line-text">{line.text}</p>
            </div>
            <Timestamp className="inbox-line-time" value={line.at} format="time" tooltip={false} />
          </li>
        )),
      ])}
    </ol>
  );
}
