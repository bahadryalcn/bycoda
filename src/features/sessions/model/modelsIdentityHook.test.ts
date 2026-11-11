// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { findModelIdentity, resetHarnessModelOverlays, setHarnessModels } from "./models";
import { useModelIdentity } from "./modelHooks";

it("useModelIdentity returns findModelIdentity's value and follows catalog changes", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const seen: Array<string | undefined> = [];
  function Probe() {
    seen.push(useModelIdentity("hook-model")?.name);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    act(() => root.render(createElement(Probe)));
    expect(seen.at(-1)).toBeUndefined();
    act(() => setHarnessModels("claude", [{ id: "hook-model", harness: "claude", name: "First" }]));
    expect(seen.at(-1)).toBe("First");
    expect(seen.at(-1)).toBe(findModelIdentity("hook-model")?.name);
    const renders = seen.length;
    act(() => root.render(createElement(Probe)));
    expect(seen.length).toBe(renders + 1);
    expect(seen.at(-1)).toBe("First");
  } finally {
    act(() => root.unmount());
    resetHarnessModelOverlays();
    vi.unstubAllGlobals();
  }
});
