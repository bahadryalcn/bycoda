// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
vi.mock("../../sessions/public/titlePreferences", () => ({
  titleGenerationChoice: () => ({ harness: "codex", model: "utility" }),
}));
vi.mock("../../../integrations/harness/core/registry", () => ({
  canRunHarnessTextPrompt: (harness: string) => harness === "codex",
}));
vi.mock("../../sessions/public/models", () => ({
  isModelEnabled: (model: string) => model !== "disabled",
  modelBelongsToHarness: (harness: string) => harness === "codex",
  modelsFor: () => [
    { id: "utility", name: "Utility" },
    { id: "disabled", name: "Disabled" },
  ],
}));
import {
  getSkillGroupingModel,
  setSkillGroupingModel,
  listSkillGroupingModels,
  SKILL_GROUPING_MODEL_KEY,
} from "./skillGroupingModel";
beforeEach(() => localStorage.clear());
it("defaults to title utility and persists model override", () => {
  expect(getSkillGroupingModel()?.model).toBe("utility");
  setSkillGroupingModel({ harness: "codex", model: "selected", modelSettings: { effort: "low" } });
  expect(getSkillGroupingModel()).toMatchObject({
    model: "selected",
    modelSettings: { effort: "low" },
  });
  expect(listSkillGroupingModels()).toEqual([
    { harness: "codex", model: "utility", name: "Utility" },
  ]);
  setSkillGroupingModel(undefined);
  expect(getSkillGroupingModel()?.model).toBe("utility");
  localStorage.setItem(SKILL_GROUPING_MODEL_KEY, "corrupt");
  expect(getSkillGroupingModel()?.model).toBe("utility");
});
it("rejects disabled models and surfaces failed saves", () => {
  expect(() => setSkillGroupingModel({ harness: "codex", model: "disabled" })).toThrow();
  const spy = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  expect(() => setSkillGroupingModel({ harness: "codex", model: "selected" })).toThrow("quota");
  spy.mockRestore();
});
