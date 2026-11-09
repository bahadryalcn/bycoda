import { t } from "../../../../shared/i18n";
import { dateTimeFormat } from "../../../../shared/lib/intl";
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
  if (options.canReply) return undefined;
  switch (options.reasonCode) {
    case "window.expired":
      return t("The 24-hour window has passed. Only a template can be sent.");
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

/** Messages of one local calendar day, oldest first. */
export type DayGroup = { key: string; at: number; lines: MessageLine[] };

function dayKey(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** Splits an ordered message list into local calendar days. Order inside and between days is kept. */
export function groupByDay(lines: MessageLine[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const line of lines) {
    const key = dayKey(line.at);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.lines.push(line);
    else groups.push({ key, at: line.at, lines: [line] });
  }
  return groups;
}

/** "Today", "Yesterday" or a short date for the separator above a day of messages. */
export function dayLabel(at: number, now: number, locale: string): string {
  if (dayKey(at) === dayKey(now)) return t("Today");
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (dayKey(at) === dayKey(yesterday.getTime())) return t("Yesterday");
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear();
  return dateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(new Date(at));
}

/** Clock time under a message bubble. */
export function clockTime(at: number, locale: string): string {
  return dateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(new Date(at));
}
