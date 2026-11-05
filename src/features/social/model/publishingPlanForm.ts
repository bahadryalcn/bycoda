import { dateTimeFormat, getLocale, t } from "../../../shared/i18n";
import type { SocialPublishingPlan } from "./social";

export type PublishingScheduleFields = {
  timeZone: string;
  startTime: string;
  endTime: string;
  minHours: string;
  maxHours: string;
};

export function localPublishingTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Istanbul";
}

export function scheduleFields(
  schedule: SocialPublishingPlan["schedule"],
): PublishingScheduleFields {
  return {
    timeZone: schedule.timeZone,
    startTime: schedule.startTime,
    endTime: schedule.endTime,
    minHours: String(schedule.minIntervalMinutes / 60),
    maxHours: String(schedule.maxIntervalMinutes / 60),
  };
}

/** The browser mirrors host validation; the host owns scheduling and authorization. */
export function publishingSchedule(fields: PublishingScheduleFields): {
  schedule?: SocialPublishingPlan["schedule"];
  error?: string;
} {
  if (
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(fields.startTime) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(fields.endTime)
  )
    return { error: t("Enter a start and end time.") };
  const timeZone = fields.timeZone.trim();
  try {
    dateTimeFormat(getLocale(), { timeZone }).format(0);
  } catch {
    return { error: t("Enter a valid time zone, for example Europe/Istanbul.") };
  }
  const minIntervalMinutes = Number(fields.minHours) * 60;
  const maxIntervalMinutes = Number(fields.maxHours) * 60;
  if (
    !fields.minHours.trim() ||
    !fields.maxHours.trim() ||
    !Number.isInteger(minIntervalMinutes) ||
    !Number.isInteger(maxIntervalMinutes) ||
    minIntervalMinutes < 1 ||
    maxIntervalMinutes > 10080
  )
    return {
      error: t(
        "Enter whole-minute intervals. The shortest interval is at least 1 minute and the longest at most 168 hours.",
      ),
    };
  if (minIntervalMinutes > maxIntervalMinutes)
    return { error: t("The shortest interval cannot exceed the longest interval.") };
  return {
    schedule: {
      timeZone,
      startTime: fields.startTime,
      endTime: fields.endTime,
      minIntervalMinutes,
      maxIntervalMinutes,
    },
  };
}

export function publishingScheduleSummary(schedule: SocialPublishingPlan["schedule"]) {
  const window =
    schedule.startTime === schedule.endTime
      ? t("all day")
      : schedule.startTime > schedule.endTime
        ? t("between {p0} and {p1} (crosses midnight)", {
            p0: schedule.startTime,
            p1: schedule.endTime,
          })
        : t("between {p0} and {p1}", { p0: schedule.startTime, p1: schedule.endTime });
  const minHours = schedule.minIntervalMinutes / 60;
  const maxHours = schedule.maxIntervalMinutes / 60;
  const interval =
    minHours === maxHours
      ? t("every {p0} hours", { p0: minHours })
      : t("at least {p0} and at most {p1} hours apart", { p0: minHours, p1: maxHours });
  const outsideWindow =
    schedule.startTime === schedule.endTime
      ? ""
      : ` ${t("The interval applies within publishing hours; if it runs past the window, publishing waits for the next start time.")}`;
  return `${t("Every day {p0}, {p1}. Time zone: {p2}.", { p0: window, p1: interval, p2: schedule.timeZone })}${outsideWindow}`;
}

export function publishingPlanTime(value: number | undefined, timeZone: string) {
  if (value === undefined || !Number.isFinite(value)) return "—";
  try {
    return dateTimeFormat(getLocale(), {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
    }).format(value);
  } catch {
    return "—";
  }
}

export type PublishingPauseFeedback = {
  status: "paused" | "review" | "completed";
  kind: "info" | "warning" | "success";
  title: string;
  message: string;
  technicalDetail?: string;
};

/** Translate known host outcomes; unknown diagnostics remain an optional detail. */
export function publishingPauseFeedback(reason?: string): PublishingPauseFeedback {
  const value = reason?.trim() ?? "";
  if (!value || value === "Paused by owner.")
    return {
      status: "paused",
      kind: "info",
      title: value ? t("Plan paused by you") : t("Plan is paused"),
      message: t(
        "When you are ready, check the schedule and content pool, then re-enable automatic publishing.",
      ),
    };
  if (value === "Review the campaign pool and explicitly activate this plan.")
    return {
      status: "review",
      kind: "info",
      title: t("Plan awaiting activation approval"),
      message: t(
        "Review the content pool and schedule, confirm the plan, then enable automatic publishing.",
      ),
    };
  if (value === "Publishing plan was edited. Review the new schedule and pool.")
    return {
      status: "review",
      kind: "info",
      title: t("Plan changes awaiting approval"),
      message: t("Review the new schedule and content pool, then re-enable automatic publishing."),
    };
  if (
    value.startsWith("All approved pool campaigns were published.") ||
    value.startsWith("Publishing pool is complete.")
  )
    return {
      status: "completed",
      kind: "success",
      title: t("Content pool completed"),
      message: t("Add new approved campaigns to the plan to keep publishing."),
    };
  if (value.startsWith("Publishing account is paused, disconnected or assigned to another host."))
    return {
      status: "review",
      kind: "warning",
      title: t("Check the account connection"),
      message: t(
        "In Accounts, check the connection and the host the account runs on, resume the account, then re-enable the plan.",
      ),
    };
  if (
    value.startsWith("Project publication permission was revoked.") ||
    value.startsWith("Every campaign project needs publication permission")
  )
    return {
      status: "review",
      kind: "warning",
      title: t("Project publishing permission required"),
      message: t(
        "In Accounts, grant publishing permission for all campaign projects, then re-enable the plan.",
      ),
    };
  if (
    value.startsWith("Publishing policy, account permissions or plan changed.") ||
    value.startsWith("Publishing authorization changed.")
  )
    return {
      status: "review",
      kind: "warning",
      title: t("Publishing settings or permissions changed"),
      message: t(
        "Check account permissions, content limits and the plan; confirm the plan again and enable automatic publishing.",
      ),
    };
  if (value.startsWith("Campaign pool approval changed."))
    return {
      status: "review",
      kind: "warning",
      title: t("Content approval must be renewed"),
      message: t(
        "In Campaigns, approve the changed content for publishing again. Edit the plan and save the current content pool.",
      ),
    };
  if (
    /^(OAuth token expired\.|Account credentials expired\.|Credentials expired\.|Browser session expired\.|expired$|SocialPlatformError: expired)/i.test(
      value,
    )
  )
    return {
      status: "review",
      kind: "warning",
      title: t("Account connection expired"),
      message: t("Sign in again in Accounts and re-enable the plan."),
    };
  if (value.startsWith("Waiting for OAuth scopes/API access:"))
    return {
      status: "review",
      kind: "warning",
      title: t("Platform publishing access required"),
      message: t(
        "Check the available operations in Accounts and complete the publishing access the platform requires.",
      ),
    };
  if (
    value.startsWith("A pool campaign was scheduled elsewhere.") ||
    value.startsWith("A pool campaign is already scheduled or dispatched.")
  )
    return {
      status: "review",
      kind: "warning",
      title: t("Content is used in another publication"),
      message: t(
        "Check the existing publication in History. Pick new, unpublished campaigns for the pool so the same content is not sent again.",
      ),
    };
  if (
    value.startsWith("Publication did not complete.") ||
    value.startsWith("Resolve the existing publication outcome") ||
    value === "Send outcome requires review."
  )
    return {
      status: "review",
      kind: "warning",
      title: t("Publication outcome needs review"),
      message: t(
        "Check the latest publication outcome in History. Do not resend the same content before the outcome is settled; re-enable the plan after any needed fix.",
      ),
    };
  return {
    status: "review",
    kind: "warning",
    title: t("Plan needs attention"),
    message: t(
      "Check the account connection, publishing permissions and the latest outcome in History, then review the plan again.",
    ),
    technicalDetail: value,
  };
}

/** Host limits of `plans.suggest` (mirrored for the disabled reasons; the Host owns enforcement). */
export const PLAN_SUGGEST_POOL_MAX = 50;
export const PLAN_SUGGEST_INSTRUCTIONS_MAX = 2000;

export type PlanStepId = "content" | "schedule" | "review";
export const PLAN_STEP_IDS: readonly PlanStepId[] = ["content", "schedule", "review"];

/** Where the owner fixes a blocker. The dialog only offers actions it can really perform. */
export type PlanFixAction = "content" | "accounts" | "settings";
export type PlanBlocker = { id: string; text: string; fix?: PlanFixAction };

/** Reasons the first step cannot continue: each one would make the plan unsavable. */
export function planContentBlockers(input: {
  name: string;
  accountCount: number;
  accountFound: boolean;
  projectId: string;
  availableCampaignIds: readonly string[];
  campaignIds: readonly string[];
}): PlanBlocker[] {
  const blockers: PlanBlocker[] = [];
  if (!input.accountCount)
    blockers.push({ id: "no-account", text: t("Connect an account first."), fix: "accounts" });
  else if (!input.accountFound)
    blockers.push({ id: "choose-account", text: t("Choose a sharing account.") });
  if (!input.projectId) blockers.push({ id: "choose-project", text: t("Choose a project.") });
  if (!input.name.trim()) blockers.push({ id: "name", text: t("Enter a plan name.") });
  if (input.accountFound && input.projectId) {
    if (!input.availableCampaignIds.length)
      blockers.push({
        id: "no-campaigns",
        text: t(
          "There are no campaigns for this account and project. Prepare content in Campaigns and approve it for publishing.",
        ),
        fix: "content",
      });
    else if (!input.campaignIds.length)
      blockers.push({
        id: "empty-pool",
        text: t("Select at least one campaign for the content pool."),
      });
    else if (input.campaignIds.some((id) => !input.availableCampaignIds.includes(id)))
      blockers.push({
        id: "stale-pool",
        text: t(
          "Some selected campaigns are not available for this account and project. Reselect the content pool.",
        ),
      });
  }
  return blockers;
}

/**
 * Things that do not stop a paused plan from being saved but will stop it from being enabled.
 * They are shown where the owner can fix them, never as a reason to block Next.
 */
export function planContentWarnings(input: {
  accountFound: boolean;
  publishGranted: boolean;
  campaignIds: readonly string[];
  approvedCampaignIds?: readonly string[];
}): PlanBlocker[] {
  const warnings: PlanBlocker[] = [];
  if (input.accountFound && !input.publishGranted)
    warnings.push({
      id: "grant",
      text: t(
        "This account has no publishing permission for this project. The plan can be saved paused, but it cannot be enabled until you grant it in Accounts.",
      ),
      fix: "accounts",
    });
  const unapproved = input.campaignIds.filter((id) => !input.approvedCampaignIds?.includes(id));
  if (unapproved.length)
    warnings.push({
      id: "approval",
      text: t(
        "{p0} of {p1} campaigns are not approved for publishing. Approve them in Campaigns before enabling the plan.",
        { p0: unapproved.length, p1: input.campaignIds.length },
      ),
      fix: "content",
    });
  return warnings;
}

export type PlanAgentState = "checking" | "ready" | "missing" | "unknown";

/** Why "Ask AI to suggest a plan" is unavailable right now; empty when it can be asked. */
export function planSuggestBlockedReason(input: {
  hostOnline: boolean;
  accountFound: boolean;
  projectId: string;
  publishGranted: boolean;
  agent: PlanAgentState;
  eligibleCount: number;
  narrowedCount: number;
}): string {
  if (!input.hostOnline) return t("The computer is offline.");
  if (!input.accountFound) return t("Choose a sharing account first.");
  if (!input.projectId) return t("Choose a project first.");
  if (!input.publishGranted)
    return t("Grant publishing permission for this project in Accounts first.");
  if (input.agent === "missing") return t("Choose a text agent in Settings first.");
  if (!input.eligibleCount)
    return t("Create an active campaign for this account and project first.");
  const pool = input.narrowedCount || input.eligibleCount;
  if (pool > PLAN_SUGGEST_POOL_MAX)
    return t("Choose at most {p0} campaigns for the suggestion.", { p0: PLAN_SUGGEST_POOL_MAX });
  return "";
}

/** Moves one pool entry; entries before `lockedPrefix` (already published) never move or get passed. */
export function movePoolEntry(
  ids: readonly string[],
  index: number,
  delta: -1 | 1,
  lockedPrefix = 0,
): string[] {
  const target = index + delta;
  if (index < lockedPrefix || target < lockedPrefix || target < 0 || target >= ids.length)
    return [...ids];
  const next = [...ids];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
