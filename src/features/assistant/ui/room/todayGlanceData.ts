import type {
  AssistantActivity,
  AssistantJob,
} from "../../../../shared/model/host-contracts/assistant";

export interface JobCounts {
  waiting: number;
  working: number;
  doneToday: number;
}

/** Job counts shown on Today: waiting for the owner, in flight, and finished since `dayStart`. */
export function assistantJobCounts(
  jobs: ReadonlyArray<Pick<AssistantJob, "status" | "updatedAt">>,
  dayStart: number,
): JobCounts {
  return {
    waiting: jobs.filter((job) => job.status === "waiting").length,
    working: jobs.filter((job) => ["planning", "running", "stalled"].includes(job.status)).length,
    doneToday: jobs.filter((job) => job.status === "done" && job.updatedAt >= dayStart).length,
  };
}

/** Activity entries recorded since `dayStart`. */
export function updatesSince(
  activity: ReadonlyArray<Pick<AssistantActivity, "createdAt">>,
  dayStart: number,
): number {
  return activity.filter((entry) => entry.createdAt >= dayStart).length;
}

export interface ActivityDay {
  /** Local calendar date, `YYYY-MM-DD`. */
  key: string;
  /** Local midnight of that day. */
  start: number;
  count: number;
}

const pad = (value: number) => String(value).padStart(2, "0");

/** Activity entries per local day for the `days` days ending today, oldest first. */
export function activityPerDay(
  activity: ReadonlyArray<Pick<AssistantActivity, "createdAt">>,
  now: number,
  days = 7,
): ActivityDay[] {
  const today = new Date(now);
  const starts = Array.from({ length: days + 1 }, (_, index) =>
    new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1) + index).getTime(),
  );
  return starts.slice(0, days).map((start, index) => {
    const date = new Date(start);
    return {
      key: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
      start,
      count: activity.filter(
        (entry) => entry.createdAt >= start && entry.createdAt < starts[index + 1]!,
      ).length,
    };
  });
}

const STATUS_ORDER: AssistantJob["status"][] = [
  "waiting",
  "running",
  "planning",
  "stalled",
  "queued",
  "paused",
  "done",
  "failed",
  "cancelled",
];

/** Jobs per status in a stable order, without empty statuses. */
export function jobStatusCounts(
  jobs: ReadonlyArray<Pick<AssistantJob, "status">>,
): { status: AssistantJob["status"]; count: number }[] {
  return STATUS_ORDER.map((status) => ({
    status,
    count: jobs.filter((job) => job.status === status).length,
  })).filter((entry) => entry.count > 0);
}
