import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ hidden: vi.fn(), projects: vi.fn() }));
vi.mock("../../../features/inbox/model/jira", () => ({
  requireHiddenJiraProjectIds: mocks.hidden,
  listJiraProjects: mocks.projects,
  jiraProjectIdsForFetch: (projects: { id: string }[], hidden: string[]) =>
    projects.filter((p) => !hidden.includes(p.id)).map((p) => p.id),
}));
import { readRoomInboxRevision, readRoomInboxScope } from "./roomInboxScope";
beforeEach(() => {
  mocks.hidden.mockReset();
  mocks.projects.mockReset();
});
it("resolves saved hidden projects and rejects a scope change during the async read", async () => {
  mocks.hidden.mockReturnValueOnce(["2"]).mockReturnValueOnce(["2"]);
  mocks.projects.mockResolvedValue([{ id: "1" }, { id: "2" }]);
  expect(await readRoomInboxScope()).toEqual({
    projectIds: ["1"],
    revision: JSON.stringify({ hidden: ["2"] }),
  });
  mocks.hidden.mockReturnValueOnce(["2"]).mockReturnValueOnce(["1"]);
  await expect(readRoomInboxScope()).rejects.toThrow("visibility changed");
});
it("does not widen an unavailable saved scope", async () => {
  mocks.hidden.mockImplementation(() => {
    throw new Error("scope unavailable");
  });
  await expect(readRoomInboxScope()).rejects.toThrow("scope unavailable");
  expect(mocks.projects).not.toHaveBeenCalled();
});
it("checks a retained visibility revision without a provider read", () => {
  mocks.hidden.mockReturnValue(["2", "1", "2"]);
  expect(readRoomInboxRevision()).toBe(JSON.stringify({ hidden: ["1", "2"] }));
  expect(mocks.projects).not.toHaveBeenCalled();
});
