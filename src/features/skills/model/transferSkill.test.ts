import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exportSkill: vi.fn(),
  importSkill: vi.fn(),
  invalidateSkills: vi.fn(),
  runMachineCommand: vi.fn(),
}));

vi.mock("../../../platform/tauri/fs", () => ({
  exportSkill: mocks.exportSkill,
  importSkill: mocks.importSkill,
}));
vi.mock("../../connections/model/remoteCommands", () => ({
  runMachineCommand: mocks.runMachineCommand,
}));
vi.mock("./skills", () => ({
  invalidateSkills: mocks.invalidateSkills,
  SKILLS_CHANGE_EVENT: "bycoda:skills-change",
}));

import { canTransferSkill, SkillExistsError, transferSkill } from "./transferSkill";

const skill = { name: "tool", path: "/home/me/.agents/skills/tool/SKILL.md" };
const bundle = { name: "tool", files: [{ path: "SKILL.md", data: "eA==" }] };
const events: string[] = [];

beforeEach(() => {
  mocks.exportSkill.mockReset().mockResolvedValue(bundle);
  mocks.importSkill
    .mockReset()
    .mockResolvedValue("remote://env/home/me/.agents/skills/tool/SKILL.md");
  mocks.invalidateSkills.mockReset();
  mocks.runMachineCommand
    .mockReset()
    .mockResolvedValue("remote://env/home/me/.agents/skills/tool/SKILL.md");
  events.length = 0;
  const target = new EventTarget();
  target.addEventListener("bycoda:skills-change", () => events.push("change"));
  vi.stubGlobal("window", target);
});
afterEach(() => vi.unstubAllGlobals());

it("exports from the source machine, imports on the target and refreshes skills", async () => {
  const written = await transferSkill({
    skill,
    sourceCwd: "",
    targetCwd: "remote://env/home/me/repo",
    overwrite: false,
  });
  expect(written).toBe("remote://env/home/me/.agents/skills/tool/SKILL.md");
  expect(mocks.exportSkill).toHaveBeenCalledWith(skill.path, "");
  expect(mocks.importSkill).toHaveBeenCalledWith("remote://env/home/me/repo", bundle, false);
  expect(mocks.invalidateSkills).toHaveBeenCalledTimes(1);
  expect(events).toEqual(["change"]);
});

it("imports on a machine addressed directly, without a project path", async () => {
  await transferSkill({
    skill,
    sourceCwd: "",
    targetCwd: "",
    targetMachine: "env",
    overwrite: true,
  });
  expect(mocks.importSkill).not.toHaveBeenCalled();
  expect(mocks.runMachineCommand).toHaveBeenCalledWith("env", "skill_import", {
    name: "tool",
    files: bundle.files,
    overwrite: true,
  });
  expect(mocks.invalidateSkills).toHaveBeenCalledTimes(1);
});

it("passes the overwrite flag through", async () => {
  await transferSkill({
    skill,
    sourceCwd: "remote://env/home/me/repo",
    targetCwd: "",
    overwrite: true,
  });
  expect(mocks.exportSkill).toHaveBeenCalledWith(skill.path, "remote://env/home/me/repo");
  expect(mocks.importSkill).toHaveBeenCalledWith("", bundle, true);
});

it("surfaces an existing skill as SkillExistsError and refreshes nothing", async () => {
  mocks.importSkill.mockRejectedValueOnce(
    "Host rejected request: SKILL_EXISTS: A skill named tool already exists.",
  );
  const failure = transferSkill({
    skill,
    sourceCwd: "",
    targetCwd: "remote://env/x",
    overwrite: false,
  });
  await expect(failure).rejects.toBeInstanceOf(SkillExistsError);
  await expect(failure).rejects.toMatchObject({ skillName: "tool" });
  expect(mocks.invalidateSkills).not.toHaveBeenCalled();
  expect(events).toEqual([]);
});

it("keeps other errors as they are and skips the import when the export fails", async () => {
  mocks.importSkill.mockRejectedValueOnce(new Error("disk full"));
  await expect(
    transferSkill({ skill, sourceCwd: "", targetCwd: "", overwrite: false }),
  ).rejects.toThrow("disk full");
  mocks.exportSkill.mockRejectedValueOnce(new Error("too big"));
  mocks.importSkill.mockClear();
  await expect(
    transferSkill({ skill, sourceCwd: "", targetCwd: "", overwrite: false }),
  ).rejects.toThrow("too big");
  expect(mocks.importSkill).not.toHaveBeenCalled();
});

it("only offers file skills that are not plugin-namespaced", () => {
  expect(canTransferSkill({ name: "tool", scope: "user" })).toBe(true);
  expect(canTransferSkill({ name: "tool", scope: "project" })).toBe(true);
  expect(canTransferSkill({ name: "create-skill", scope: "builtin" })).toBe(false);
  expect(canTransferSkill({ name: "kit:plan", scope: "user" })).toBe(false);
});
