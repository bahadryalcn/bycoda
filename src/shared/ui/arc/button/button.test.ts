// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Button } from "./button";
import styles from "./button.module.css";

let root: Root;
let container: HTMLDivElement;
const observe = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = observe;
      disconnect() {}
    },
  );
  observe.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const render = (props: Record<string, unknown>, label = "Save") =>
  act(() => root.render(createElement(Button, props, label)));
const button = () => container.querySelector("button")!;

it("keeps a label that never changes out of the presence layer", () => {
  render({});
  const phase = container.querySelector(`.${styles.labelPhase}`)!;
  expect(phase.tagName).toBe("SPAN");
  expect(phase.getAttribute("style")).toBeNull();
  render({});
  expect(container.querySelector(`.${styles.labelPhase}`)).toBe(phase);
});

it("still crossfades the first label change through the presence layer", () => {
  render({}, "Copy");
  render({}, "Copied");
  const outgoing = [...container.querySelectorAll('[aria-hidden="true"]')].find((node) => node.textContent === "Copy");
  expect(outgoing).toBeTruthy();
  expect(button().textContent).toContain("Copied");
});

it("renders a plain button that presses through the stylesheet", () => {
  render({});
  expect(button().classList.contains(styles.pressable)).toBe(true);
  // An idle button observes nothing and mounts no loader layer.
  expect(observe).not.toHaveBeenCalled();
  expect(container.querySelector(`.${styles.loader}`)).toBeNull();
});

it("never scales popup anchors or controls that cannot act", () => {
  render({ "aria-haspopup": "menu" });
  expect(button().classList.contains(styles.pressable)).toBe(false);
  render({ disabled: true });
  expect(button().classList.contains(styles.pressable)).toBe(false);
  render({ loading: true });
  expect(button().classList.contains(styles.pressable)).toBe(false);
});

it("shows the loader while loading and keeps the button focusable", () => {
  render({});
  render({ loading: true });
  expect(container.querySelector(`.${styles.loader}`)).not.toBeNull();
  expect(button().disabled).toBe(false);
  expect(button().getAttribute("aria-busy")).toBe("true");
  expect(button().getAttribute("aria-disabled")).toBe("true");
});

it("swallows presses while loading", () => {
  const onClick = vi.fn();
  render({ loading: true, onClick });
  act(() => button().click());
  expect(onClick).not.toHaveBeenCalled();
  render({ onClick });
  act(() => button().click());
  expect(onClick).toHaveBeenCalledOnce();
});

it("swaps its label in place", () => {
  render({}, "Copy");
  render({}, "Copied");
  expect(button().textContent).toContain("Copied");
});
