// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  columnTransitions,
  jiraBoardIssues,
  jiraMoveIssue,
  jiraTransitionIssue,
  rankAnchor,
  listJiraBoards,
  type JiraBoardIssue,
} from "./jiraBoard";
import { saveAllowedJiraBoardIds, saveHiddenJiraProjectIds } from "./jira";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
beforeEach(() => {
  localStorage.clear();
  vi.mocked(invoke).mockReset();
});
it("scopes the board roster and its cards to selected projects and boards", async () => {
  saveAllowedJiraBoardIds([7]);
  saveHiddenJiraProjectIds(["2"]);
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "jira_list_projects")
      return [
        { id: "1", key: "ENG", name: "Engineering" },
        { id: "2", key: "OPS", name: "Operations" },
      ];
    if (command === "jira_list_boards")
      return [
        { id: 7, name: "Engineering", kind: "scrum" },
        { id: 8, name: "Other", kind: "kanban" },
      ];
    return { issues: [{ teamId: "1" }, { teamId: "2" }], nextPageToken: "next" };
  });
  expect(await listJiraBoards()).toEqual([{ id: 7, name: "Engineering", kind: "scrum" }]);
  expect(invoke).toHaveBeenCalledWith("jira_list_boards", { projectIds: ["1"] });
  expect(await jiraBoardIssues(7, { scope: "board" })).toEqual({
    issues: [{ teamId: "1" }],
    nextPageToken: "next",
  });
  expect(invoke).toHaveBeenCalledWith(
    "jira_board_issues",
    expect.objectContaining({ projectIds: ["1"] }),
  );
});
it("keeps board, sprint, cursor and mutation identities in the native contract", async () => {
  vi.mocked(invoke).mockResolvedValue({ issues: [], nextPageToken: null });
  await jiraBoardIssues(7, { scope: "sprint", sprintId: 21 }, "cursor&2");
  expect(invoke).toHaveBeenCalledWith("jira_board_issues", {
    boardId: 7,
    scope: "sprint",
    sprintId: 21,
    nextPageToken: "cursor&2",
    projectIds: null,
  });
  await jiraMoveIssue(7, "ENG-2", { target: "sprint", sprintId: 21, beforeKey: "ENG-3" });
  expect(invoke).toHaveBeenCalledWith("jira_board_move", {
    boardId: 7,
    key: "ENG-2",
    target: "sprint",
    sprintId: 21,
    beforeKey: "ENG-3",
    afterKey: null,
  });
  await jiraTransitionIssue("ENG-2", "31");
  expect(invoke).toHaveBeenCalledWith("jira_issue_transition", {
    key: "ENG-2",
    transitionId: "31",
  });
});
it("matches column status IDs rather than duplicate status names", () => {
  const transition = { id: "31", name: "Done", statusId: "7", requiresFields: false };
  expect(
    columnTransitions([transition, { ...transition, id: "32", statusId: "8" }], {
      name: "Done",
      statusIds: ["7"],
    }),
  ).toEqual([transition]);
});
it("uses the destination's last issue or an explicit before anchor without self ranking", () => {
  const issues = ["ENG-1", "ENG-2"].map((identifier) => ({ identifier }) as JiraBoardIssue);
  expect(rankAnchor(issues, "ENG-1")).toEqual({ afterKey: "ENG-2" });
  expect(rankAnchor(issues, "ENG-2", "ENG-1")).toEqual({ beforeKey: "ENG-1" });
  expect(rankAnchor(issues.slice(0, 1), "ENG-1")).toEqual({});
});
