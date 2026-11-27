import { describe, expect, it } from "vitest";
import { crewAssignments, epicTasks, isSubordinateTask } from "./taskRelatedWork";

const task = (id: string, extra: Record<string, string> = {}) => ({
  id,
  machineId: "m",
  ...extra,
});

describe("related work", () => {
  it("keeps epic tasks and crew assignments out of the main list", () => {
    const parent = task("crew-1", { crewExecutionId: "run" });
    const all = [
      task("plain"),
      parent,
      task("assignment", { crewRunId: "run" }),
      task("planned", { goalId: "g" }),
      task("orphan", { crewRunId: "gone" }),
    ];
    const rows = all.filter((entry) => !isSubordinateTask(entry, all)).map((entry) => entry.id);
    expect(rows).toEqual(["plain", "crew-1", "orphan"]);
  });

  it("does not match a crew task of another machine", () => {
    const all = [
      task("a", { crewExecutionId: "run" }),
      { id: "b", machineId: "other", crewRunId: "run" },
    ];
    expect(isSubordinateTask(all[1]!, all)).toBe(false);
    expect(crewAssignments(all[0]!, all)).toEqual([]);
  });

  it("lists a crew task's assignments and an epic's tasks in order", () => {
    const all = [task("x", { crewRunId: "r" }), task("p", { crewExecutionId: "r" }), task("y")];
    expect(crewAssignments(all[1]!, all).map((entry) => entry.id)).toEqual(["x"]);
    expect(
      epicTasks({ machineId: "m", taskIds: ["y", "gone", "x"] }, all).map((entry) => entry.id),
    ).toEqual(["y", "x"]);
  });
});
