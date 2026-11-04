import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NO_LIMITS,
  PREVIOUS_RUN_SKIP,
  automationLimits,
  dailyRunLimitSkip,
  previousRunSkip,
  runLimitBreach,
} from "./automationLimits";
import { monotonicNow } from "../../../shared/lib/time/timestamps";

const at = (value: string) => new Date(value).getTime();

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("automation limits", () => {
  it("measures the time limit on the monotonic clock, ignoring a wall-clock jump", () => {
    const limits = { ...NO_LIMITS, maxRunMinutes: 30 };
    let monotonic = 1_000;
    vi.spyOn(performance, "now").mockImplementation(() => monotonic);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(at("2026-10-03T10:00:00"));
    const startedAt = monotonicNow();
    // The laptop sleeps for three hours: wall time jumps, the run did not progress.
    vi.setSystemTime(at("2026-10-03T13:00:00"));
    monotonic += 10 * 60_000;
    expect(runLimitBreach(limits, { startedAt })).toBeNull();
    monotonic += 20 * 60_000;
    expect(runLimitBreach(limits, { startedAt })).toBe(
      "Stopped: reached the 30-minute time limit.",
    );
    // A monotonic reading never counts a negative elapsed time against a run.
    expect(runLimitBreach(limits, { startedAt: monotonic + 60_000 })).toBeNull();
  });

  it("holds a claimed run while an earlier run of the automation is still going", () => {
    const runs = [
      { id: "new", status: "pending" as const },
      { id: "earlier", status: "running" as const },
      { id: "done", status: "succeeded" as const },
    ];
    expect(previousRunSkip(runs, "new")).toBe(PREVIOUS_RUN_SKIP);
    expect(previousRunSkip(runs, "earlier")).toBeNull();
    expect(previousRunSkip(runs.slice(2), "new")).toBeNull();
    expect(previousRunSkip([], "new")).toBeNull();
  });

  it("treats missing, negative and non-finite values as off", () => {
    expect(automationLimits({})).toEqual(NO_LIMITS);
    expect(automationLimits({ maxRunMinutes: -5, maxRunsPerDay: Number.NaN })).toEqual(NO_LIMITS);
    expect(automationLimits({ maxRunMinutes: 30, maxRunsPerDay: 2.9 })).toEqual({
      maxRunMinutes: 30,
      maxRunsPerDay: 2,
    });
  });

  it("stops a run at its time limit", () => {
    const limits = { ...NO_LIMITS, maxRunMinutes: 30 };
    const startedAt = at("2026-10-03T10:00:00");
    expect(runLimitBreach(limits, { startedAt, now: at("2026-10-03T10:29:59") })).toBeNull();
    expect(runLimitBreach(limits, { startedAt, now: at("2026-10-03T10:30:00") })).toBe(
      "Stopped: reached the 30-minute time limit.",
    );
    expect(runLimitBreach(NO_LIMITS, { startedAt, now: at("2026-10-04T10:00:00") })).toBeNull();
  });

  it("names whole-hour time limits in hours", () => {
    expect(
      runLimitBreach({ ...NO_LIMITS, maxRunMinutes: 120 }, { startedAt: 0, now: 120 * 60_000 }),
    ).toBe("Stopped: reached the 2-hour time limit.");
  });

  it("skips a run once today's allowance is used", () => {
    const limits = { ...NO_LIMITS, maxRunsPerDay: 2 };
    const now = at("2026-10-03T15:00:00");
    const runs = [
      { id: "new", status: "pending" as const },
      {
        id: "a",
        status: "succeeded" as const,
        startedAt: at("2026-10-03T09:00:00"),
      },
      {
        id: "b",
        status: "failed" as const,
        startedAt: at("2026-10-03T12:00:00"),
      },
    ];
    expect(dailyRunLimitSkip(limits, runs, "new", now)).toBe(
      "Skipped: reached the limit of 2 runs per day.",
    );
    expect(dailyRunLimitSkip(limits, runs.slice(0, 2), "new", now)).toBeNull();
  });

  it("does not count yesterday's runs, skipped runs or the run itself", () => {
    const limits = { ...NO_LIMITS, maxRunsPerDay: 1 };
    const now = at("2026-10-03T15:00:00");
    expect(
      dailyRunLimitSkip(
        limits,
        [
          {
            id: "new",
            status: "running",
            startedAt: at("2026-10-03T14:59:00"),
          },
          {
            id: "old",
            status: "succeeded",
            startedAt: at("2026-10-02T23:59:00"),
          },
          {
            id: "skipped",
            status: "skipped",
            startedAt: at("2026-10-03T08:00:00"),
          },
        ],
        "new",
        now,
      ),
    ).toBeNull();
    expect(dailyRunLimitSkip(NO_LIMITS, [], "new", now)).toBeNull();
  });
});
