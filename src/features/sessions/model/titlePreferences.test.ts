import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resetHarnessModelOverlays, setHarnessModels } from "./models";
import { defaultTitleChoice, titleGenerationChoice } from "./titlePreferences";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
});
afterEach(() => {
  resetHarnessModelOverlays();
  vi.unstubAllGlobals();
});

it("uses Haiku without inheriting an expensive conversation model", () => {
  expect(defaultTitleChoice("claude")).toMatchObject({
    harness: "claude",
    model: "claude:haiku-4.5",
  });
});

it("prefers actual Terra catalog entry over first model and lowers reasoning", () => {
  setHarnessModels("codex", [
    { id: "codex:large", harness: "codex", name: "Large" },
    {
      id: "codex:terra",
      harness: "codex",
      name: "Terra",
      nativeId: "gpt-5.6-terra",
      settings: [
        {
          id: "reasoningEffort",
          label: "Effort",
          kind: "select",
          value: "high",
          options: [
            { value: "low", label: "Low" },
            { value: "high", label: "High" },
          ],
        },
      ],
    },
  ]);
  expect(defaultTitleChoice("codex")).toMatchObject({
    model: "codex:terra",
    modelSettings: { reasoningEffort: "low" },
  });
});

it("does not silently select an expensive model when no economical catalog entry exists", () => {
  setHarnessModels("codex", [{ id: "codex:large", harness: "codex", name: "Large" }]);
  expect(titleGenerationChoice("codex")).toBeUndefined();
});

const routing = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock("../../model-routing/public/helpers", async (original) => ({
  ...(await original<typeof import("../../model-routing/public/helpers")>()),
  resolveHelperModel: routing.resolve,
}));
import { resolveTitleGenerationChoice } from "./titlePreferences";
it("uses bound title role and preserves account identity", async () => {
  const target = {
    harness: "codex" as const,
    model: "role-model",
    providerAccountId: "role-account",
    modelSettings: { effort: "low" },
  };
  routing.resolve.mockResolvedValueOnce(target);
  expect(await resolveTitleGenerationChoice("claude")).toEqual(target);
  expect(routing.resolve).toHaveBeenCalledWith("text.title", { cwd: undefined });
});
