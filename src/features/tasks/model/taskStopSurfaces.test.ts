import { describe, expect, it } from "vitest";
import type { BoardTask } from "./taskClient";
import { buildDailySummary } from "./dailySummary";
import { taskStatusLine } from "./taskStatusLine";
import {
  backgroundSnapshot,
  backgroundTransitions,
  emptyBackgroundSnapshot,
} from "./taskTransitions";
import {
  TASK_STOP_CODES,
  TASK_WAIT_CODES,
  buildTaskStop,
} from "../../../shared/model/host-contracts/task-stop";
import { taskStopSummary, taskStopText } from "../../../shared/model/taskStopSummary";

const task = (overrides: Partial<BoardTask>): BoardTask => ({
  id: "t",
  title: "Ship",
  prompt: "Do it",
  projectId: "p",
  harness: "claude",
  model: "claude:test",
  modelSettings: {},
  runtimeMode: "auto",
  maxRunMinutes: 0,
  status: "running",
  createdAt: 1,
  updatedAt: 1500,
  machineId: "m",
  machineName: "Mac",
  cwd: "/work/app",
  ...overrides,
});

describe("one stop summary for every surface", () => {
  it.each(TASK_STOP_CODES)(
    "%s reads the same on the card, in notifications and in the daily summary",
    (code) => {
      const blocked = task({
        status: "blocked",
        stop: buildTaskStop({ code, message: "Because." }, 1),
      });
      const summary = taskStopSummary(blocked)!;
      // Card, list and detail header.
      expect(taskStatusLine(blocked)).toMatchObject({
        label: summary.title,
        detail: summary.reason,
      });
      // Notification: the poll after the task blocked.
      const messages = backgroundTransitions(
        backgroundSnapshot([task({ status: "running" })], []),
        backgroundSnapshot([blocked], []),
      )
        .map((entry) => entry.message)
        .filter((message) => message.startsWith("Blocked:"));
      expect(messages).toEqual([`Blocked: Ship — ${taskStopText(blocked)}`]);
      // Daily summary.
      const daily = buildDailySummary({
        since: 1000,
        now: 2000,
        tasks: [blocked],
        goals: [],
        usageByMachine: [],
        unreachable: [],
        outdated: [],
      });
      expect(daily.blocked[0].detail).toBe(taskStopText(blocked));
    },
  );

  it.each(TASK_WAIT_CODES)("%s shows its reason on the card", (code) => {
    const queued = task({ status: "queued", wait: { code, message: "Because." } });
    const summary = taskStopSummary(queued)!;
    expect(taskStatusLine(queued)).toMatchObject({
      kind: "waiting",
      label: summary.title,
      detail: summary.reason,
    });
  });

  it("starts from an empty snapshot without announcing a block it never saw", () => {
    expect(
      backgroundTransitions(
        emptyBackgroundSnapshot(),
        backgroundSnapshot([task({ status: "blocked" })], []),
      ),
    ).toEqual([]);
  });
});
