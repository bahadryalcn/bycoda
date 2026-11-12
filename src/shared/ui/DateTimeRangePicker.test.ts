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
const click = async (element: HTMLElement) => act(async () => element.click());
const namedButton = (element: HTMLElement, name: string) =>
  [...element.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent === name,
  )!;
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
      unobserve() {}
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

it("commits inclusive day presets as exclusive local instants through one Apply", async () => {
  const change = vi.fn();
  await act(async () =>
    root.render(createElement(DateTimeRangePicker, { value: initial, onChange: change })),
  );
  await click(container.querySelector("button")!);
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  await click(namedButton(outer(), "Yesterday"));
  expect(change).not.toHaveBeenCalled();
  expect(
    [...outer().querySelectorAll<HTMLInputElement>('input[type="text"]')].map(
      (input) => input.value,
    ),
  ).toEqual(["10/17/2026 00:00", "10/18/2026 00:00"]);
  expect(outer().querySelector('input[type="datetime-local"]')).toBeNull();
  expect(outer().querySelectorAll('[role="listbox"]')).toHaveLength(2);
  await click(namedButton(outer(), "Apply"));
  expect(change).toHaveBeenCalledExactlyOnceWith({
    start: new Date(2026, 9, 17),
    end: new Date(2026, 9, 18),
  });
});

it("Escape discards draft changes and restores trigger focus", async () => {
  const change = vi.fn();
  await act(async () =>
    root.render(createElement(DateTimeRangePicker, { value: initial, onChange: change })),
  );
  const trigger = container.querySelector<HTMLButtonElement>("button")!;
  await click(trigger);
  await click(namedButton(outer(), "Yesterday"));
  await escape();
  expect(outer()).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(change).not.toHaveBeenCalled();
  await click(trigger);
  expect(
    [...outer().querySelectorAll<HTMLInputElement>('input[type="text"]')].map(
      (input) => input.value,
    ),
  ).toEqual(["10/12/2026 09:15", "10/16/2026 18:30"]);
});

it("rejects a reversed datetime range and equal exclusive endpoints", async () => {
  for (const end of [initial.start, new Date(2026, 9, 11)]) {
    await act(async () =>
      root.render(
        createElement(DateTimeRangePicker, {
          value: { start: initial.start, end },
          onChange: vi.fn(),
        }),
      ),
    );
    await click(container.querySelector("button")!);
    expect(namedButton(outer(), "Apply").disabled).toBe(true);
    await escape();
  }
});
