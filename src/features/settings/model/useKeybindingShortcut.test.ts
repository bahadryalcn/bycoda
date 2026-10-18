// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Button } from "../../../shared/ui/Button";
import { MOD } from "../../../platform/tauri/platform";
import { saveKeybindingOverride } from "./settings";
import { useKeybindingShortcut } from "./useKeybindingShortcut";

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
  localStorage.clear();
  const container = document.createElement("div");
  const root = createRoot(container);
  const command = "App: Switch Model";
  try {
    for (const native of [true, false]) {
      await act(async () => root.render(createElement(Action, { command, native })));
      const button = () => container.querySelector("button")!;
      expect(button().title).toBe(`Choose a model (${MOD}.)`);
      expect(button().getAttribute("aria-label")).toBe("Switch model");
      await act(async () => {
        saveKeybindingOverride(command, { shortcut: "Control+Shift+KeyM" });
      });
      expect(button().title).toContain("M)");
      expect(button().title).not.toContain(`${MOD}.)`);
      await act(async () => {
        saveKeybindingOverride(command, { disabled: true });
      });
      expect(button().title).toBe("Choose a model");
      await act(async () => {
        saveKeybindingOverride(command, {});
      });
      expect(button().title).toBe(`Choose a model (${MOD}.)`);
      await act(async () => {
        localStorage.setItem(
          "bycoda.keybindingOverrides",
          JSON.stringify({ [command]: { disabled: true } }),
        );
        window.dispatchEvent(new StorageEvent("storage", { key: "bycoda.keybindingOverrides" }));
      });
      expect(button().title).toBe("Choose a model");
      await act(async () => {
        saveKeybindingOverride(command, {});
      });
    }
  } finally {
    await act(async () => root.unmount());
    localStorage.clear();
    vi.unstubAllGlobals();
  }
});
