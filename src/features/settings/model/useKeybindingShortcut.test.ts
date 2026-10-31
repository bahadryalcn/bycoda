// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Button } from "../../../shared/ui/Button";
import { MOD } from "../../../platform/tauri/platform";
import { saveKeybindingOverride } from "./settings";
import { useKeybindingShortcut } from "./useKeybindingShortcut";

/** The modifier as its key cap reads in the tooltip (`Ctrl+` renders as the cap `Ctrl`). */
const MOD_CAP = MOD.replace(/\+$/, "");

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

function Action({ command, native }: { command: string; native: boolean }) {
  const shortcut = useKeybindingShortcut(command);
  return createElement(Button, {
    iconOnly: true,
    label: "Switch model",
    tooltip: "Choose a model",
    motion: native ? "none" : "auto",
    shortcut,
  });
}

it("updates native and Arc tooltips immediately after rebind, disable, reset and external storage changes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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
  const command = "App: Switch Model";
  try {
    for (const native of [true, false]) {
      await act(async () => root.render(createElement(Action, { command, native })));
      const button = () => container.querySelector("button")!;
      expect(button().getAttribute("title")).toBeNull();
      expect(await tooltipText(button())).toBe(`Choose a model${MOD_CAP}.`);
      expect(button().getAttribute("aria-label")).toBe("Switch model");
      await act(async () => {
        saveKeybindingOverride(command, { shortcut: "Control+Shift+KeyM" });
      });
      const rebound = await tooltipText(button());
      expect(rebound).toMatch(/^Choose a model.*M$/);
      expect(rebound).not.toContain(".");
      await act(async () => {
        saveKeybindingOverride(command, { disabled: true });
      });
      expect(await tooltipText(button())).toBe("Choose a model");
      await act(async () => {
        saveKeybindingOverride(command, {});
      });
      expect(await tooltipText(button())).toBe(`Choose a model${MOD_CAP}.`);
      await act(async () => {
        localStorage.setItem(
          "bycoda.keybindingOverrides",
          JSON.stringify({ [command]: { disabled: true } }),
        );
        window.dispatchEvent(new StorageEvent("storage", { key: "bycoda.keybindingOverrides" }));
      });
      expect(await tooltipText(button())).toBe("Choose a model");
      await act(async () => {
        saveKeybindingOverride(command, {});
      });
    }
  } finally {
    await act(async () => root.unmount());
    localStorage.clear();
    vi.unstubAllGlobals();
  }
  // Ten tooltip hovers at the real 450 ms open delay.
}, 20_000);
