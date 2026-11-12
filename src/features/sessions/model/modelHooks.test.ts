// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useModelCatalog } from "./modelHooks";
import { resetHarnessModelOverlays, resolveModelFromCatalog, setHarnessModels } from "./models";

it("keeps resolution snapshots stable and updates them when the catalog changes", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const seen: ReturnType<typeof useModelCatalog>[] = [];
  function Probe() {
    seen.push(useModelCatalog("codex"));
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    act(() => root.render(createElement(Probe)));
    act(() => root.render(createElement(Probe)));
    expect(seen[1]).toBe(seen[0]);
    act(() =>
      setHarnessModels("codex", [{ id: "codex:reactive", harness: "codex", name: "Reactive" }]),
    );
    const next = seen.at(-1)!;
    expect(next).not.toBe(seen[0]);
    expect(resolveModelFromCatalog(next.resolution!, "codex", "codex:reactive").name).toBe(
      "Reactive",
    );
  } finally {
    act(() => root.unmount());
    resetHarnessModelOverlays();
    vi.unstubAllGlobals();
  }
});
