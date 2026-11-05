// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import {
  loadWorkspaceBackground,
  saveWorkspaceBackground,
  WORKSPACE_BACKGROUND_DEFAULT,
} from "../model/workspaceBackground";
import { retryAppearanceSave } from "../model/appearancePersistence";
import { GradientBackgroundCard } from "./GradientBackgroundCard";
import { RevealedSetting } from "./settingsControls";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it("opens the advanced section for a revealed gradient setting", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        createElement(
          RevealedSetting.Provider,
          { value: "workspace-gradient-angle" },
          createElement(GradientBackgroundCard),
        ),
      ),
    );
    const row = host.querySelector('[data-setting-id="workspace-gradient-angle"]');
    expect(row).not.toBeNull();
    expect(row?.closest(".settings-advanced")?.hasAttribute("data-open")).toBe(true);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("selects a preset and retains its colors when toggled off and on", async () => {
  localStorage.clear();
  saveWorkspaceBackground(WORKSPACE_BACKGROUND_DEFAULT);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(GradientBackgroundCard)));
    const ocean = [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((button) =>
      button.textContent?.includes("Ocean"),
    );
    expect(ocean).toBeDefined();
    await act(async () => ocean!.click());
    const colors = [...loadWorkspaceBackground().colors];
    expect(loadWorkspaceBackground().enabled).toBe(true);
    const toggle = host.querySelector<HTMLButtonElement>('[role="switch"]');
    expect(toggle).not.toBeNull();
    await act(async () => toggle!.click());
    expect(loadWorkspaceBackground()).toMatchObject({ enabled: false, colors });
    await act(async () => toggle!.click());
    expect(loadWorkspaceBackground()).toMatchObject({ enabled: true, colors });
    const advanced = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("Customize background"),
    );
    expect(advanced).toBeDefined();
    await act(async () => advanced!.click());
    const radial = [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((button) =>
      button.textContent?.includes("Radial"),
    );
    const savedAngle = loadWorkspaceBackground().angle;
    expect(radial).toBeDefined();
    await act(async () => radial!.click());
    const angleRow = [...host.querySelectorAll<HTMLElement>(".settings-row")].find((row) =>
      row.textContent?.includes("Gradient angle"),
    );
    expect(angleRow?.hasAttribute("data-disabled")).toBe(true);
    expect(angleRow?.querySelector('[role="slider"]')?.getAttribute("aria-disabled")).toBe("true");
    expect(loadWorkspaceBackground().angle).toBe(savedAngle);
    const color = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("Color 1"),
    );
    expect(color).toBeDefined();
    await act(async () => color!.click());
    expect(document.querySelector('input[aria-label="Hex color"]')).not.toBeNull();
    expect(loadWorkspaceBackground()).toMatchObject({ enabled: true, colors });
  } finally {
    await act(async () => root.unmount());
    host.remove();
    saveWorkspaceBackground(WORKSPACE_BACKGROUND_DEFAULT);
  }
});

it("keeps a conflicting draft until the user explicitly applies it", async () => {
  const key = "bycoda.workspaceBackground.v1";
  localStorage.clear();
  saveWorkspaceBackground(WORKSPACE_BACKGROUND_DEFAULT, { replace: true });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(GradientBackgroundCard)));
    const write = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("disk full");
    });
    await act(async () =>
      saveWorkspaceBackground({ ...WORKSPACE_BACKGROUND_DEFAULT, enabled: true, style: "mesh" }),
    );
    write.mockRestore();
    const sibling = JSON.stringify({ ...WORKSPACE_BACKGROUND_DEFAULT, style: "radial" });
    localStorage.setItem(key, sibling);
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key, newValue: sibling }));
      retryAppearanceSave(key);
    });
    expect(localStorage.getItem(key)).toBe(sibling);
    expect(host.textContent).toContain("Your unsaved changes are still here");
    const apply = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("Apply my background"),
    );
    expect(apply).toBeDefined();
    await act(async () => apply!.click());
    expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({ enabled: true, style: "mesh" });
    expect(host.textContent).not.toContain("Your unsaved changes are still here");
  } finally {
    vi.restoreAllMocks();
    await act(async () => root.unmount());
    host.remove();
    saveWorkspaceBackground(WORKSPACE_BACKGROUND_DEFAULT, { replace: true });
  }
});

it("reports an unreadable saved background without claiming it was saved", async () => {
  localStorage.clear();
  saveWorkspaceBackground(WORKSPACE_BACKGROUND_DEFAULT, { replace: true });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(GradientBackgroundCard)));
    const read = vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("unavailable");
    });
    await act(async () =>
      saveWorkspaceBackground({ ...WORKSPACE_BACKGROUND_DEFAULT, enabled: true }),
    );
    expect(host.textContent).toContain("The saved workspace background could not be read");
    expect(host.textContent).not.toContain("Apply my background");
    read.mockRestore();
  } finally {
    vi.restoreAllMocks();
    await act(async () => root.unmount());
    host.remove();
    saveWorkspaceBackground(WORKSPACE_BACKGROUND_DEFAULT, { replace: true });
  }
});

it("explains when accessibility settings hide an enabled background and tracks changes", async () => {
  localStorage.clear();
  saveWorkspaceBackground({ ...WORKSPACE_BACKGROUND_DEFAULT, enabled: true }, { replace: true });
  const listeners = new Map<string, () => void>();
  let reduced = false;
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() {
      return query.includes("reduced-transparency") && reduced;
    },
    addEventListener: (_type: string, listener: () => void) => listeners.set(query, listener),
    removeEventListener: (_type: string) => listeners.delete(query),
  }));
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(GradientBackgroundCard)));
    expect(host.textContent).not.toContain(
      "Your accessibility settings hide workspace backgrounds",
    );
    await act(async () => {
      reduced = true;
      listeners.get("(prefers-reduced-transparency: reduce)")?.();
    });
    expect(host.textContent).toContain("Your accessibility settings hide workspace backgrounds");
    expect(loadWorkspaceBackground().enabled).toBe(true);
    await act(async () => {
      reduced = false;
      listeners.get("(prefers-reduced-transparency: reduce)")?.();
    });
    expect(host.textContent).not.toContain(
      "Your accessibility settings hide workspace backgrounds",
    );
  } finally {
    await act(async () => root.unmount());
    expect(listeners.size).toBe(0);
    host.remove();
    vi.unstubAllGlobals();
    saveWorkspaceBackground(WORKSPACE_BACKGROUND_DEFAULT, { replace: true });
  }
});
