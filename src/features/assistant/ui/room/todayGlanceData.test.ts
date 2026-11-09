import { expect, it } from "vitest";
import {
  activityPerDay,
  assistantJobCounts,
  jobStatusCounts,
  updatesSince,
} from "./todayGlanceData";

const noon = new Date(2026, 10, 8, 12).getTime();
const dayStart = new Date(2026, 10, 8).getTime();

it("counts waiting, working and done-today jobs", () => {
  const jobs = [
    { status: "waiting", updatedAt: 1 },
    { status: "running", updatedAt: 1 },
    { status: "planning", updatedAt: 1 },
    { status: "stalled", updatedAt: 1 },
    { status: "queued", updatedAt: 1 },
    { status: "done", updatedAt: dayStart + 5 },
    { status: "done", updatedAt: dayStart - 5 },
  ] as const;
  expect(assistantJobCounts(jobs, dayStart)).toEqual({ waiting: 1, working: 3, doneToday: 1 });
});

it("counts updates since the start of the day", () => {
  expect(updatesSince([{ createdAt: dayStart }, { createdAt: dayStart - 1 }], dayStart)).toBe(1);
});

it("buckets activity into the last seven local days, oldest first", () => {
  const day = 86_400_000;
  const days = activityPerDay(
    [
      { createdAt: noon },
      { createdAt: noon - 1000 },
      { createdAt: noon - day },
      { createdAt: noon - 6 * day },
      { createdAt: noon - 7 * day },
    ],
    noon,
  );
  expect(days.map((entry) => entry.key)).toEqual([
    "2026-11-02",
    "2026-11-03",
    "2026-11-04",
    "2026-11-05",
    "2026-11-06",
    "2026-11-07",
    "2026-11-08",
  ]);
  expect(days.map((entry) => entry.count)).toEqual([1, 0, 0, 0, 0, 1, 2]);
});

it("lists job statuses in a stable order without empty ones", () => {
  expect(jobStatusCounts([{ status: "done" }, { status: "waiting" }, { status: "done" }])).toEqual([
    { status: "waiting", count: 1 },
    { status: "done", count: 2 },
  ]);
  expect(jobStatusCounts([])).toEqual([]);
});
