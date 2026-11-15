import { t } from "../../../../shared/i18n";
import { MessageTimeline as SharedMessageTimeline } from "../../../../shared/ui/MessageTimeline";
import type { MessageLine } from "./inboxModel";

/** Inbox messages on the shared timeline. Message text is plain text only. */
export function MessageTimeline({ lines }: { lines: MessageLine[] }) {
  return (
    <SharedMessageTimeline
      label={t("Conversation")}
      className="inbox-timeline"
      items={lines.map((line) => ({
        id: line.id,
        time: line.at,
        own: line.direction === "outbound",
        body: <p className="inbox-line-text">{line.text}</p>,
      }))}
    />
  );
}
