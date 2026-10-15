import { describe, expect, it } from "vitest";
import { agentClockLabel } from "./AgentClock";

describe("agentClockLabel", () => {
  it("shows the final duration once the run ended, live or not", () => {
    expect(agentClockLabel(1_000, 47_000, false, 0)).toBe("46s");
    expect(agentClockLabel(1_000, 62_000, true, 99_000)).toBe("1m 1s");
  });

  it("counts up while the run is live", () => {
    expect(agentClockLabel(1_000, undefined, true, 13_000)).toBe("12s");
  });

  it("shows nothing for a run restored without an end in an idle session", () => {
    expect(agentClockLabel(1_000, undefined, false, 500_000)).toBeNull();
  });

  it("shows nothing for old runs with no start recorded", () => {
    expect(agentClockLabel(undefined, undefined, true, 5_000)).toBeNull();
    expect(agentClockLabel(undefined, 5_000, false, 5_000)).toBeNull();
  });
});
