// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
const { getPolicy } = vi.hoisted(() => ({ getPolicy: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("../../../platform/tauri/fs", () => ({ getSkillPolicy: getPolicy }));
import { cachedSkillPolicy, cacheSkillPolicy, loadSkillRestrictions } from "./skillPreferences";

beforeEach(() => {
  localStorage.clear();
  getPolicy.mockReset();
});

it("preserves remote legacy preferences until their own machine can migrate them", async () => {
  const remote = "remote://mac/Users/me/.agents/skills/good-css/SKILL.md";
  localStorage.setItem(
    "bycoda.disabledSkillPaths",
    JSON.stringify([remote, "C:/skills/folder-alias/SKILL.md"]),
  );
  const policy = {
    disabledNames: ["actual-name"],
    disabledPaths: ["C:/skills/folder-alias/SKILL.md"],
  };
  getPolicy.mockResolvedValue(policy);
  expect(await loadSkillRestrictions("C:/repo")).toEqual(policy);
  expect(cachedSkillPolicy().disabledPaths).toContain(remote);
  expect(cachedSkillPolicy().disabledNames).toEqual(["actual-name"]);
});

it("uses the remote machine's current policy instead of local or stale remote cache", async () => {
  cacheSkillPolicy({ disabledNames: ["good-css"], disabledPaths: [] });
  getPolicy.mockResolvedValue({ disabledNames: [], disabledPaths: [] });
  expect(await loadSkillRestrictions("remote://mac/repo")).toEqual({
    disabledNames: [],
    disabledPaths: [],
  });
  expect(cachedSkillPolicy().disabledNames).toEqual(["good-css"]);
});

it("fails closed when current preferences cannot be loaded", async () => {
  getPolicy.mockRejectedValue(new Error("offline"));
  await expect(loadSkillRestrictions("C:/repo")).rejects.toThrow(
    "Could not load skill restrictions",
  );
});
