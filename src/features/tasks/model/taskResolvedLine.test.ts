import { describe, expect, it } from "vitest";
import type { WorkResolved } from "../../../shared/model/host-contracts/work-executor";
import { taskResolvedLine } from "./taskResolvedLine";

const resolved = (patch: Partial<WorkResolved> = {}): WorkResolved => ({
  executor: { kind: "agent" },
  routingSource: { kind: "stored" },
  skipped: [],
  helpers: { mode: "settings", subagents: "auto", source: "default" },
  at: 1,
  ...patch,
});

describe("task resolved line", () => {
  it("is absent until the work started", () => {
    expect(taskResolvedLine(undefined)).toBeUndefined();
  });

  it("names the executor and helpers and keeps the reason apart", () => {
    expect(taskResolvedLine(resolved())).toEqual({
      text: "Single agent · Helpers: automatic",
      why: undefined,
    });
    expect(
      taskResolvedLine(
        resolved({
          executor: { kind: "crew", crewDefinitionId: "c" },
          reason: "A crew fits.",
          helpers: { mode: "off", subagents: "off", source: "task", limited: "Settings won." },
        }),
      ),
    ).toEqual({ text: "Crew · No helpers", why: "A crew fits. Settings won." });
  });
});
