// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ExpandableCard } from "./ExpandableCard";

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

it("exposes the header as one disclosure button wired to its panel, and keeps closed details inert", async () => {
  await act(async () =>
    root.render(
      createElement(
        ExpandableCard,
        { title: "Advanced", description: "3 options" },
        createElement("p", null, "Details"),
      ),
    ),
  );
  const header = container.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
  expect(header.type).toBe("button");
  expect(header.textContent).toContain("Advanced");
  const panel = container.querySelector<HTMLElement>(
    `#${CSS.escape(header.getAttribute("aria-controls")!)}`,
  )!;
  expect(header.getAttribute("aria-expanded")).toBe("false");
  expect(panel.hasAttribute("inert")).toBe(true);
  await act(async () => header.click());
  expect(header.getAttribute("aria-expanded")).toBe("true");
  expect(panel.hasAttribute("inert")).toBe(false);
});

it("closes on Escape from inside the details and returns focus to the header", async () => {
  await act(async () =>
    root.render(
      createElement(
        ExpandableCard,
        { title: "Advanced", defaultExpanded: true },
        createElement("button", { type: "button" }, "Inside"),
      ),
    ),
  );
  const header = container.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
  const inside = [...container.querySelectorAll("button")].find(
    (node) => node.textContent === "Inside",
  )!;
  await act(async () => {
    inside.focus();
    inside.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  });
  expect(header.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(header);
});
