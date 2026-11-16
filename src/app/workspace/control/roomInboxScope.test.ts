import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ hidden: vi.fn(), projects: vi.fn(), boards: vi.fn() }));
vi.mock("../../../features/inbox/model/jira", () => ({
  requireHiddenJiraProjectIds: mocks.hidden,
  loadAllowedJiraBoardIds: mocks.boards,
  listJiraProjects: mocks.projects,
  jiraProjectIdsForFetch: (projects: { id: string }[], hidden: string[]) =>
    projects.filter((p) => !hidden.includes(p.id)).map((p) => p.id),
}));
import { readRoomInboxRevision, readRoomInboxScope } from "./roomInboxScope";
beforeEach(() => {
  mocks.hidden.mockReset();
  mocks.projects.mockReset();
  mocks.boards.mockReset().mockReturnValue([9, 7, 9]);
});
it("resolves saved hidden projects and enabled boards, rejecting a change during the async read", async () => {
  mocks.hidden.mockReturnValueOnce(["2"]).mockReturnValueOnce(["2"]);
  mocks.projects.mockResolvedValue([{ id: "1" }, { id: "2" }]);
  expect(await readRoomInboxScope()).toEqual({
    projectIds: ["1"],
    allowedBoardIds: [7, 9],
    revision: JSON.stringify({ hidden: ["2"], boards: [7, 9] }),
  });
  mocks.hidden.mockReturnValueOnce(["2"]).mockReturnValueOnce(["1"]);
  await expect(readRoomInboxScope()).rejects.toThrow("visibility changed");
  mocks.hidden.mockReturnValue(["2"]);
  mocks.boards.mockReturnValueOnce([7]).mockReturnValueOnce([8]);
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
  expect(readRoomInboxRevision()).toBe(JSON.stringify({ hidden: ["1", "2"], boards: [7, 9] }));
  expect(mocks.projects).not.toHaveBeenCalled();
});
