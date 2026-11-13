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

/** Hovers a control until the shared tooltip opens and returns its text (key caps included). */
async function tooltipText(element: HTMLElement): Promise<string> {
  await act(async () => {
    element.dispatchEvent(new Event("pointerover", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 520));
  });
  const text = document.querySelector('[role="tooltip"]')?.textContent ?? "";
  await act(async () => {
    element.dispatchEvent(new Event("pointerout", { bubbles: true }));
  });
  return text;
}
/** Key caps render without the "+" joiner. */
const CAPS = MOD.replace("+", "");

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
    await act(() => {
      button("Back").click();
      button("Forward").click();
    });
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
  // jsdom has no ResizeObserver; the shared tooltip's Popover observes its frame.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
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
    // Hints ride in the shared tooltip (label plus key caps), never a native title.
    expect(button("Toggle Projects").title).toBe("");
    expect(await tooltipText(button("Toggle Projects"))).toBe(`Toggle Projects${CAPS}B`);
    expect(await tooltipText(button("Back"))).toBe(`Back${CAPS}[`);
    expect(await tooltipText(button("Forward"))).toBe(`Forward${CAPS}]`);
    // The rail rows show their shortcut as visible text and in the shared tooltip, never a native title.
    expect(button("Search").title).toBe("");
    expect(button("Search").textContent).toContain(`${MOD}K`);
    expect(button("Settings").title).toBe("");
    expect(button("Settings").textContent).toContain(`${MOD},`);

    for (const [command, label] of [
      ["App: Toggle Sidebar", "Toggle Projects"],
      ["Tab: Back", "Back"],
      ["App: Search", "Search"],
      ["App: Settings", "Settings"],
    ]) {
      await act(async () => {
        saveKeybindingOverride(command, { shortcut: "Control+Option+Shift+KeyM" });
      });
      const railRow = label === "Search" || label === "Settings";
      if (!railRow) expect(await tooltipText(button(label))).toMatch(/M$/);
      expect(button(label).getAttribute("aria-label")).toBe(label);
      if (label === "Search" || label === "Settings")
        expect(button(label).textContent).toContain("M");
      await act(async () => {
        saveKeybindingOverride(command, { disabled: true });
      });
      expect(button(label).title).toBe("");
      if (!railRow) expect(await tooltipText(button(label))).toBe(label);
      if (railRow) expect(button(label).textContent).not.toContain("M");
      await act(async () => {
        saveKeybindingOverride(command, {});
      });
    }
    await act(async () => button("Toggle Projects").click());
    expect(toggle).toHaveBeenCalledOnce();
    expect(await tooltipText(button("Toggle Projects"))).toBe(`Toggle Projects${CAPS}B`);
  } finally {
    await act(async () => root.unmount());
    localStorage.clear();
    vi.unstubAllGlobals();
  }
});
