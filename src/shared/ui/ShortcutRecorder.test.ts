// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ShortcutKbd } from "./ShortcutKbd";
import { ShortcutRecorder } from "./ShortcutRecorder";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const press = (target: Element, init: KeyboardEventInit) =>
  act(async () => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
    );
  });
const recorder = () => container.querySelector<HTMLButtonElement>("button[aria-pressed]")!;
const status = () => container.querySelector('[role="status"]')!.textContent;

it("shows a distinct recording state, announces it, and Escape cancels without changing the value", async () => {
  const change = vi.fn();
  await act(async () =>
    root.render(
      createElement(ShortcutRecorder, {
        label: "Open palette",
        platform: "other",
        defaultValue: "mod+k",
        onValueChange: change,
      }),
    ),
  );
  const control = container.querySelector("[data-state]")!;
  expect(control.getAttribute("data-state")).toBe("idle");
  await act(async () => recorder().click());
  expect(control.getAttribute("data-state")).toBe("recording");
  expect(recorder().getAttribute("aria-pressed")).toBe("true");
  expect(status()).toContain("Esc cancels");
  await press(recorder(), { key: "Escape", code: "Escape" });
  expect(control.getAttribute("data-state")).toBe("idle");
  expect(recorder().getAttribute("aria-pressed")).toBe("false");
  expect(status()).toBe("Recording canceled");
  expect(change).not.toHaveBeenCalled();
});

it("records Ctrl+K as the platform key caps and reports the committed shortcut", async () => {
  const change = vi.fn();
  await act(async () =>
    root.render(
      createElement(ShortcutRecorder, {
        label: "Open palette",
        platform: "other",
        onValueChange: change,
      }),
    ),
  );
  await act(async () => recorder().click());
  await press(recorder(), { key: "k", code: "KeyK", ctrlKey: true });
  expect(change).toHaveBeenCalledWith("mod+k", { replaced: undefined });
  const caps = [...container.querySelectorAll("kbd")].map((cap) => cap.textContent);
  expect(caps).toEqual(["Ctrl", "K"]);
});

it("asks before taking a bound shortcut and keeps the old value when canceled", async () => {
  const change = vi.fn();
  await act(async () =>
    root.render(
      createElement(ShortcutRecorder, {
        label: "Open palette",
        platform: "other",
        defaultValue: "mod+p",
        bindings: [{ shortcut: "mod+k", label: "Search files" }],
        onValueChange: change,
      }),
    ),
  );
  await act(async () => recorder().click());
  await press(recorder(), { key: "k", code: "KeyK", ctrlKey: true });
  expect(container.querySelector("[data-state]")!.getAttribute("data-state")).toBe("conflict");
  expect(change).not.toHaveBeenCalled();
  const buttons = [...container.querySelectorAll<HTMLButtonElement>("button")];
  const use = buttons.find((button) => button.textContent === "Use anyway")!;
  const cancel = buttons.find((button) => button.textContent === "Cancel")!;
  // Both are shared Buttons, so they carry the Button hierarchy/tone attributes and a real focus state.
  expect(use.getAttribute("data-button-tone")).toBe("warning");
  expect(cancel.getAttribute("data-button-hierarchy")).toBe("ghost");
  await act(async () => cancel.click());
  expect(change).not.toHaveBeenCalled();
  expect(container.querySelector("[data-state]")!.getAttribute("data-state")).toBe("idle");
});

it("renders a key cap as a tabular kbd element that forwards its ref and props", async () => {
  await act(async () =>
    root.render(
      createElement(ShortcutKbd, { size: "sm", pressed: true, "aria-label": "Enter" }, "↩"),
    ),
  );
  const cap = container.querySelector("kbd")!;
  expect(cap.textContent).toBe("↩");
  expect(cap.getAttribute("data-size")).toBe("sm");
  expect(cap.hasAttribute("data-pressed")).toBe(true);
  expect(cap.getAttribute("aria-label")).toBe("Enter");
});
