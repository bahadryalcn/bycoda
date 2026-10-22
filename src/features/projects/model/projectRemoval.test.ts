import { beforeEach, expect, it, vi } from "vitest";
vi.mock("../../sessions/data/sessionStore", () => ({
  listSessionsByProject: vi.fn(),
  deleteSession: vi.fn(),
}));
vi.mock("./projectLogos", () => ({ clearProjectLogo: vi.fn(async () => {}) }));
vi.mock("./chatBackground", () => ({ clearProjectChatBackground: vi.fn(async () => {}) }));
vi.mock("../../workspace/model/tabGroups", () => ({
  clearTabGroupSettings: vi.fn(),
  rebaseProjectTabGroupSettings: vi.fn(),
}));
import { deleteSession, listSessionsByProject } from "../../sessions/data/sessionStore";
import { clearProjectLogo } from "./projectLogos";
import { clearTabGroupSettings } from "../../workspace/model/tabGroups";
import { projectSessionCount, removeProjectData } from "./projectData";

beforeEach(() => vi.clearAllMocks());

it("does not report a failed conversation read as an empty project", async () => {
  vi.mocked(listSessionsByProject).mockRejectedValue(new Error("database unavailable"));
  await expect(projectSessionCount("/repo")).rejects.toThrow("database unavailable");
  await expect(removeProjectData("/repo")).rejects.toThrow("database unavailable");
  expect(deleteSession).not.toHaveBeenCalled();
  expect(clearProjectLogo).not.toHaveBeenCalled();
  expect(clearTabGroupSettings).not.toHaveBeenCalled();
});

it("preserves project metadata and remaining conversations after a deletion fails", async () => {
  vi.mocked(listSessionsByProject).mockResolvedValue([
    { id: "first" },
    { id: "second" },
    { id: "third" },
  ] as Awaited<ReturnType<typeof listSessionsByProject>>);
  vi.mocked(deleteSession)
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error("write failed"));
  await expect(removeProjectData("/repo")).rejects.toThrow("write failed");
  expect(vi.mocked(deleteSession).mock.calls.map(([id]) => id)).toEqual(["first", "second"]);
  expect(clearProjectLogo).not.toHaveBeenCalled();
  expect(clearTabGroupSettings).not.toHaveBeenCalled();
});
