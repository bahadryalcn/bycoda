import { Text } from "../../../../shared/ui/Text";
import { Divider } from "../../../../shared/ui/Divider";
import { surfaceAttributes } from "../../../../shared/ui/Surface";
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
          <Divider decorative className="min-w-0 flex-1 self-center" />
          <span className="inbox-day-label">{dayLabel(group.at, now, locale)}</span>
          <Divider decorative className="min-w-0 flex-1 self-center" />
        </Text>,
        ...group.lines.map((line) => (
          <li key={line.id} className="inbox-line" data-direction={line.direction}>
            <Text
              as="div"
              size="inherit"
              tone="primary"
              {...surfaceAttributes(
                {
                  radius: "card",
                  variant: "fill-subtle",
                  tone: line.direction === "outbound" ? "accent" : undefined,
                  frame: line.direction === "outbound" ? "accent" : undefined,
                },
                "inbox-bubble",
              )}
            >
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
