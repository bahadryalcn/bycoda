// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PickerList } from "./PickerList";
import type { PickerOption } from "./usePickerList";

const VIEWPORT = 320;
const ROW = 32;

let root: Root;
let container: HTMLDivElement;
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
  const sized = (element: HTMLElement) =>
    element.getAttribute("role") === "listbox" ? VIEWPORT : ROW;
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return sized(this);
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(280);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    return new DOMRect(0, 0, 280, sized(this));
  });
  vi.spyOn(HTMLElement.prototype, "scrollTo").mockImplementation(function (
    this: HTMLElement,
    options?: ScrollToOptions | number,
  ) {
    if (typeof options !== "object") return;
    this.scrollTop = options.top ?? 0;
    this.dispatchEvent(new Event("scroll"));
  });
  Element.prototype.scrollIntoView = vi.fn();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const branches = (count: number): PickerOption[] =>
  Array.from({ length: count }, (_, index) => ({
    value: `b${index}`,
    title: `branch-${index}`,
    group: index < count / 2 ? "Local" : "Remote",
  }));

const keyDown = (element: Element, key: string) =>
  act(async () => {
    element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });

it("mounts only the rows near the viewport of a long grouped list and keeps the group names", async () => {
  await act(async () =>
    root.render(
      createElement(PickerList, {
        label: "Branches",
        options: branches(2000),
        value: "b0",
        onChange: () => undefined,
      }),
    ),
  );
  const rows = container.querySelectorAll<HTMLElement>('[role="option"]');
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.length).toBeLessThan(60);
  expect(rows[0]!.getAttribute("aria-setsize")).toBe("2000");
  expect(rows[0]!.getAttribute("aria-posinset")).toBe("1");
  expect(container.querySelector('[role="group"]')?.getAttribute("aria-label")).toBe("Local");
  expect(container.querySelector("[aria-hidden]")).not.toBeNull();
});

it("keeps short lists fully mounted without window attributes", async () => {
  await act(async () =>
    root.render(
      createElement(PickerList, {
        label: "Branches",
        options: branches(20),
        value: "b0",
        onChange: () => undefined,
      }),
    ),
  );
  expect(container.querySelectorAll('[role="option"]')).toHaveLength(20);
  expect(container.querySelector('[role="option"]')!.hasAttribute("aria-setsize")).toBe(false);
});

it("brings an unmounted row into the window for End and commits it with Enter", async () => {
  const onChange = vi.fn();
  await act(async () =>
    root.render(
      createElement(PickerList, {
        label: "Branches",
        options: branches(2000),
        value: "b0",
        onChange,
        autoFocus: true,
      }),
    ),
  );
  const list = container.querySelector('[role="listbox"]')!;
  expect(document.querySelector('[id$="-option-b1999"]')).toBeNull();
  await keyDown(list, "End");
  const last = document.querySelector<HTMLElement>('[id$="-option-b1999"]');
  expect(last).not.toBeNull();
  expect(last!.getAttribute("aria-posinset")).toBe("2000");
  expect(list.getAttribute("aria-activedescendant")).toBe(last!.id);
  expect(container.querySelectorAll('[role="option"]').length).toBeLessThan(60);
  await keyDown(list, "Enter");
  expect(onChange).toHaveBeenCalledWith("b1999", expect.objectContaining({ value: "b1999" }));
});
