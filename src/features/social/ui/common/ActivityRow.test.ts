// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ActivityRow, type ActivityRowProps } from "./ActivityRow";

let element: HTMLDivElement, root: Root;

beforeEach(() => {
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});

afterEach(() => {
  act(() => root.unmount());
  element.remove();
});

function render(props: Partial<ActivityRowProps> = {}) {
  act(() =>
    root.render(
      createElement(ActivityRow, {
        title: "Launch post",
        time: "10:30",
        status: "succeeded",
        ...props,
      }),
    ),
  );
}

function buttonWithText(text: string): HTMLButtonElement | undefined {
  return [...element.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
}

it("calls onUndo when undo is possible", () => {
  const onUndo = vi.fn();
  render({ undo: { onUndo } });
  expect(buttonWithText("Undo")?.disabled).toBe(false);
  act(() => buttonWithText("Undo")?.click());
  expect(onUndo).toHaveBeenCalledTimes(1);
});

it("keeps Undo visible and disabled, with the blocked reason as its description", () => {
  const onUndo = vi.fn();
  render({ undo: { onUndo, blockedReason: "The post is already live elsewhere." } });
  expect(buttonWithText("Undo")?.getAttribute("aria-disabled")).toBe("true");
  expect(buttonWithText("Undo")?.getAttribute("aria-description")).toBe(
    "The post is already live elsewhere.",
  );
  act(() => buttonWithText("Undo")?.click());
  expect(onUndo).not.toHaveBeenCalled();
});

it("shows no Undo button when the entry has no undo, and no passive reason in the row", () => {
  render();
  expect(buttonWithText("Undo")).toBeUndefined();
  expect(element.textContent).not.toContain("Can't be undone.");
});

it("shows the plain status word and reveals details on demand", () => {
  render({ status: "failed", details: "Provider said no." });
  expect(element.textContent).toContain("Failed");
  expect(element.textContent).not.toContain("Provider said no.");
  const details = buttonWithText("Details");
  act(() => details?.click());
  expect(element.textContent).toContain("Provider said no.");
  expect(details?.getAttribute("aria-expanded")).toBe("true");
});

it("draws the status circle for the operation kind and keeps the meta line before the time", () => {
  render({ kind: "reply", meta: "Acme" });
  expect(element.querySelector(".social-activity-icon svg")).not.toBeNull();
  expect(element.querySelector(".social-activity-meta")?.textContent).toBe("Acme10:30");
});
