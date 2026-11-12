import { expect, it, vi } from "vitest";
import { runtimeAutomaticSubagents } from "./automaticSubagents";

vi.mock("./availabilityState", () => ({
  isHarnessAvailable: (id: string) => id === "codex" || id === "claude",
}));
vi.mock("../../../features/sessions/model/models", () => ({
  modelsFor: (id: string) => [{ id: `${id}:fixture`, name: "Fixture" }],
  isModelEnabled: () => true,
}));
vi.mock("../../../features/providers/model/providerAccounts", () => ({
  defaultProviderAccountId: () => "personal",
}));

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
