// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCompactRailDrawer } from "./useCompactRailDrawer";

let root: Root;
let container: HTMLDivElement;
let drawer!: ReturnType<typeof useCompactRailDrawer>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  function Harness() {
    drawer = useCompactRailDrawer({
      compactRailVisible: true,
      open: false,
      sidebarAvailable: true,
    });
    return null;
  }
  act(() => root.render(createElement(Harness)));
  act(() => drawer.setDrawerOpen(true));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function escape(init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
    ...init,
  });
  act(() => {
    window.dispatchEvent(event);
  });
}

// Issue #1248: Escape that cancels an IME candidate or was already consumed is not a dismissal.
it("keeps the drawer open for an IME-composing or already-handled Escape", () => {
  expect(drawer.drawerVisible).toBe(true);
  escape({ isComposing: true });
  expect(drawer.drawerVisible).toBe(true);
  escape({ keyCode: 229 });
  expect(drawer.drawerVisible).toBe(true);
});

it("dismisses the drawer on a plain Escape", () => {
  escape();
  expect(drawer.drawerVisible).toBe(false);
});
