vi.mock("../../../integrations/harness/core/registry", () => ({
  getHarness: (id: string) =>
    id === "pi" || id === "omp"
      ? {
          commands: {
            discover: async () => [],
            rawSlashCommands: id === "omp",
          },
        }
      : undefined,
}));

const availability = vi.hoisted(() => ({ available: true }));
vi.mock("../../connections/public/machineAvailability", () => ({
  readMachineAvailability: () => availability,
}));

import { describe, expect, it, vi } from "vitest";
import type { Skill } from "../../skills/model/skills";
import {
  logComposerSkillsFailure,
  nextComposerSkillContextToken,
  pickerSkillLoadOptions,
  visibleComposerSkills,
} from "./useComposerSkills";

const piSkill: Skill = {
  kind: "native",
  name: "architect",
  description: "Design first.",
  invocation: "skill:architect",
  source: "pi",
};

const cachedSkill: Skill = {
  kind: "native",
  name: "cached",
  description: "Cached current context.",
  invocation: "skill:cached",
  source: "pi",
};

describe("composer skill catalog policies", () => {
  it("uses loaded rows only for their owning context", () => {
    expect(visibleComposerSkills({ key: "pi\0/a", skills: [piSkill] }, "pi\0/a", null, [])).toEqual(
      [piSkill],
    );
    expect(
      visibleComposerSkills({ key: "pi\0/a", skills: [piSkill] }, "pi\0/b", [cachedSkill], []),
    ).toEqual([cachedSkill]);
  });

  it("preserves filesystem refresh while Pi uses its TTL", () => {
    expect(pickerSkillLoadOptions("pi")).toBeUndefined();
    expect(pickerSkillLoadOptions("omp")).toBeUndefined();
    expect(pickerSkillLoadOptions("claude")).toEqual({ refresh: true });
  });

  it("does not reuse a context token after A to B to A", () => {
    const firstA = nextComposerSkillContextToken(null, "pi\0/a");
    const sameA = nextComposerSkillContextToken(firstA, "pi\0/a");
    const b = nextComposerSkillContextToken(sameA, "pi\0/b");
    const secondA = nextComposerSkillContextToken(b, "pi\0/a");

    expect(sameA).toBe(firstA);
    expect(secondA.key).toBe(firstA.key);
    expect(secondA).not.toBe(firstA);
    expect(secondA.generation).toBeGreaterThan(firstA.generation);
  });

  it("logs a failed load only while its machine is reachable", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    availability.available = false;
    logComposerSkillsFailure("remote://m", new Error("offline"));
    expect(warn).not.toHaveBeenCalled();
    availability.available = true;
    logComposerSkillsFailure("remote://m", new Error("real"));
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
