import { describe, expect, it } from "vitest";
import type { ActiveCrewMemberView } from "./crewActive";
import {
  activeElapsedMs,
  activeMemberFocus,
  activeMemberWorking,
  groupActiveByProject,
} from "./crewActiveView";

const item = (over: Partial<ActiveCrewMemberView>): ActiveCrewMemberView => ({
  runId: "r",
  projectId: "p",
  definitionId: "d",
  definitionName: "Crew",
  runStatus: "active",
  memberId: "m",
  memberName: "Mia",
  memberRole: "specialist",
  kind: "worker",
  machineId: "host",
  ...over,
});

describe("active crew view", () => {
  it("groups by project with the current one first, then by name", () => {
    const groups = groupActiveByProject(
      [
        item({ projectId: "b", projectName: "Beta" }),
        item({ projectId: "a", projectName: "Alpha" }),
        item({ projectId: "z", projectName: "Zed" }),
      ],
      "host:z",
    );
    expect(groups.map((g) => g.name)).toEqual(["Zed", "Alpha", "Beta"]);
  });

  it("keeps the same project id on two machines apart", () => {
    const groups = groupActiveByProject([item({ machineId: "a" }), item({ machineId: "b" })]);
    expect(groups).toHaveLength(2);
  });

  it("puts attention first, then the longest running", () => {
    const [group] = groupActiveByProject([
      item({ memberName: "Late", startedAt: 300 }),
      item({ memberName: "Early", startedAt: 100 }),
      item({ memberName: "Blocked", attention: "blocked", startedAt: 200 }),
      item({ memberName: "Decide", attention: "decision", startedAt: 400 }),
      item({ memberName: "NoTime" }),
    ]);
    expect(group?.items.map((i) => i.memberName)).toEqual([
      "Decide",
      "Blocked",
      "Early",
      "Late",
      "NoTime",
    ]);
  });

  it("measures elapsed time and tolerates a missing or future start", () => {
    expect(activeElapsedMs(undefined, 5000)).toBeNull();
    expect(activeElapsedMs(1000, 4500)).toBe(3500);
    expect(activeElapsedMs(9000, 4500)).toBe(0);
  });

  it("blinks only running coordinators and workers", () => {
    expect(activeMemberWorking(item({}))).toBe(true);
    expect(activeMemberWorking(item({ kind: "coordinator" }))).toBe(true);
    expect(activeMemberWorking(item({ kind: "review" }))).toBe(false);
    expect(activeMemberWorking(item({ runStatus: "paused" }))).toBe(false);
  });

  it("names the focus from task, run, then crew", () => {
    expect(activeMemberFocus(item({ taskTitle: "Fix", runTitle: "Run" }))).toBe("Fix");
    expect(activeMemberFocus(item({ runTitle: "Run" }))).toBe("Run");
    expect(activeMemberFocus(item({}))).toBe("Crew");
  });
});
