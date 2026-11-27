import { expect, it } from "vitest";
import type { SavedCrewAgent } from "./crew";
import { groupNameTaken, groupUpdateParams } from "./crewGroups";

function agent(id: string, updatedAt: number, groups?: string[]): SavedCrewAgent {
  return { id, updatedAt, groups } as unknown as SavedCrewAgent;
}

const agents = [agent("a", 1, ["UI", "Web"]), agent("b", 2, ["UI"]), agent("c", 3, ["Mobile"])];

// #1156: one atomic call carries the whole membership, so a group is never left split.
it("sends every member of the group with its revision in one call", () => {
  expect(groupUpdateParams(agents, "UI", "Frontend")).toEqual({
    group: "UI",
    rename: "Frontend",
    members: [
      { agentId: "a", expectedUpdatedAt: 1 },
      { agentId: "b", expectedUpdatedAt: 2 },
    ],
  });
});

it("omits rename when the group is removed", () => {
  const params = groupUpdateParams(agents, "Mobile");
  expect(params).toEqual({ group: "Mobile", members: [{ agentId: "c", expectedUpdatedAt: 3 }] });
  expect("rename" in params).toBe(false);
});

it("refuses a rename that would merge into another existing group", () => {
  expect(groupNameTaken(agents, "UI", "Mobile")).toBe(true);
  expect(groupNameTaken(agents, "UI", "Frontend")).toBe(false);
  expect(groupNameTaken(agents, "UI", "UI")).toBe(false);
});
