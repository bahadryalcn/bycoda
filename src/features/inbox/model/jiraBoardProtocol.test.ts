import { expect, it } from "vitest";
import { parseRemoteInboxOperation, inboxOperationWrites, nativeInboxCommand } from "./remoteInbox";
import { parseRemoteJiraOperation } from "./jiraBoardProtocol";
const projects = [{ id: "project", cwd: "/project" }];
const snapshotId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
it("derives the owning project and accepts only finite scoped Jira actions", () => {
  expect(
    parseRemoteInboxOperation(
      { action: "jira-board-read", projectId: "project", boardId: 7, scope: "sprint", sprintId: 2 },
      projects,
    ),
  ).toEqual({
    action: "jira-board-read",
    cwd: "/project",
    boardId: 7,
    scope: "sprint",
    sprintId: 2,
  });
  expect(() => parseRemoteInboxOperation({ action: "jira-boards" }, projects)).toThrow(
    /owning project/,
  );
  expect(() =>
    parseRemoteInboxOperation({ action: "jira-boards", projectId: "other" }, projects),
  ).toThrow(/belong/);
  for (const extra of [
    { cwd: "/foreign" },
    { approved: true },
    { site: "https://foreign.invalid" },
    { command: "jira_set_config" },
  ])
    expect(() =>
      parseRemoteInboxOperation(
        { action: "jira-boards", projectId: "project", ...extra },
        projects,
      ),
    ).toThrow(/Unexpected/);
  expect(
    parseRemoteInboxOperation(
      { action: "jira-boards", projectId: "project", requestId: "transport-id" },
      projects,
    ),
  ).toEqual({ action: "jira-boards", cwd: "/project" });
  for (const input of [
    { action: "jira-board-read", boardId: 7, scope: "sprint" },
    { action: "jira-board-read", boardId: -1, scope: "board" },
    { action: "jira-board-read", boardId: 7, scope: "board", sprintId: 3 },
    { action: "jira-board-transition", snapshotId, key: "../../x", transitionId: "7" },
  ])
    expect(() => parseRemoteJiraOperation(input, "/project")).toThrow();
});
it("marks only mutations as writes and refuses hidden rank/combinedmove options", () => {
  const move = parseRemoteJiraOperation(
    { action: "jira-board-move", snapshotId, key: "ENG-7", target: "rank", beforeKey: "ENG-8" },
    "/project",
  );
  expect(inboxOperationWrites(move)).toBe(true);
  expect(
    inboxOperationWrites(
      parseRemoteJiraOperation(
        { action: "jira-issue-transitions", snapshotId, key: "ENG-7" },
        "/project",
      ),
    ),
  ).toBe(false);
  expect(() => nativeInboxCommand(move)).toThrow(/scoped desktop board owner/);
  for (const extra of [
    { target: "rank", beforeKey: "ENG-7" },
    { target: "rank" },
    { target: "rank", beforeKey: "ENG-8", afterKey: "ENG-9" },
    { target: "sprint", sprintId: 2, beforeKey: "ENG-8" },
  ])
    expect(() =>
      parseRemoteJiraOperation(
        { action: "jira-board-move", snapshotId, key: "ENG-7", ...extra },
        "/project",
      ),
    ).toThrow();
});
