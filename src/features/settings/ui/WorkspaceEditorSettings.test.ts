// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { loadAutosave, saveAutosave } from "../model/settings";
import { WorkspaceEditorSettings } from "./WorkspaceEditorSettings";

it("persists autosave changes and follows changes from the application menu", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(WorkspaceEditorSettings)));
    const toggle = container.querySelector<HTMLButtonElement>(
      '[role="switch"][aria-label="Autosave"]',
    )!;
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await act(async () => toggle.click());
    expect(loadAutosave()).toBe(true);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    act(() => {
      saveAutosave(false);
    });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  } finally {
    act(() => root.unmount());
    container.remove();
    localStorage.clear();
    vi.unstubAllGlobals();
  }
});
