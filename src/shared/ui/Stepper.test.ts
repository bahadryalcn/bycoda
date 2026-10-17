// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { Stepper } from "./Stepper";
let root: Root;
let container: HTMLDivElement;
const steps = ["Workspace", "Appearance", "Agents", "Connections", "Projects"].map((label) => ({
  id: label,
  label,
}));
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("keeps independent visited completion while current moves backwards and allows explicit future navigation", async () => {
  const select = vi.fn();
  await act(async () =>
    root.render(
      createElement(Stepper, {
        steps,
        current: 1,
        completed: ["Workspace", "Connections"],
        selectable: "all",
        onStepSelect: select,
        label: "Getting started",
      }),
    ),
  );
  const rows = container.querySelectorAll("li");
  expect(rows[1].getAttribute("aria-current")).toBe("step");
  expect(rows[3].getAttribute("data-status")).toBe("complete");
  expect(rows[2].getAttribute("data-status")).toBe("upcoming");
  const future = rows[4].querySelector("button")!;
  await act(async () => future.click());
  expect(select).toHaveBeenCalledExactlyOnceWith(4);
  expect(rows[1].getAttribute("aria-current")).toBe("step");
});

it("moves keyboard focus through reachable steps and respects IME and busy gates", async () => {
  const select = vi.fn();
  await act(async () =>
    root.render(
      createElement(Stepper, {
        steps,
        current: 3,
        completed: ["Workspace", "Agents"],
        selectable: ["Workspace", "Agents"],
        onStepSelect: select,
      }),
    ),
  );
  const buttons = container.querySelectorAll("button");
  buttons[0].focus();
  await act(async () =>
    buttons[0].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })),
  );
  expect(document.activeElement).toBe(buttons[2]);
  await act(async () =>
    buttons[2].dispatchEvent(
      new KeyboardEvent("keydown", { key: "Home", bubbles: true, isComposing: true }),
    ),
  );
  expect(document.activeElement).toBe(buttons[2]);
  await act(async () => buttons[3].click());
  expect(select).not.toHaveBeenCalled();
  await act(async () =>
    root.render(
      createElement(Stepper, {
        steps,
        current: 3,
        selectable: "all",
        onStepSelect: select,
        disabled: true,
      }),
    ),
  );
  expect(Array.from(buttons).every((button) => button.disabled)).toBe(true);
  await act(async () => buttons[0].click());
  expect(select).not.toHaveBeenCalled();
});

it("preserves the default linear completed-only selection and read-only guide ownership", async () => {
  const select = vi.fn();
  await act(async () =>
    root.render(createElement(Stepper, { steps, current: 2, onStepSelect: select })),
  );
  const buttons = container.querySelectorAll("button");
  await act(async () => {
    buttons[0].click();
    buttons[3].click();
  });
  expect(select).toHaveBeenCalledExactlyOnceWith(0);
  await act(async () =>
    root.render(createElement(Stepper, { steps, current: 5, completeLabel: "Done" })),
  );
  expect(container.querySelector("button")).toBeNull();
  expect(container.querySelectorAll('[data-status="complete"]')).toHaveLength(5);
  expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe("Done");
});
