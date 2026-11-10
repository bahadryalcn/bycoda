import { describe, expect, it } from "vitest";
import {
  AssistantRequestValidationSchema,
  type AssistantQuickAutomationJob,
} from "../../../src/shared/model/host-contracts/assistant";
import {
  assertQuickAutomationSchedule,
  assistantQuickAutomationConfiguration,
} from "./assistant-quick-automations";

const action = {
  kind: "automation" as const,
  projectId: "project",
  name: "Morning check",
  prompt: "Check the build",
  harness: "codex" as const,
  model: "m",
  modelSettings: {},
  runtimeMode: "supervised" as const,
  scheduleKind: "once" as const,
  runAt: new Date("2026-10-06T09:00:00").getTime(),
  minute: 0,
  time: "09:00",
  dayOfWeek: 2,
  maxRunMinutes: 30,
  maxRunsPerDay: 1,
  isolate: false,
  enabled: true,
};
const create = (quickAction: unknown) => ({
  op: "jobs.create",
  kind: "quick",
  title: "Morning",
  request: "Run it tomorrow",
  idempotencyKey: "k",
  quickAction,
});

describe("one-time automations", () => {
  it("require runAt exactly when the schedule is once", () => {
    const parse = (value: unknown) => AssistantRequestValidationSchema.safeParse(create(value));
    expect(parse(action).success).toBe(true);
    expect(parse({ ...action, runAt: undefined }).success).toBe(false);
    expect(parse({ ...action, scheduleKind: "daily" }).success).toBe(false);
    expect(parse({ ...action, scheduleKind: "daily", runAt: undefined }).success).toBe(true);
  });
  it("store as a daily schedule at the local run time", () => {
    const config = assistantQuickAutomationConfiguration({
      id: "job",
      quickAction: action,
    } as unknown as AssistantQuickAutomationJob);
    expect(config).toMatchObject({ scheduleKind: "daily", time: "09:00", minute: 0 });
    expect(config).not.toHaveProperty("runAt");
  });
  it("must be in the future and at most a year away", () => {
    const now = action.runAt - 3_600_000;
    expect(() => assertQuickAutomationSchedule(action, now)).not.toThrow();
    expect(() => assertQuickAutomationSchedule({ runAt: now - 1 }, now)).toThrow("future");
    expect(() => assertQuickAutomationSchedule({ runAt: now + 400 * 86_400_000 }, now)).toThrow(
      "one year",
    );
    expect(() => assertQuickAutomationSchedule({}, now)).not.toThrow();
  });
});
