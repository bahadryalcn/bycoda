import { Tooltip } from "../../../shared/ui/Tooltip";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { t } from "../../../shared/i18n";
import { formatAttachmentSize } from "../../../shared/i18n/format";
import { Button } from "../../../shared/ui/Button";
import type { MessageTimelineItem } from "../../../shared/ui/MessageTimeline";
import { splitMessageText } from "../model/messageText";
import type { ThreadMessage } from "../model/messagingTypes";

function MessageBody({ body, onOpenLink }: { body: string; onOpenLink: (url: string) => void }) {
  return (
    <span className="whitespace-pre-wrap">
      {splitMessageText(body).map((part, index) =>
        part.kind === "link" ? (
          <Button
            // Parts are positional and never reordered within one body.
            key={index}
            variant="link"
            layout="text"
            // A wrapped URL keeps the bubble's start alignment instead of centering.
            className="wrap-anywhere text-start"
            onClick={() => onOpenLink(part.url)}
          >
            {part.text}
          </Button>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </span>
  );
}

function messageItem(
  message: ThreadMessage,
  onOpenLink: (url: string) => void,
): MessageTimelineItem {
  return {
    id: message.id,
    own: message.outbound,
    author: message.author || message.authorAddress || t("Unknown"),
    // A message without a usable time sorts with the epoch and still renders.
    time: Number.isFinite(message.at) ? message.at : 0,
    body: message.body ? <MessageBody body={message.body} onOpenLink={onOpenLink} /> : null,
    attachments: message.attachments.map((attachment, index) => {
      const size = attachment.size ? formatAttachmentSize(attachment.size) : null;
      return (
        <Tooltip key={`${attachment.name}:${index}`} label={attachment.name} asChild>
          <Text
            as="span"
            size="micro"
            tone="secondary"
            truncate
            {...surfaceAttributes(
              { frame: "pane" },
              "max-w-full rounded-(--ui-radius-control) px-1.5",
            )}
          >
            {size ? t("{p0} ({p1})", { p0: attachment.name, p1: size }) : attachment.name}
          </Text>
        </Tooltip>
      );
    }),
  };
}

/**
 * Timeline items for a conversation that keep their identity while nothing they show changed,
 * so a refresh or an opened earlier page rebuilds (link parts, attachment tooltips) only the
 * messages that are new or edited. The link handler and `locale` are the shared context: a
 * change to either rebuilds every item, and `locale` is not an input of the item itself (the
 * translated strings are).
 */
export function createThreadMessageProjection() {
  let context: { onOpenLink: (url: string) => void; locale: string } | undefined;
  let cache = new Map<string, { message: ThreadMessage; item: MessageTimelineItem }>();
  return (
    messages: readonly ThreadMessage[],
    onOpenLink: (url: string) => void,
    locale: string,
  ): MessageTimelineItem[] => {
    if (!context || context.onOpenLink !== onOpenLink || context.locale !== locale) {
      cache = new Map();
    }
    context = { onOpenLink, locale };
    const previous = cache;
    cache = new Map();
    return messages.map((message) => {
      const hit = previous.get(message.id);
      if (hit && hit.message === message) {
        cache.set(message.id, hit);
        return hit.item;
      }
      const item = messageItem(message, onOpenLink);
      cache.set(message.id, { message, item });
      return item;
    });
  };
}
