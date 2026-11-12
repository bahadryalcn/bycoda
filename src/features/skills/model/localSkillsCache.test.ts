import { beforeEach, expect, it, vi } from "vitest";

const listSkills = vi.hoisted(() => vi.fn());
vi.mock("../../../platform/tauri/fs", () => ({ listSkills }));
vi.mock("../../projects/public/recents", () => ({
  isRemoteProjectPath: (path: string) => path.startsWith("remote://"),
}));

import { cachedLocalSkills, clearLocalSkillsCache, loadLocalSkills } from "./localSkillsCache";

const skill = (name: string) => ({ name }) as never;

beforeEach(() => {
  listSkills.mockReset();
  clearLocalSkillsCache();
});

it("has nothing before the first read and the previous list after it", async () => {
  expect(cachedLocalSkills("/work/a")).toBeNull();
  listSkills.mockResolvedValue([skill("one")]);
  await loadLocalSkills("/work/a");
  expect(cachedLocalSkills("/work/a")).toEqual([skill("one")]);
  expect(cachedLocalSkills("/work/b")).toBeNull();
});

it("keeps the previous list when a later read fails", async () => {
  listSkills.mockResolvedValueOnce([skill("one")]).mockRejectedValueOnce(new Error("offline"));
  await loadLocalSkills("/work/a");
  await expect(loadLocalSkills("/work/a")).rejects.toThrow("offline");
  expect(cachedLocalSkills("/work/a")).toEqual([skill("one")]);
});

it("lists this computer's skills without the project folder for a remote project", async () => {
  listSkills.mockResolvedValue([skill("home")]);
  await loadLocalSkills("remote://machine/project");
  expect(listSkills).toHaveBeenCalledWith("");
  expect(cachedLocalSkills("remote://other/project")).toEqual([skill("home")]);
});

it("shares one scan between overlapping page opens and refreshes", async () => {
  let finish!: (value: never[]) => void;
  listSkills.mockReturnValue(new Promise<never[]>((resolve) => (finish = resolve)));
  const first = loadLocalSkills("/work/a");
  const second = loadLocalSkills("/work/a");
  expect(listSkills).toHaveBeenCalledTimes(1);
  finish([skill("one")]);
  expect(await first).toEqual(await second);
});

it("does not restore a cleared cache with an older scan", async () => {
  let finish!: (value: never[]) => void;
  listSkills.mockReturnValueOnce(new Promise<never[]>((resolve) => (finish = resolve)));
  const older = loadLocalSkills("/work/a");
  clearLocalSkillsCache();
  listSkills.mockResolvedValueOnce([skill("new")]);
  await loadLocalSkills("/work/a");
  finish([skill("old")]);
  await older;
  expect(cachedLocalSkills("/work/a")).toEqual([skill("new")]);
});

it("releases a failed shared scan so the next refresh can retry", async () => {
  listSkills.mockRejectedValueOnce(new Error("scan failed")).mockResolvedValueOnce([]);
  const results = await Promise.allSettled([
    loadLocalSkills("/work/a"),
    loadLocalSkills("/work/a"),
  ]);
  expect(results.every((result) => result.status === "rejected")).toBe(true);
  expect(listSkills).toHaveBeenCalledTimes(1);
  expect(await loadLocalSkills("/work/a")).toEqual([]);
  expect(listSkills).toHaveBeenCalledTimes(2);
});
