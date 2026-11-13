// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
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
const routing = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock("../../model-routing/public/helpers", async (original) => ({
  ...(await original<typeof import("../../model-routing/public/helpers")>()),
  resolveHelperModel: routing.resolve,
}));
import { resolveSkillGroupingModel } from "./skillGroupingModel";
it("uses bound skillGrouping role and preserves account identity", async () => {
  const target = {
    harness: "codex" as const,
    model: "role-model",
    providerAccountId: "role-account",
    modelSettings: { effort: "low" },
  };
  routing.resolve.mockResolvedValueOnce(target);
  expect(await resolveSkillGroupingModel()).toEqual(target);
  expect(routing.resolve).toHaveBeenCalledWith("text.skillGrouping");
});

it("uses automatic title utility when the role is unbound", async () => {
  routing.resolve.mockResolvedValueOnce(undefined);
  expect(await resolveSkillGroupingModel()).toEqual({ harness: "codex", model: "utility" });
});
