import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runtimeAutomaticSubagents, setAutomaticSubagentCatalogReader } from "./automaticSubagents";

vi.mock("./availabilityState", () => ({
  isHarnessAvailable: (id: string) => id === "codex" || id === "claude",
}));
let modelId = "fixture";
let accountId = "personal";
beforeEach(() => {
  modelId = "fixture";
  accountId = "personal";
  setAutomaticSubagentCatalogReader(() => ({
    models: [
      { id: `claude:${modelId}`, harness: "claude" },
      { id: `codex:${modelId}`, harness: "codex" },
    ],
    defaultAccounts: { claude: accountId, codex: accountId },
  }));
});
afterEach(() => setAutomaticSubagentCatalogReader(undefined));

it("resolves catalog-key-only runtime models using own and published default accounts", () => {
  expect(runtimeAutomaticSubagents({ harness: "codex", providerAccountId: "default" })).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        harness: "codex",
        model: "codex:fixture",
        providerAccountId: "default",
      }),
      expect.objectContaining({
        harness: "claude",
        model: "claude:fixture",
        providerAccountId: "personal",
      }),
    ]),
  );
});

it("reads catalog and default account changes at selection time", () => {
  runtimeAutomaticSubagents({ harness: "codex" });
  modelId = "updated";
  accountId = "work";
  expect(runtimeAutomaticSubagents({ harness: "codex" })).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ model: "claude:updated", providerAccountId: "work" }),
    ]),
  );
  expect(runtimeAutomaticSubagents().some((model) => model.model.endsWith(":fixture"))).toBe(false);
});

it("does not invent a catalog before the renderer binds its reader", () => {
  setAutomaticSubagentCatalogReader(undefined);
  expect(runtimeAutomaticSubagents()).toEqual([]);
});
