// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resetRetainedState } from "../../../shared/hooks/useRetainedState";
import { JiraBoardView } from "./JiraBoardView";
import type { JiraBoardIssue } from "../model/jiraBoard";
import { setLanguagePreference } from "../../../shared/i18n";
import { saveAllowedJiraBoardIds, saveHiddenJiraProjectIds } from "../model/jira";
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
const issue: JiraBoardIssue = {
  provider: "jira",
  kind: "jira",
  id: "1",
  identifier: "ENG-1",
  number: 1,
  title: "Fix login",
  url: "https://acme.atlassian.net/browse/ENG-1",
  state: "Ready",
  statusId: "1",
  stateType: "new",
  updatedAt: "",
  labels: [],
  assignees: [],
  draft: false,
  repo: "ENG",
  teamId: "1",
  teamName: "Engineering",
  projectPath: "",
};
const config = {
  columns: [
    { name: "Ready", statusIds: ["1"] },
    { name: "Working", statusIds: ["3"] },
  ],
  rankFieldId: 10,
  sprints: [
    { id: 21, name: "Sprint 21", state: "active", goal: "Deliver" },
    { id: 22, name: "Sprint 22", state: "future", goal: "" },
  ],
};
let root: Root;
let container: HTMLDivElement;
const changed = vi.fn();
beforeEach(async () => {
  resetRetainedState();
  localStorage.clear();
  saveAllowedJiraBoardIds([7]);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await setLanguagePreference("en");
  changed.mockReset();
  invoke.mockReset();
  invoke.mockImplementation(async (command, args) => {
    if (command === "jira_list_boards") return [{ id: 7, name: "Engineering", kind: "scrum" }];
    if (command === "jira_board_configuration") return config;
    if (command === "jira_board_issues")
      return { issues: args.scope === "sprint" ? [] : [issue], nextPageToken: null };
    if (command === "jira_issue_transitions")
      return [{ id: "31", name: "Start work", statusId: "3", requiresFields: false }];
    return null;
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(JiraBoardView, { revision: 0, onSelect: vi.fn(), onChanged: changed }),
    ),
  );
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  localStorage.clear();
});
async function click(text: string) {
  const button = [...container.querySelectorAll("button")].find((b) => b.textContent === text);
  expect(button).toBeDefined();
  await act(async () => button!.click());
}

it("restores the board mode and search after leaving the board and returning", async () => {
  await click("Backlog & sprints");
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "login");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(JiraBoardView, {
        revision: 0,
        onSelect: vi.fn(),
        onChanged: changed,
      }),
    ),
  );
  expect(container.querySelector<HTMLInputElement>('input[type="search"]')!.value).toBe("login");
  expect(
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Backlog & sprints")!
      .getAttribute("aria-pressed"),
  ).toBe("true");
});
it("requires board permission and clears a revoked board without fetching it again", async () => {
  invoke.mockClear();
  await act(async () => saveAllowedJiraBoardIds([]));
  expect(container.textContent).not.toContain("ENG-1");
  expect(container.textContent).toContain("Select allowed boards in Settings");
  expect(invoke).not.toHaveBeenCalled();
});

it("keeps Kanban issues visible when Jira does not support the board backlog", async () => {
  const previous = invoke.getMockImplementation()!;
  invoke.mockImplementation((command, args) => {
    if (command === "jira_list_boards")
      return Promise.resolve([{ id: 7, name: "Engineering", kind: "kanban" }]);
    if (command === "jira_board_issues" && args.scope === "backlog")
      return Promise.reject("Backlogs are not supported on this board");
    return previous(command, args);
  });
  await click("Refresh");
  await click("Backlog & sprints");
  expect(container.textContent).toContain("ENG-1");
  expect(container.textContent).toContain("Backlog is not enabled for this Jira board");
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("clears issues when every project is excluded", async () => {
  const previous = invoke.getMockImplementation()!;
  invoke.mockImplementation((command, args) =>
    command === "jira_list_projects"
      ? Promise.resolve([{ id: "1", key: "ENG", name: "Engineering" }])
      : previous(command, args),
  );
  invoke.mockClear();
  await act(async () => saveHiddenJiraProjectIds(["1"]));
  expect(container.textContent).not.toContain("ENG-1");
  expect(invoke).not.toHaveBeenCalledWith("jira_board_issues", expect.anything());
});
it("performs a keyboard status move through the real transition ID", async () => {
  expect(container.querySelector('section[aria-label="Ready"]')?.textContent).toContain("ENG-1");
  await click("Move");
  await click("Working");
  expect(invoke).toHaveBeenCalledWith("jira_issue_transition", {
    key: "ENG-1",
    transitionId: "31",
  });
  expect(changed).toHaveBeenCalledTimes(1);
});
it("shows active and future sprints and moves backlog issues to the selected sprint", async () => {
  await click("Backlog & sprints");
  await click("Move");
  await click("Sprint 21");
  expect(invoke).toHaveBeenCalledWith("jira_board_move", {
    boardId: 7,
    key: "ENG-1",
    target: "sprint",
    sprintId: 21,
    beforeKey: null,
    afterKey: null,
  });
});
it("requires an explicit workflow choice and never posts a required-fields transition", async () => {
  invoke.mockImplementation(async (command) => {
    if (command === "jira_issue_transitions")
      return [
        { id: "41", name: "Resolve", statusId: "3", requiresFields: true },
        { id: "42", name: "Begin", statusId: "3", requiresFields: false },
      ];
    return null;
  });
  await click("Move");
  await click("Working");
  expect(container.querySelector<HTMLButtonElement>("button:disabled")?.textContent).toBeTruthy();
  expect(
    [...container.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Resolve"))
      ?.disabled,
  ).toBe(true);
  expect(invoke).not.toHaveBeenCalledWith("jira_issue_transition", expect.anything());
  await click("Cancel");
});
it("keeps failed writes visible after reloading the server state", async () => {
  const previous = invoke.getMockImplementation()!;
  invoke.mockImplementation((command, args) =>
    command === "jira_issue_transition"
      ? Promise.reject("Permission denied")
      : previous(command, args),
  );
  await click("Move");
  await click("Working");
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("Permission denied");
  expect(container.querySelector('section[aria-label="Ready"]')?.textContent).toContain("ENG-1");
});
it("loads subsequent issue pages and does not duplicate cards", async () => {
  const previous = invoke.getMockImplementation()!;
  invoke.mockImplementation((command, args) =>
    command === "jira_board_issues"
      ? Promise.resolve({
          issues: args.nextPageToken
            ? [issue, { ...issue, id: "2", identifier: "ENG-2" }]
            : [issue],
          nextPageToken: args.nextPageToken ? null : "next",
        })
      : previous(command, args),
  );
  await click("Refresh");
  await click("Load more issues");
  expect(invoke).toHaveBeenCalledWith("jira_board_issues", {
    boardId: 7,
    scope: "board",
    sprintId: null,
    nextPageToken: "next",
    projectIds: null,
  });
  expect(container.querySelectorAll(".jira-board-card")).toHaveLength(2);
});
it("supports keyboard ranking within a column", async () => {
  const previous = invoke.getMockImplementation()!;
  invoke.mockImplementation((command, args) =>
    command === "jira_board_issues"
      ? Promise.resolve({
          issues: [issue, { ...issue, id: "2", identifier: "ENG-2" }],
          nextPageToken: null,
        })
      : previous(command, args),
  );
  await click("Refresh");
  await click("Move");
  await click("Rank later");
  expect(invoke).toHaveBeenCalledWith("jira_board_move", {
    boardId: 7,
    key: "ENG-1",
    target: "rank",
    sprintId: null,
    beforeKey: null,
    afterKey: "ENG-2",
  });
});
