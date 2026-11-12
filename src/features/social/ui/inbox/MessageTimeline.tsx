import { Text } from "../../../../shared/ui/Text";
import { Timestamp } from "../../../../shared/ui/Timestamp";
import { t, useLocale } from "../../../../shared/i18n";
import { wallClockNow } from "../../../../shared/lib/time/wallClock";
import { dayLabel, groupByDay, type MessageLine } from "./inboxModel";
import "./inbox.css";

/**
 * Messages as bubbles: incoming left, outgoing right, a centered day separator between days.
 * Message text is plain text only.
 */
export function MessageTimeline({ lines }: { lines: MessageLine[] }) {
  const locale = useLocale();
  const now = wallClockNow();
  return (
    <ol className="inbox-timeline" aria-label={t("Conversation")}>
      {groupByDay(lines).flatMap((group) => [
        <Text
          as="li"
          size="caption"
          tone="muted"
          leading="inherit"
          key={`day-${group.key}`}
          className="inbox-day"
        >
          <span className="inbox-day-label">{dayLabel(group.at, now, locale)}</span>
        </Text>,
        ...group.lines.map((line) => (
          <li key={line.id} className="inbox-line" data-direction={line.direction}>
            <Text as="div" size="inherit" tone="primary" className="inbox-bubble">
              <p className="inbox-line-text">{line.text}</p>
            </Text>
            <Timestamp
              className="inbox-line-time"
              size="caption"
              tone="muted"
              leading="inherit"
              value={line.at}
              format="time"
              tooltip={false}
            />
          </li>
        )),
      ])}
    </ol>
  );
}
