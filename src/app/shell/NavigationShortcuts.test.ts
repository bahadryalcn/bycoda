// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { MOD } from "../../platform/tauri/platform";
import { saveKeybindingOverride } from "../../features/settings/model/settings";
import { OverlayNav, TabVisitNav } from "./TitleBar";
import { ToolNavigationContext } from "./ToolNavigation";
import { RailAction, RailSearch } from "./RailAction";
import { Search } from "../../shared/ui/icons";

it("uses the tool window history for both overlay arrows and disables empty directions", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  const back = vi.fn();
  const forward = vi.fn();
  const close = vi.fn();
  const draw = (canBack: boolean, canForward: boolean) =>
    root.render(
      createElement(
        ToolNavigationContext.Provider,
        {
          value: {
            active: "notes",
            cwd: "/repo",
            notesEnabled: true,
            onSelect: vi.fn(),
            history: { canBack, canForward, onBack: back, onForward: forward },
          },
        },
        createElement(OverlayNav, { onBack: close }),
      ),
    );
  const button = (label: string) =>
    container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
  try {
    await act(() => draw(false, false));
    expect(button("Back").getAttribute("aria-disabled")).toBe("true");
    expect(button("Forward").getAttribute("aria-disabled")).toBe("true");
    await act(() => { button("Back").click(); button("Forward").click(); });
    expect(back).not.toHaveBeenCalled();
    expect(forward).not.toHaveBeenCalled();
    await act(() => draw(true, true));
    await act(() => {
      button("Back").click();
      button("Forward").click();
    });
    expect(back).toHaveBeenCalledOnce();
    expect(forward).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
  } finally {
    await act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("shows live bindings on the projects toggle, history and rail actions without changing their accessible names or clicks", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  const container = document.createElement("div");
  const root = createRoot(container);
  const toggle = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(
          "div",
          null,
          createElement(TabVisitNav, {
            onTogglePanel: toggle,
            canGoBack: true,
            canGoForward: true,
          }),
          createElement(RailSearch, {
            label: "Search",
            icon: Search,
            command: "App: Search",
            onClick: vi.fn(),
          }),
          createElement(RailAction, {
            label: "Settings",
            icon: Search,
            command: "App: Settings",
            onClick: vi.fn(),
          }),
        ),
      ),
    );
    const button = (label: string) =>
      container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
    expect(button("Toggle Projects").title).toBe(`Toggle Projects (${MOD}B)`);
    expect(button("Back").title).toBe(`Back (${MOD}[)`);
    expect(button("Forward").title).toBe(`Forward (${MOD}])`);
    expect(button("Search").title).toBe(`Search (${MOD}K)`);
    expect(button("Settings").title).toBe(`Settings (${MOD},)`);

    for (const [command, label] of [
      ["App: Toggle Sidebar", "Toggle Projects"],
      ["Tab: Back", "Back"],
      ["App: Search", "Search"],
      ["App: Settings", "Settings"],
    ]) {
      await act(async () => {
        saveKeybindingOverride(command, { shortcut: "Control+Shift+KeyM" });
      });
      expect(button(label).title).toMatch(/M\)$/);
      expect(button(label).getAttribute("aria-label")).toBe(label);
      if (label === "Search" || label === "Settings")
        expect(button(label).textContent).toContain("M");
      await act(async () => {
        saveKeybindingOverride(command, { disabled: true });
      });
      expect(button(label).title).toBe(label);
      if (label === "Search" || label === "Settings")
        expect(button(label).textContent).not.toContain("M");
      await act(async () => {
        saveKeybindingOverride(command, {});
      });
    }
    await act(async () => button("Toggle Projects").click());
    expect(toggle).toHaveBeenCalledOnce();
    expect(button("Toggle Projects").title).toBe(`Toggle Projects (${MOD}B)`);
  } finally {
    await act(async () => root.unmount());
    localStorage.clear();
    vi.unstubAllGlobals();
  }
});
