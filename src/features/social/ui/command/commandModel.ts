import { formatNumber, t } from "../../../../shared/i18n";
import { formatChatDate } from "../../../../shared/i18n/format";
import { AI_MODEL_REQUIRED_MESSAGE } from "../../model/socialTools";
import type { AiAction } from "../../model/autonomy";
import type {
  AiPlanRunResult,
  AiPlanStep,
  AiSummary,
  NeedsHumanItem,
} from "../../model/socialActions";
import type { ActivityKind } from "../common/ActivityRow";
import type { StatusTextStatus } from "../common/StatusText";

export type StepResult = AiPlanRunResult["results"][number];

/** Steps the owner must approve before the plan can run them, and that have not finished. */
export function pendingApprovalIds(
  steps: AiPlanStep[],
  results: Record<string, StepResult>,
): string[] {
  return steps
    .filter((step) => step.needsApproval && !isFinished(results[step.id]))
    .map((step) => step.id);
}

function isFinished(result?: StepResult): boolean {
  return result?.status === "done" || result?.status === "failed";
}

/** One short line per step: what the Host did, or will do, with it. */
export function stepStatusLabel(
  step: AiPlanStep,
  result: StepResult | undefined,
  approved: boolean,
) {
  if (result) {
    switch (result.status) {
      case "done":
        return t("Done");
      case "failed":
        return t("Failed");
      case "blocked":
        return t("Blocked");
      case "queued":
        return t("Waiting for approval");
      default:
        return t("Waiting for approval");
    }
  }
  if (!step.needsApproval) return t("Will run automatically");
  return approved ? t("Approved") : t("Needs your approval");
}

const ACTION_LABELS: Record<string, () => string> = {
  "replies.send": () => t("Sent a reply"),
  "messages.send": () => t("Sent a message"),
  "comments.send": () => t("Posted a comment"),
  "campaigns.schedule": () => t("Scheduled a post"),
  "email.send": () => t("Sent an email"),
  "sequences.start": () => t("Started a sequence"),
  "lists.addMembers": () => t("Added people to a list"),
  "lists.removeMembers": () => t("Removed people from a list"),
  "people.update": () => t("Updated a person"),
  "audience.collect": () => t("Collected people"),
  "ai.stop": () => t("Stopped AI"),
};

/** Plain title for an activity row; falls back to the Host's summary for other operations. */
export function activityTitle(item: AiAction): string {
  return ACTION_LABELS[item.action]?.() ?? item.summary;
}

/** Which glyph an activity row shows, from the Host action name ("replies.send" is a reply). */
export function activityKind(item: AiAction): ActivityKind {
  const family = item.action.split(".")[0];
  switch (family) {
    case "replies":
    case "comments":
      return "reply";
    case "campaigns":
    case "posts":
      return "publish";
    case "messages":
    case "email":
    case "sequences":
      return "message";
    case "lists":
    case "people":
    case "audience":
      return "audience";
    default:
      return "other";
  }
}

export type ActivityDayGroup = { key: string; label: string; items: AiAction[] };

const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

/**
 * Groups a newest-first feed by local calendar day. The label is "Today", "Yesterday" or the
 * formatted date; item order inside and between groups is kept.
 */
export function groupActivityByDay(items: AiAction[], now = Date.now()): ActivityDayGroup[] {
  const today = new Date(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const groups: ActivityDayGroup[] = [];
  for (const item of items) {
    const key = dayKey(new Date(item.at));
    const last = groups[groups.length - 1];
    if (last?.key === key) {
      last.items.push(item);
      continue;
    }
    const label =
      key === dayKey(today)
        ? t("Today")
        : key === dayKey(yesterday)
          ? t("Yesterday")
          : formatChatDate(item.at, now);
    groups.push({ key, label, items: [item] });
  }
  return groups;
}

export function activityStatus(item: AiAction): StatusTextStatus {
  switch (item.status) {
    case "done":
      return "succeeded";
    case "failed":
      return "failed";
    case "queued":
      return "review";
    case "blocked":
    case "undone":
      return "cancelled";
  }
}

/** Undo is offered only where the Host recorded an inverse and it has not run yet. */
export function undoBlockedReason(item: AiAction): string | undefined {
  if (item.status === "undone") return t("Already undone.");
  if (!item.undo) return t("This action cannot be undone.");
  return undefined;
}

export type SummaryCard = {
  key: "sent" | "pending" | "people" | "reply";
  label: string;
  value: string;
  /** 0-100 measure for the tile's meter; only the reply rate has one, and only once loaded. */
  percent?: number;
};

/** The four summary cards. Before the first load every value is a dash, never a zero. */
export function summaryCards(summary?: AiSummary): SummaryCard[] {
  const count = (value: number | undefined) => (summary ? formatNumber(value ?? 0) : "—");
  return [
    { key: "sent", label: t("Sent today"), value: count(summary?.sentToday) },
    { key: "pending", label: t("Pending"), value: count(summary?.pending) },
    { key: "people", label: t("New people"), value: count(summary?.newPeople) },
    {
      key: "reply",
      label: t("Reply rate"),
      value: summary
        ? formatNumber(summary.replyRate, { style: "percent", maximumFractionDigits: 0 })
        : "—",
      ...(summary
        ? { percent: Math.max(0, Math.min(100, Math.round(summary.replyRate * 100))) }
        : {}),
    },
  ];
}

/** Matches the exact missing-model message so the setup card, not a generic error, is shown. */
export function isModelRequired(message: string | undefined): boolean {
  return message === AI_MODEL_REQUIRED_MESSAGE;
}

export function needsHumanReason(item: NeedsHumanItem): string {
  switch (item.reason) {
    case "challenge":
      return t("A security check is open. Complete it yourself.");
    case "verification":
      return t("A verification code is requested. Enter it yourself.");
    case "login":
      return t("Sign in to continue.");
    case "unexpected_screen":
      return t("The site showed a screen AI does not recognize.");
  }
}
