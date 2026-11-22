// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { DropdownMenu } from "./DropdownMenu";

vi.mock("../lib/observeResize", () => ({ observeResize: () => () => {} }));
vi.mock("./Popover", () => ({
  popupListClassName: "",
  Popover: ({
    minWidth,
    children,
    "aria-activedescendant": activeDescendant,
  }: {
    minWidth: number;
    children: React.ReactNode;
    "aria-activedescendant"?: string;
  }) =>
    createElement(
      "div",
      { role: "menu", "data-min-width": minWidth, "aria-activedescendant": activeDescendant },
      children,
    ),
}));

const items = [
  { kind: "item" as const, id: "one", label: "One" },
  { kind: "item" as const, id: "two", label: "Two", disabled: true },
  { kind: "item" as const, id: "three", label: "Three" },
];

function press(key: string) {
  return act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

it("maps size to the Popover rem steps", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(DropdownMenu, {
        anchor: container,
        label: "Menu",
        items,
        size: "md",
        onPick: vi.fn(),
        onClose: vi.fn(),
      }),
    ),
  );
  expect(container.querySelector("[data-min-width]")?.getAttribute("data-min-width")).toBe("280");
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("highlight=state moves by window keys while focus stays outside the menu", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onPick = vi.fn();
  await act(async () =>
    root.render(
      createElement(DropdownMenu, {
        anchor: container,
        label: "Menu",
        items,
        highlight: "state",
        onPick,
        onClose: vi.fn(),
      }),
    ),
  );
  const menu = () => container.querySelector<HTMLElement>('[role="menu"]')!;
  const rowId = (label: string) =>
    [...container.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((row) =>
      row.textContent?.includes(label),
    )!.id;
  expect(menu().getAttribute("aria-activedescendant")).toBe(rowId("One"));
  // The disabled row is skipped.
  await press("ArrowDown");
  expect(menu().getAttribute("aria-activedescendant")).toBe(rowId("Three"));
  await press("Enter");
  expect(onPick).toHaveBeenCalledWith("three");
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
