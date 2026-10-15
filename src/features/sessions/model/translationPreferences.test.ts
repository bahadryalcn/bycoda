import { afterEach, expect, it, vi } from "vitest";
import { saveDefaultTranslationChoice, translationContextWithDefault } from "./translationPreferences";

const context = { cwd: "/p", harness: "codex" as const, providerAccountId: "session-account" };

function stubStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
}

afterEach(() => vi.unstubAllGlobals());

it("keeps the session account when the default choice has none and uses the same harness", () => {
  stubStorage();
  saveDefaultTranslationChoice({ harness: "codex", model: "gpt-x" });
  expect(translationContextWithDefault(context)).toMatchObject({
    harness: "codex",
    model: "gpt-x",
    providerAccountId: "session-account",
  });
});

it("drops the session account when the default choice targets another harness", () => {
  stubStorage();
  saveDefaultTranslationChoice({ harness: "claude", model: "sonnet" });
  const result = translationContextWithDefault(context);
  expect(result.harness).toBe("claude");
  expect(result.providerAccountId).toBeUndefined();
});

it("uses the choice account when the default choice has one", () => {
  stubStorage();
  saveDefaultTranslationChoice({
    harness: "claude",
    model: "sonnet",
    providerAccountId: "choice-account",
  });
  expect(translationContextWithDefault(context).providerAccountId).toBe("choice-account");
});

it("returns the session context unchanged without a default choice", () => {
  stubStorage();
  expect(translationContextWithDefault(context)).toBe(context);
});
