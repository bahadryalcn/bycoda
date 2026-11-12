// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DateRangePicker } from "./DateRangePicker";
import type { DateRangePickerProps } from "./DateRangePicker";

let container: HTMLDivElement;
let root: Root;
const date = (day: number) => new Date(2026, 9, day);
const range = (start: number, end = start) => ({ start: date(start), end: date(end) });
const button = (text: string) =>
  Array.from(document.querySelectorAll("button")).find((node) => node.textContent === text)!;
const render = async (props: Partial<DateRangePickerProps>) => {
  await act(async () =>
    root.render(createElement(DateRangePicker, { value: null, onChange: vi.fn(), ...props })),
  );
};
const open = async () => {
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!.click(),
  );
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(date(18));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: true,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
    })),
  );
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

it("disables custom and built-in out-of-bounds presets while preserving valid choices", async () => {
  const change = vi.fn();
  await render({ minDate: date(17), maxDate: date(20), onChange: change });
  await open();
  expect(button("Yesterday").disabled).toBe(false);
  expect(button("Last 7 days").disabled).toBe(true);
  expect(button("This month").disabled).toBe(true);
  await act(async () => button("Last 7 days").click());
  expect(button("Apply").disabled).toBe(true);
  await act(async () => button("Yesterday").click());
  await act(async () => button("Apply").click());
  expect(change).toHaveBeenCalledExactlyOnceWith(range(17));
});

it("skips invalid presets with keyboard navigation and applies inclusive boundary dates", async () => {
  const change = vi.fn();
  await render({
    minDate: date(10),
    maxDate: date(20),
    onChange: change,
    presets: [
      { label: "At minimum", range: () => range(10) },
      {
        label: "Too early",
        range: () => ({ start: new Date(2020, 0, 1), end: new Date(2020, 0, 2) }),
      },
      { label: "At maximum", range: () => range(20) },
    ],
  });
  await open();
  expect(button("Too early").disabled).toBe(true);
  await act(async () => button("At minimum").focus());
  await act(async () =>
    button("At minimum").dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    ),
  );
  expect(document.activeElement).toBe(button("At maximum"));
  await act(async () => (document.activeElement as HTMLButtonElement).click());
  await act(async () => button("Apply").click());
  expect(change).toHaveBeenCalledExactlyOnceWith(range(20));
});

it("revalidates a selected preset when bounds change while open", async () => {
  const change = vi.fn();
  const props = {
    value: range(12, 15),
    onChange: change,
    presets: [{ label: "Allowed initially", range: () => range(10, 20) }],
  };
  await render({ ...props, minDate: date(10), maxDate: date(20) });
  await open();
  await act(async () => button("Allowed initially").click());
  expect(button("Apply").disabled).toBe(false);
  await render({ ...props, minDate: date(12), maxDate: date(18) });
  expect(button("Allowed initially").disabled).toBe(true);
  expect(button("Apply").disabled).toBe(true);
  await act(async () => button("Apply").click());
  expect(change).not.toHaveBeenCalled();
});

it("rejects an invalid controlled range and permits calendar recovery within current bounds", async () => {
  const change = vi.fn();
  await render({
    value: range(1, 30),
    minDate: date(10),
    maxDate: date(20),
    onChange: change,
    presets: [],
  });
  await open();
  expect(button("Apply").disabled).toBe(true);
  const first = document.querySelector<HTMLButtonElement>('[data-date="2026-10-10"]')!;
  await act(async () => first.click());
  await act(async () => first.focus());
  await act(async () =>
    first.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })),
  );
  expect(document.activeElement?.getAttribute("data-date")).toBe("2026-10-10");
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[data-date="2026-10-20"]')!.click(),
  );
  await act(async () => button("Apply").click());
  expect(change).toHaveBeenCalledExactlyOnceWith(range(10, 20));
});

it("keeps a disabled or read-only trigger closed and exposes the state on the frame", async () => {
  await render({ value: range(10, 12), disabled: true });
  const trigger = container.querySelector<HTMLButtonElement>("button")!;
  expect(trigger.disabled).toBe(true);
  expect(container.querySelector("[data-disabled]")).not.toBeNull();
  await act(async () => trigger.click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();

  await render({ value: range(10, 12), readOnly: true });
  const quiet = container.querySelector<HTMLButtonElement>("button")!;
  expect(quiet.disabled).toBe(false);
  expect(quiet.getAttribute("aria-readonly")).toBe("true");
  expect(container.querySelector("[data-readonly]")).not.toBeNull();
  await act(async () => quiet.click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();

  await render({ value: range(10, 12), error: "Invalid range" });
  expect(container.querySelector('[aria-invalid="true"]')).not.toBeNull();
  await open();
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
});
