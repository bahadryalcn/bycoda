import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resetHarnessModelOverlays, setHarnessModels } from "./models";
import {
  defaultTitleChoice,
  loadDefaultTitleChoice,
  saveDefaultTitleChoice,
  titleGenerationChoice,
  TITLE_CHOICE_KEY,
} from "./titlePreferences";

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

it("retains explicit model/account/settings across conversations and resets independently", () => {
  saveDefaultTitleChoice({
    harness: "codex",
    model: "codex:selected",
    providerAccountId: "account",
    modelSettings: { effort: "high" },
  });
  expect(titleGenerationChoice("claude")).toEqual({
    harness: "codex",
    model: "codex:selected",
    providerAccountId: "account",
    modelSettings: { effort: "high" },
  });
  saveDefaultTitleChoice(undefined);
  expect(loadDefaultTitleChoice()).toBeUndefined();
  expect(titleGenerationChoice("claude")?.model).toBe("claude:haiku-4.5");
});

it("reports failed storage without reporting saved preference", () => {
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {
      throw new Error("quota");
    },
  });
  expect(() => saveDefaultTitleChoice({ harness: "claude", model: "claude:haiku-4.5" })).toThrow(
    "quota",
  );
  expect(loadDefaultTitleChoice()).toBeUndefined();
});

it("ignores invalid persisted data and removes unsupported account pins", () => {
  localStorage.setItem(TITLE_CHOICE_KEY, JSON.stringify({ harness: "fake", model: "fake" }));
  expect(loadDefaultTitleChoice()).toBeUndefined();
  saveDefaultTitleChoice({
    harness: "antigravity",
    model: "antigravity:flash",
    providerAccountId: "wrong",
  });
  expect(titleGenerationChoice("claude")?.providerAccountId).toBeUndefined();
});
