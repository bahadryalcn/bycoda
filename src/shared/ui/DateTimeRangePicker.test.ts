// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DateTimeRangePicker } from "./DateTimeRangePicker";

let container: HTMLDivElement;
let root: Root;
const initial = {
  start: new Date(2026, 9, 12, 9, 15),
  end: new Date(2026, 9, 16, 18, 30),
};
const outer = () =>
  document.querySelector<HTMLDivElement>('[role="dialog"][aria-label="Date and time range"]')!;
const inner = () =>
  document.querySelector<HTMLDivElement>('[role="dialog"][aria-label="Date range"]')!;
const click = async (element: HTMLElement) => act(async () => element.click());
const namedButton = (element: HTMLElement, name: string) =>
  [...element.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent === name,
  )!;
const calendarTrigger = () => outer().querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!;
const escape = async () =>
  act(async () =>
    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    ),
  );

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 18, 12));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("keeps calendar Apply as a draft and commits exclusive end only through the outer form", async () => {
  const change = vi.fn();
  await act(async () =>
    root.render(createElement(DateTimeRangePicker, { value: initial, onChange: change })),
  );
  await click(container.querySelector("button")!);
  await click(calendarTrigger());
  await click(namedButton(inner(), "Yesterday"));
  await click(namedButton(inner(), "Apply"));
  expect(change).not.toHaveBeenCalled();
  const fields = outer().querySelectorAll<HTMLInputElement>('input[type="datetime-local"]');
  expect([...fields].map((input) => input.value)).toEqual(["2026-10-17T00:00", "2026-10-18T00:00"]);
  await click(outer().querySelector<HTMLButtonElement>('button[type="submit"]')!);
  expect(change).toHaveBeenCalledExactlyOnceWith({
    start: new Date(2026, 9, 17),
    end: new Date(2026, 9, 18),
  });
});

it("closes one overlay at a time and discards calendar changes on outer cancellation", async () => {
  const change = vi.fn();
  await act(async () =>
    root.render(createElement(DateTimeRangePicker, { value: initial, onChange: change })),
  );
  const trigger = container.querySelector<HTMLButtonElement>("button")!;
  await click(trigger);
  await click(calendarTrigger());
  await click(namedButton(inner(), "Yesterday"));
  await escape();
  expect(calendarTrigger().getAttribute("aria-expanded")).toBe("false");
  expect(outer()).not.toBeNull();
  expect(document.activeElement).toBe(calendarTrigger());
  await escape();
  expect(document.querySelector('[role="dialog"][aria-label="Date and time range"]')).toBeNull();
  expect(change).not.toHaveBeenCalled();
  await click(trigger);
  const fields = outer().querySelectorAll<HTMLInputElement>('input[type="datetime-local"]');
  expect([...fields].map((input) => input.value)).toEqual(["2026-10-12T09:15", "2026-10-16T18:30"]);
});
