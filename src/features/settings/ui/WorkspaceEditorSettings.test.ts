// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import {
  AUTOSAVE_DEFAULT,
  FORMAT_ON_SAVE_DEFAULT,
  loadAutosave,
  loadFormatOnSave,
  saveAutosave,
  saveFormatOnSave,
} from "../model/settings";
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

it("offers Restore default only while a preference differs from its default", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const reset = (id: string) =>
    container.querySelector<HTMLButtonElement>(`[data-setting-id="${id}"] .settings-reset`);
  try {
    await act(async () => root.render(createElement(WorkspaceEditorSettings)));
    expect(reset("auto-save")).toBeNull();
    expect(reset("format-on-save")).toBeNull();
    act(() => {
      saveAutosave(true);
      saveFormatOnSave(false);
    });
    expect(reset("auto-save")?.getAttribute("aria-label")).toBe("Restore default");
    await act(async () => reset("auto-save")!.click());
    await act(async () => reset("format-on-save")!.click());
    expect(loadAutosave()).toBe(AUTOSAVE_DEFAULT);
    expect(loadFormatOnSave()).toBe(FORMAT_ON_SAVE_DEFAULT);
    expect(reset("auto-save")).toBeNull();
    expect(reset("format-on-save")).toBeNull();
  } finally {
    act(() => root.unmount());
    container.remove();
    localStorage.clear();
    vi.unstubAllGlobals();
  }
});
