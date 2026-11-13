// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { fetchJiraInboxPage } from "./jiraInboxPage";
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const query = { assignedToMe: false, state: "open", search: "", jiraHiddenProjectIds: [] } as const;
beforeEach(() => {
  localStorage.clear();
  invoke.mockReset();
});

it("carries cursor and exact filters and only reports a provider total", async () => {
  invoke.mockResolvedValue({ issues: [], nextPageToken: "third", total: 42 });
  const result = await fetchJiraInboxPage(
    { ...query, jiraHiddenProjectIds: [], jiraAssignees: ["ada"], jiraStatuses: ["Ready"] },
    "second",
  );
  expect(invoke).toHaveBeenCalledExactlyOnceWith("jira_list_issue_page", {
    assignedToMe: false,
    state: "open",
    projectIds: [],
    limit: 40,
    filters: { assigneeIds: ["ada"], unassigned: false, statuses: ["Ready"] },
    nextPageToken: "second",
  });
  expect(result.jiraPage).toEqual({ token: "third", total: 42 });
});

it("does not invent a total for a partial page", async () => {
  invoke.mockResolvedValue({ issues: [], nextPageToken: "second" });
  expect((await fetchJiraInboxPage({ ...query, jiraHiddenProjectIds: [] })).jiraPage).toEqual({
    token: "second",
    total: undefined,
  });
});

it("rejects repeated cursors and malformed pages", async () => {
  invoke.mockResolvedValueOnce({ issues: [], nextPageToken: "same" });
  await expect(fetchJiraInboxPage({ ...query, jiraHiddenProjectIds: [] }, "same")).rejects.toThrow(
    "repeated",
  );
  invoke.mockResolvedValueOnce([]);
  await expect(fetchJiraInboxPage({ ...query, jiraHiddenProjectIds: [] })).rejects.toThrow(
    "issue page",
  );
});

it("does not read issues when all known projects are hidden", async () => {
  invoke.mockResolvedValue([{ id: "1", key: "ENG", name: "Engineering" }]);
  expect((await fetchJiraInboxPage({ ...query, jiraHiddenProjectIds: ["1"] })).items).toEqual([]);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("jira_list_projects");
});

it("fails closed on corrupt saved project scope", async () => {
  localStorage.setItem("bycoda.jiraHiddenProjects", "{bad");
  await expect(
    fetchJiraInboxPage({ assignedToMe: false, state: "open", search: "" }),
  ).rejects.toThrow("scope is unavailable");
  expect(invoke).not.toHaveBeenCalled();
});
