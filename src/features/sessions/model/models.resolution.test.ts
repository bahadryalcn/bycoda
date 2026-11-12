// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import {
  modelResolutionCatalog,
  resolveModel,
  resolveModelFromCatalog,
  resetHarnessModelOverlays,
  resetDisabledModels,
  saveModelEnabled,
  setHarnessModels,
} from "./models";
import type { HarnessId } from "./session";

afterEach(() => {
  resetHarnessModelOverlays();
  localStorage.clear();
  resetDisabledModels();
});

it("matches saved identities, aliases, bundled entries and empty-catalog fallbacks", () => {
  const cases: [HarnessId, string | undefined][] = [
    ["claude", undefined],
    ["claude", "claude:opus"],
    ["claude", "claude:sonnet-5"],
    ["claude", "claude:opus-99-1"],
    ["claude", "missing"],
    ["codex", undefined],
    ["codex", "codex:gpt-unknown"],
    ["codex", "claude:opus"],
    ["acp", ""],
    ["acp", "saved-model"],
  ];
  for (const [harness, id] of cases) {
    expect(resolveModelFromCatalog(modelResolutionCatalog(harness), harness, id)).toEqual(
      resolveModel(harness, id),
    );
  }
  expect(
    resolveModelFromCatalog(modelResolutionCatalog("codex"), "codex", "codex:gpt-unknown"),
  ).toMatchObject({ id: "codex:gpt-unknown", nativeId: "gpt-unknown" });
});

it("matches exact, native, prefix, fast and disabled-default paths with a live catalog", () => {
  setHarnessModels("codex", [
    {
      id: "codex:test",
      harness: "codex",
      name: "Test",
      nativeId: "test",
      fastVariant: { id: "codex:test-fast", nativeId: "test-fast" },
    },
    { id: "codex:other", harness: "codex", name: "Other", nativeId: "other" },
  ]);
  saveModelEnabled("codex:test", false);
  for (const id of [
    undefined,
    "codex:test",
    "test",
    "te",
    "test-2",
    "codex:test-fast",
    "missing",
  ]) {
    expect(resolveModelFromCatalog(modelResolutionCatalog("codex"), "codex", id)).toEqual(
      resolveModel("codex", id),
    );
  }
  const catalog = modelResolutionCatalog("codex");
  const before = resolveModelFromCatalog(catalog, "codex", "codex:test");
  setHarnessModels("codex", [{ id: "codex:test", harness: "codex", name: "Changed" }]);
  expect(resolveModelFromCatalog(catalog, "codex", "codex:test")).toBe(before);
  expect(resolveModel("codex", "codex:test").name).toBe("Changed");
});
