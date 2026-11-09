import {
  emptyMinutes,
  encodeMinutes,
  setMinute,
  type ActivityDay,
} from "@bycoda/account-contracts/activity";
import { describe, expect, it } from "vitest";
import type { RemoteMachine } from "../../connections/model/protocol";
import {
  combineMachineDays,
  loadCombinedActivity,
  machineRefs,
  type MachineRef,
} from "./machineActivity";

const day = (date: string, minutes: number[]): ActivityDay => {
  const map = emptyMinutes();
  for (const minute of minutes) setMinute(map, minute);
  return { date, timeZone: "UTC", deviceId: "local", minutes: encodeMinutes(map) };
};
const TODAY = "2026-11-08";
const here: MachineRef = { id: "m_here", name: "This computer", local: true };
const other: MachineRef = { id: "m_other", name: "Studio", local: false };

describe("combineMachineDays", () => {
  it("unions the same minute across machines and keeps per-machine totals", () => {
    const result = combineMachineDays(
      [
        { machine: here, days: [day(TODAY, [1, 2, 3])] },
        { machine: other, days: [day(TODAY, [3, 4])] },
      ],
      TODAY,
      "UTC",
    );
    expect(result.summary.today).toBe(4);
    expect(result.summary.perDevice).toBeUndefined();
    expect(result.machines.map((machine) => machine.totals?.today)).toEqual([3, 2]);
  });

  it("lists an unreachable machine as unavailable and still counts the others", () => {
    const result = combineMachineDays(
      [
        { machine: here, days: [day(TODAY, [1])] },
        { machine: other, days: null },
      ],
      TODAY,
      "UTC",
    );
    expect(result.summary.today).toBe(1);
    expect(result.machines[1]).toMatchObject({ id: "m_other", status: "unavailable" });
    expect(result.machines[1]?.totals).toBeUndefined();
  });

  it("sums distinct days across machines for week, month and year", () => {
    const result = combineMachineDays(
      [
        { machine: here, days: [day(TODAY, [1, 2]), day("2026-11-03", [9])] },
        { machine: other, days: [day(TODAY, [2, 3])] },
      ],
      TODAY,
      "UTC",
    );
    expect(result.summary).toMatchObject({ today: 3, week: 4, month: 4, year: 4 });
  });
});

describe("loadCombinedActivity", () => {
  it("never blocks on a failing machine and asks each for this year and the last week", async () => {
    const ranges: Record<string, { from: string; to: string }> = {};
    const result = await loadCombinedActivity([here, other], TODAY, "UTC", async (id, range) => {
      ranges[id] = range;
      if (id === "m_other") throw new Error("offline");
      return [day(TODAY, [5])];
    });
    expect(result.summary.today).toBe(1);
    expect(result.machines.map((machine) => machine.status)).toEqual(["ok", "unavailable"]);
    expect(ranges.m_here).toEqual({ from: "2026-01-01", to: TODAY });
    const early = await loadCombinedActivity([here], "2026-01-03", "UTC", async (_, range) => {
      expect(range).toEqual({ from: "2025-12-28", to: "2026-01-03" });
      return [];
    });
    expect(early.summary.today).toBe(0);
  });
});

describe("machineRefs", () => {
  const machine = (id: string, environmentId: string, extra: Partial<RemoteMachine> = {}) =>
    ({ id, name: id, endpoint: "http://10.0.0.2:1", environmentId, ...extra }) as RemoteMachine;
  it("puts this computer first and lists one Host reached twice once", () => {
    const refs = machineRefs([
      machine("a", "env_a"),
      machine("b", "env_b", { endpoint: "http://127.0.0.1:9", localHost: true }),
      machine("c", "env_a"),
    ]);
    expect(refs.map((ref) => [ref.id, ref.local])).toEqual([
      ["b", true],
      ["a", false],
    ]);
  });
});
