import { afterEach, expect, it, vi } from "vitest";
import { executeRemoteJiraBoard } from "./jiraMobileBridge";
const state = vi.hoisted(() => ({
  invoke: vi.fn(),
  allowed: [7],
  hidden: [] as string[],
  projects: [{ id: "1" }, { id: "2" }],
  changeDuringProjects: false,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: state.invoke }));
vi.mock("./jira", () => ({
  loadAllowedJiraBoardIds: () => state.allowed,
  loadHiddenJiraProjectIds: () => state.hidden,
  listJiraProjects: async () => {
    if (state.changeDuringProjects) state.allowed = [];
    return state.projects;
  },
  jiraProjectIdsForFetch: (projects: { id: string }[], hidden: string[]) =>
    projects.filter((p) => !hidden.includes(p.id)).map((p) => p.id),
}));
afterEach(() => {
  state.allowed = [7];
  state.hidden = [];
  state.changeDuringProjects = false;
  vi.resetAllMocks();
});
it("uses desktop visibility owners instead of caller filters and preserves exact scope", async () => {
  state.hidden = ["2"];
  await executeRemoteJiraBoard({
    action: "jira-board-read",
    cwd: "/project",
    boardId: 7,
    scope: "sprint",
    sprintId: 3,
    pageToken: "next",
  });
  expect(state.invoke).toHaveBeenCalledExactlyOnceWith("jira_mobile_board_read", {
    cwd: "/project",
    filters: { allowedBoardIds: [7], projectIds: ["1"] },
    boardId: 7,
    scope: { scope: "sprint", sprintId: 3, pageToken: "next" },
  });
  await expect(
    executeRemoteJiraBoard({
      action: "jira-board-read",
      cwd: "/project",
      boardId: 8,
      scope: "board",
    }),
  ).rejects.toThrow(/Enable/);
  expect(state.invoke).toHaveBeenCalledTimes(1);
});
it("routes new mutations only to native approval with the original host deadline", async () => {
  const operation = {
    action: "jira-board-transition" as const,
    cwd: "/project",
    snapshotId: "native-snapshot",
    key: "ENG-7",
    transitionId: "4",
  };
  await expect(executeRemoteJiraBoard(operation)).rejects.toThrow(/deadline/);
  expect(state.invoke).not.toHaveBeenCalled();
  const approvalId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  state.invoke
    .mockResolvedValueOnce({ outcome: "approved", approvalId })
    .mockResolvedValueOnce({ outcome: "submitted" });
  const deadline = Date.now() + 60000;
  await executeRemoteJiraBoard(operation, deadline);
  expect(state.invoke).toHaveBeenNthCalledWith(1, "jira_mobile_board_prepare", {
    cwd: "/project",
    filters: { allowedBoardIds: [7], projectIds: null },
    snapshotId: "native-snapshot",
    mutation: { action: "transition", key: "ENG-7", transitionId: "4" },
    deadline,
  });
  expect(state.invoke).toHaveBeenNthCalledWith(2, "jira_mobile_board_commit", {
    approvalId,
    filters: { allowedBoardIds: [7], projectIds: null },
  });
});
it("reloads visibility after native approval and never commits stale pre-dialog filters", async () => {
  const approvalId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  state.invoke
    .mockImplementationOnce(async () => {
      state.allowed = [];
      state.hidden = ["2"];
      return { outcome: "approved", approvalId };
    })
    .mockResolvedValueOnce({ outcome: "not-submitted", reason: "Visibility changed" });
  await expect(
    executeRemoteJiraBoard(
      {
        action: "jira-board-transition",
        cwd: "/project",
        snapshotId: "snapshot",
        key: "ENG-7",
        transitionId: "4",
      },
      Date.now() + 60000,
    ),
  ).resolves.toEqual({ outcome: "not-submitted", reason: "Visibility changed" });
  expect(state.invoke).toHaveBeenNthCalledWith(2, "jira_mobile_board_commit", {
    approvalId,
    filters: { allowedBoardIds: [], projectIds: ["1"] },
  });
  expect(state.invoke.mock.calls.some(([command]) => command === "jira_mobile_board_write")).toBe(
    false,
  );
});
it("detects preference changes while project visibility is being resolved", async () => {
  state.hidden = ["2"];
  state.changeDuringProjects = true;
  await expect(executeRemoteJiraBoard({ action: "jira-boards", cwd: "/project" })).rejects.toThrow(
    /visibility changed/,
  );
  expect(state.invoke).not.toHaveBeenCalled();
});
