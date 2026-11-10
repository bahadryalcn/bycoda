import { describe, expect, it } from "vitest";
import {
  ACTIVE_CREW_BUSY_POLL_MS,
  ACTIVE_CREW_IDLE_POLL_MS,
  activeCrewPollInterval,
  mergeActiveCrewMembers,
  type ActiveCrewMember,
} from "./crewActive";

const member = (runId: string) =>
  ({ runId, memberId: "m", kind: "worker" }) as unknown as ActiveCrewMember;

describe("active crew members client", () => {
  it("polls fast only while someone is working", () => {
    expect(activeCrewPollInterval(undefined)).toBe(ACTIVE_CREW_IDLE_POLL_MS);
    expect(activeCrewPollInterval([])).toBe(ACTIVE_CREW_IDLE_POLL_MS);
    expect(activeCrewPollInterval([member("r")])).toBe(ACTIVE_CREW_BUSY_POLL_MS);
  });
  it("merges hosts, tags machines and keeps truncation", () => {
    const merged = mergeActiveCrewMembers([
      { machineId: "a", result: { items: [member("r1")] } },
      { machineId: "b", result: { items: [member("r2")], truncated: true } },
    ]);
    expect(merged.items.map((i) => [i.machineId, i.runId])).toEqual([
      ["a", "r1"],
      ["b", "r2"],
    ]);
    expect(merged.truncated).toBe(true);
  });
});
