// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { hasLiveCatalog, modelsFor, resetHarnessModelOverlays, setHarnessModels } from "./models";
import { useModelCatalog } from "./modelHooks";

it("useModelCatalog reads like the module functions and changes identity with the catalog", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const seen: Array<ReturnType<typeof useModelCatalog>> = [];
  function Probe() {
    seen.push(useModelCatalog());
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    act(() => root.render(createElement(Probe)));
    const first = seen.at(-1)!;
    act(() => root.render(createElement(Probe)));
    expect(seen.at(-1)).toBe(first);
    act(() => setHarnessModels("claude", [{ id: "cat-1", harness: "claude", name: "Cat" }]));
    const next = seen.at(-1)!;
    expect(next).not.toBe(first);
    expect(next.hasLiveCatalog("claude")).toBe(hasLiveCatalog("claude"));
    expect(next.modelsFor("claude")).toEqual(modelsFor("claude"));
  } finally {
    act(() => root.unmount());
    resetHarnessModelOverlays();
    vi.unstubAllGlobals();
  }
});
