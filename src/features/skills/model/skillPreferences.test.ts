// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
const { getPolicy } = vi.hoisted(() => ({ getPolicy: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("../../../platform/tauri/fs", () => ({ getSkillPolicy: getPolicy }));
vi.mock("../../../integrations/harness/core/registry", () => ({ getHarness: () => undefined }));
import { cachedSkillPolicy, cacheSkillPolicy, loadSkillRestrictions } from "./skillPreferences";
import { applySkillsToTurn } from "./skills";

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

it.each(["bycoda.disabledSkillPaths", "bycoda.disabledSkillNames"])(
  "uses the authoritative policy and prepares plain turns when optional cache write %s fails",
  async (failedKey) => {
    const policy = {
      disabledNames: ["blocked-fixture-skill"],
      disabledPaths: ["C:/fixture/SKILL.md"],
    };
    getPolicy.mockResolvedValue(policy);
    const original = localStorage.setItem.bind(localStorage);
    const write = vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
      if (key === failedKey) throw new DOMException("Cache full", "QuotaExceededError");
      original(key, value);
    });
    try {
      expect(await loadSkillRestrictions("C:/repo")).toEqual(policy);
      await expect(
        applySkillsToTurn("Ordinary message", { cwd: "C:/repo", harness: "codex" }),
      ).resolves.toBe("Ordinary message");
      await expect(
        applySkillsToTurn("$blocked-fixture-skill", { cwd: "C:/repo", harness: "codex" }),
      ).rejects.toThrow(/disabled/);
    } finally {
      write.mockRestore();
    }
  },
);
