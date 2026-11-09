// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ScreenHeader } from "./ScreenHeader";

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

it("renders the title and one enabled primary action", () => {
  const onClick = vi.fn();
  act(() =>
    root.render(
      createElement(ScreenHeader, {
        title: "Content",
        primary: { label: "New post", onClick },
      }),
    ),
  );
  expect(element.querySelector("h2")?.textContent).toBe("Content");
  const primary = element.querySelector("button");
  expect(primary?.textContent?.trim()).toBe("New post");
  act(() => primary?.click());
  expect(onClick).toHaveBeenCalledTimes(1);
  expect(element.querySelector('[aria-label="More actions"]')).toBeNull();
});

it("shows a disabled primary action with its reason", () => {
  act(() =>
    root.render(
      createElement(ScreenHeader, {
        title: "Content",
        primary: {
          label: "Publish",
          onClick: () => undefined,
          disabled: true,
          disabledReason: "Add text first.",
        },
      }),
    ),
  );
  expect(element.querySelector("button")?.disabled).toBe(true);
  expect(element.textContent).toContain("Add text first.");
});

it("puts secondary actions behind one overflow trigger", () => {
  act(() =>
    root.render(
      createElement(ScreenHeader, {
        title: "Accounts",
        secondary: [{ id: "export", label: "Export", onSelect: () => undefined }],
      }),
    ),
  );
  const trigger = element.querySelector('[aria-label="More actions"]');
  expect(trigger).not.toBeNull();
  expect(trigger?.getAttribute("aria-expanded")).toBe("false");
  expect(element.querySelectorAll("button")).toHaveLength(1);
});

it("shows the description and keeps one primary beside one overflow trigger", () => {
  act(() =>
    root.render(
      createElement(ScreenHeader, {
        title: "Accounts",
        description: "Connected accounts and what AI may do.",
        primary: { label: "Connect account", onClick: () => undefined },
        secondary: [{ id: "export", label: "Export", onSelect: () => undefined }],
      }),
    ),
  );
  expect(element.textContent).toContain("Connected accounts and what AI may do.");
  const buttons = [...element.querySelectorAll("button")];
  expect(buttons.map((b) => b.getAttribute("aria-label") ?? b.textContent?.trim())).toEqual([
    "Connect account",
    "More actions",
  ]);
});

it("does not run a disabled primary action", () => {
  const onClick = vi.fn();
  act(() =>
    root.render(
      createElement(ScreenHeader, {
        title: "Content",
        primary: { label: "Publish", onClick, disabled: true, disabledReason: "Add text first." },
      }),
    ),
  );
  act(() => element.querySelector("button")?.click());
  expect(onClick).not.toHaveBeenCalled();
});
