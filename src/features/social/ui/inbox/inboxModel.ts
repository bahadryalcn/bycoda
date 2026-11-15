import { t } from "../../../../shared/i18n";
import { SOCIAL_PLATFORM_NAMES } from "../../model/social";
import { capabilityReasonText } from "../common/capabilityText";
import type { InboxReplyOptions, InboxStatus, UnreadableAccount } from "./inboxTypes";

export function statusText(status: InboxStatus): string {
  switch (status) {
    case "unread":
      return t("Unread");
    case "replied":
      return t("Replied");
    case "assigned":
      return t("Assigned");
    case "done":
      return t("Done");
  }
}

/** Badge tone of a conversation status: unread needs attention, replied is active, done is settled. */
export function statusTone(status: InboxStatus): "warning" | "accent" | "info" | "success" {
  switch (status) {
    case "unread":
      return "warning";
    case "replied":
      return "accent";
    case "assigned":
      return "info";
    case "done":
      return "success";
  }
}

/** Why the reply box is blocked, in plain words. Undefined when a reply can be sent. */
export function replyBlockedText(options: InboxReplyOptions): string | undefined {
  if (options.templatesOnly)
    return t("This conversation requires a template. Template replies are unavailable here.");
  if (options.canReply) return undefined;
  switch (options.reasonCode) {
    case "window.expired":
      return t("The reply window has closed. Replies are unavailable here.");
    case "platform.reply_not_allowed":
      return t("The platform does not allow replies to this conversation.");
    case undefined:
      return t("This account cannot reply right now.");
    default:
      return capabilityReasonText({
        status: "unsupported",
        reasonCode: options.reasonCode,
      });
  }
}

/** "Can't read messages on <account>: <reason>". The reason comes from the capability code. */
export function unreadableText(account: UnreadableAccount, accountName: string): string {
  return t("Can't read messages on {p0}: {p1}", {
    p0: accountName || SOCIAL_PLATFORM_NAMES[account.platform],
    p1: capabilityReasonText({
      status: "unsupported",
      reasonCode: account.reasonCode,
    }),
  });
}

/** One message of a conversation, as the view draws it. */
export type MessageLine = {
  id: string;
  at: number;
  direction: "inbound" | "outbound";
  text: string;
};
