import { describe, expect, it } from "vitest";
import type { CrewRunView } from "./crewClient";
import {
  crewActivityKnown,
  crewCanStop,
  crewHasRunningWork,
  crewWorkStatus,
} from "./crewPresentation";

function run(overrides: Partial<CrewRunView> = {}): CrewRunView {
  return {
    status: "paused",
    coordinatorStatus: "idle",
    tasks: [],
    messages: [],
    ...overrides,
  } as CrewRunView;
}

describe("crew work controls", () => {
  it("does not interpret missing activity from an older host as a completed stop", () => {
    const legacy = run({ coordinatorSessionId: "lead", coordinatorStatus: undefined });
    expect(crewActivityKnown(legacy)).toBe(false);
    expect(crewCanStop(legacy)).toBe(true);
  });
  it("does not offer another stop for paused, idle planning work", () => {
    expect(crewCanStop(run())).toBe(false);
    expect(crewHasRunningWork(run())).toBe(false);
    expect(crewWorkStatus(run())).toBe("paused");
  });

  it("keeps stop available after pausing assignments while the coordinator runs", () => {
    const paused = run({ coordinatorStatus: "running" });
    expect(crewCanStop(paused)).toBe(true);
    expect(crewHasRunningWork(paused)).toBe(true);
    expect(crewWorkStatus(paused)).toBe("paused");
  });

  it.each(["queued", "running", "verifying"] as const)(
    "can stop a paused %s assignment",
    (status) => {
      const paused = run({ tasks: [{ status } as CrewRunView["tasks"][number]] });
      expect(crewCanStop(paused)).toBe(true);
      expect(crewHasRunningWork(paused)).toBe(status !== "queued");
    },
  );

  it("can pause active scheduling even while no conversation is running", () => {
    expect(crewCanStop(run({ status: "active" }))).toBe(true);
  });

  it("keeps finished work immutable", () => {
    expect(crewCanStop(run({ status: "finished" }))).toBe(false);
  });
});
