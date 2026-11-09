// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InfoPopover } from "./InfoPopover";

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const trigger = () => host.querySelector<HTMLButtonElement>("button")!;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
async function render(props: { label?: string; width?: number } = {}) {
  await act(async () =>
    root.render(createElement(InfoPopover, props, createElement("p", null, "Optional help text"))),
  );
}

it("names the icon-only trigger, announces it as a dialog opener and keeps help closed", async () => {
  await render({ label: "About limits" });
  expect(trigger().getAttribute("aria-label")).toBe("About limits");
  // The name doubles as the shared tooltip on hover/focus; no native title bubble.
  expect(trigger().hasAttribute("title")).toBe(false);
  await act(async () => {
    trigger().dispatchEvent(new Event("pointerover", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 520));
  });
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("About limits");
  await act(async () => {
    trigger().dispatchEvent(new Event("pointerout", { bubbles: true }));
  });
  expect(trigger().getAttribute("aria-haspopup")).toBe("dialog");
  expect(trigger().getAttribute("aria-expanded")).toBe("false");
  expect(trigger().hasAttribute("aria-controls")).toBe(false);
  expect(dialog()).toBeNull();
});

it("falls back to a translated Help name when none is supplied", async () => {
  await render();
  expect(trigger().getAttribute("aria-label")).toBe("Help");
});

it("opens from a plain click (touch tap or Enter/Space on the native button) and toggles closed", async () => {
  await render({ label: "About limits" });
  await act(async () => trigger().click());
  const popup = dialog()!;
  expect(popup).not.toBeNull();
  expect(popup.getAttribute("aria-label")).toBe("About limits");
  expect(popup.textContent).toContain("Optional help text");
  expect(trigger().getAttribute("aria-expanded")).toBe("true");
  expect(trigger().getAttribute("aria-controls")).toBe(popup.id);
  await act(async () => trigger().click());
  expect(dialog()).toBeNull();
  expect(trigger().getAttribute("aria-expanded")).toBe("false");
});

it("scrolls long help inside the available height instead of clipping its last lines", async () => {
  await render({ label: "About limits" });
  await act(async () => trigger().click());
  const popup = dialog()!;
  expect(popup.getAttribute("data-popover-flow")).toBe("scroll");
  expect(popup.style.overflowY).toBe("auto");
});

it("moves focus into the help dialog and returns it to the trigger on Escape", async () => {
  await render({ label: "About limits" });
  trigger().focus();
  await act(async () => trigger().click());
  const popup = dialog()!;
  expect(popup.getAttribute("tabindex")).toBe("-1");
  expect(document.activeElement).toBe(popup);
  await act(async () => {
    popup.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  });
  expect(dialog()).toBeNull();
  expect(document.activeElement).toBe(trigger());
});

it("closes on an outside press without reopening from the trigger", async () => {
  await render({ label: "About limits" });
  await act(async () => trigger().click());
  expect(dialog()).not.toBeNull();
  await act(async () => {
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  });
  expect(dialog()).toBeNull();
});
