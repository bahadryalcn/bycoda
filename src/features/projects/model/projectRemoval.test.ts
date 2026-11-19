import { beforeEach, expect, it, vi } from "vitest";
vi.mock("../../sessions/data/sessionStore", () => ({
  listSessionsByProject: vi.fn(),
  countSessionsByProject: vi.fn(),
  deleteSessionsByProject: vi.fn(),
  deleteSession: vi.fn(),
}));
vi.mock("./projectLogos", () => ({ clearProjectLogo: vi.fn(async () => {}) }));
vi.mock("./chatBackground", () => ({ clearProjectChatBackground: vi.fn(async () => {}) }));
vi.mock("../../workspace/model/tabGroups", () => ({
  clearTabGroupSettings: vi.fn(),
  rebaseProjectTabGroupSettings: vi.fn(),
}));
import {
  countSessionsByProject,
  deleteSession,
  deleteSessionsByProject,
  listSessionsByProject,
} from "../../sessions/data/sessionStore";
import { clearProjectLogo } from "./projectLogos";
import { clearTabGroupSettings } from "../../workspace/model/tabGroups";
import { projectSessionCount, removeProjectData } from "./projectData";

beforeEach(() => vi.clearAllMocks());

it("does not report a failed conversation read as an empty project", async () => {
  vi.mocked(countSessionsByProject).mockRejectedValue(new Error("database unavailable"));
  vi.mocked(deleteSessionsByProject).mockRejectedValue(new Error("database unavailable"));
  await expect(projectSessionCount("/repo")).rejects.toThrow("database unavailable");
  await expect(removeProjectData("/repo")).rejects.toThrow("database unavailable");
  expect(clearProjectLogo).not.toHaveBeenCalled();
  expect(clearTabGroupSettings).not.toHaveBeenCalled();
});

it("counts and removes a large project without loading its summaries or deleting one by one", async () => {
  vi.mocked(countSessionsByProject).mockResolvedValue(5000);
  vi.mocked(deleteSessionsByProject).mockResolvedValue(5000);
  await expect(projectSessionCount("/repo")).resolves.toBe(5000);
  await removeProjectData("/repo");
  expect(countSessionsByProject).toHaveBeenCalledWith("/repo");
  expect(deleteSessionsByProject).toHaveBeenCalledTimes(1);
  expect(deleteSessionsByProject).toHaveBeenCalledWith("/repo");
  expect(listSessionsByProject).not.toHaveBeenCalled();
  expect(deleteSession).not.toHaveBeenCalled();
  expect(clearProjectLogo).toHaveBeenCalledTimes(1);
  expect(clearTabGroupSettings).toHaveBeenCalledTimes(1);
});

it("preserves project metadata and the partial-failure report after a deletion fails", async () => {
  vi.mocked(deleteSessionsByProject).mockRejectedValue(
    new Error("Deleted 2 of 3 conversations; 1 could not be removed and the project was kept."),
  );
  await expect(removeProjectData("/repo")).rejects.toThrow("Deleted 2 of 3 conversations");
  expect(clearProjectLogo).not.toHaveBeenCalled();
  expect(clearTabGroupSettings).not.toHaveBeenCalled();
});
