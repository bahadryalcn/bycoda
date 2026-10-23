import { getLocale, t } from "../../../shared/i18n";
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
    new Intl.DateTimeFormat(getLocale(), { timeZone }).format(0);
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
    return new Intl.DateTimeFormat(getLocale(), {
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
