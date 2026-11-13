import { afterEach, expect, it, vi } from "vitest";
import { defaultTextActionChoice, translationContextWithDefault } from "./translationPreferences";
import {
  resetHarnessModelOverlays,
  saveLastModelChoice,
  saveLastModelSettings,
  setHarnessModels,
} from "./models";

const context = { cwd: "/p", harness: "codex" as const, providerAccountId: "session-account" };

function stubStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
}

afterEach(() => {
  resetHarnessModelOverlays();
  vi.unstubAllGlobals();
});

it.each(["translation", "reprompt"] as const)(
  "uses the Settings default model and account for %s without an explicit action choice",
  () => {
    stubStorage();
    setHarnessModels("codex", [
      {
        id: "codex:settings-default",
        harness: "codex",
        name: "Settings default",
        settings: [
          {
            id: "effort",
            label: "Effort",
            kind: "select",
            value: "medium",
            options: [
              { value: "medium", label: "Medium" },
              { value: "high", label: "High" },
            ],
          },
        ],
      },
    ]);
    saveLastModelChoice("codex", "codex:settings-default");
    saveLastModelSettings({ effort: "high" });
    localStorage.setItem(
      "bycoda.providerAccounts.v2",
      JSON.stringify({
        codex: [
          { id: "settings-account", provider: "codex", label: "Settings account", isDefault: true },
        ],
      }),
    );
    const result = translationContextWithDefault({
      ...context,
      model: "codex:conversation-model",
      modelSettings: { effort: "medium" },
    });
    expect(result).toEqual({
      cwd: "/p",
      harness: "codex",
      model: "codex:settings-default",
      modelSettings: { effort: "high" },
      providerAccountId: "settings-account",
    });
    expect(result).toMatchObject(defaultTextActionChoice());
  },
);

it("uses a different Settings provider without carrying the conversation account or model controls", () => {
  stubStorage();
  saveLastModelChoice("claude", "claude:sonnet-5");
  const result = translationContextWithDefault({
    ...context,
    modelSettings: { sessionOnly: "true" },
  });
  expect(result).toMatchObject({
    cwd: "/p",
    harness: "claude",
    model: "claude:sonnet-5",
    providerAccountId: "default",
  });
  expect(result.modelSettings).not.toHaveProperty("sessionOnly");
});

it("never carries an account pin into a provider without account support", () => {
  stubStorage();
  saveLastModelChoice("antigravity", "antigravity:flash");
  expect(translationContextWithDefault(context).providerAccountId).toBeUndefined();
});
