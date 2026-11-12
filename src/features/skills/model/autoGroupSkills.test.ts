import { afterEach, expect, it, vi } from "vitest";
const provider = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("../../../integrations/harness/core/registry", () => ({
  runHarnessTextPrompt: provider.run,
  canRunHarnessTextPrompt: () => true,
}));
vi.mock("../../sessions/public/models", () => ({
  isModelEnabled: () => true,
  modelBelongsToHarness: () => true,
}));
vi.mock("./skillGroupingModel", () => ({
  getSkillGroupingModel: () => ({ harness: "codex", model: "test" }),
}));
import { autoGroupSkills, parseSkillGroupProposal } from "./autoGroupSkills";
const skills = [
  { name: "a", description: "A" },
  { name: "b", description: "B" },
];
afterEach(() => {
  vi.useRealTimers();
  provider.run.mockReset();
});
it("returns proposals through selected utility model, drops unknowns, covers omissions", async () => {
  provider.run.mockResolvedValue('{"groups":[{"name":"Build","skillNames":["a","unknown","a"]}]}');
  expect(await autoGroupSkills({ skills, cwd: "/project" })).toEqual([
    { name: "Build", skillNames: ["a"], source: "ai" },
    { name: "Other skills", skillNames: ["b"], source: "ai" },
  ]);
  expect(provider.run).toHaveBeenCalledWith(
    expect.objectContaining({ harness: "codex", model: "test", ephemeral: true }),
  );
});
it("rejects garbage and excessive groups and propagates provider failure", async () => {
  for (const text of [
    "garbage",
    "[]",
    '{"groups":[{"name":4,"skillNames":[]}]}',
    JSON.stringify({ groups: Array(21).fill({ name: "x", skillNames: ["a"] }) }),
  ])
    expect(() => parseSkillGroupProposal(text, skills)).toThrow();
  provider.run.mockRejectedValue(new Error("offline"));
  await expect(autoGroupSkills({ skills, cwd: "" })).rejects.toThrow("offline");
});
it("bounds names", () => {
  expect(
    parseSkillGroupProposal(
      JSON.stringify({ groups: [{ name: "x".repeat(100), skillNames: ["a"] }] }),
      skills,
    )[0].name.length,
  ).toBeLessThanOrEqual(80);
});
it("times out and aborts hung providers", async () => {
  vi.useFakeTimers();
  provider.run.mockReturnValue(new Promise(() => {}));
  const pending = autoGroupSkills({ skills, cwd: "", timeoutMs: 10 });
  const rejected = expect(pending).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(10);
  await rejected;
  expect(provider.run.mock.calls[0][0].signal.aborted).toBe(true);
});
