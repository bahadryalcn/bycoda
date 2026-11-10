import { expect, it } from "vitest";
import { workspaceActiveTool } from "./workspaceActiveTool";

const none = {
  crewsOpen: false,
  auxiliaryTool: null,
  automationsViewOpen: false,
  serversViewOpen: false,
  inboxViewOpen: false,
  notesViewOpen: false,
  socialBoardShown: false,
  taskBoardShown: false,
};

it("names the shown tool, with Crews ahead of the servers flag it shares", () => {
  expect(workspaceActiveTool(none)).toBeNull();
  expect(workspaceActiveTool({ ...none, serversViewOpen: true })).toBe("servers");
  expect(workspaceActiveTool({ ...none, serversViewOpen: true, crewsOpen: true })).toBe("crews");
  expect(workspaceActiveTool({ ...none, automationsViewOpen: true })).toBe("automations");
  expect(workspaceActiveTool({ ...none, automationsViewOpen: true, taskBoardShown: true })).toBe(
    "tasks",
  );
  expect(
    workspaceActiveTool({ ...none, automationsViewOpen: true, auxiliaryTool: "terminal" }),
  ).toBe("terminal");
});
