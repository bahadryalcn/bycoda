// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TimePicker } from "../TimePicker";
import { DatePicker } from "../DatePicker";
import { DateTimePicker } from "../DateTimePicker";
import { DateRangePicker } from "../DateRangePicker";

let container: HTMLDivElement;
let root: Root;
const click = async (element: HTMLElement) => act(async () => element.click());
const named = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === label,
  )!;
const trigger = () => container.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!;
const key = async (value: string) =>
  act(async () =>
    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }),
    ),
  );

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2028, 1, 20, 13, 7));
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

it("opens time columns from a field, steps by keyboard, applies and clears optional values", async () => {
  const change = vi.fn();
  await act(async () =>
    root.render(
      createElement(TimePicker, {
        label: "Time",
        value: "13:07",
        minuteStep: 15,
        onChange: change,
      }),
    ),
  );
  await click(trigger());
  const lists = document.querySelectorAll('[role="listbox"]');
  expect(lists).toHaveLength(2);
  expect(lists[0].querySelectorAll('[role="option"]')).toHaveLength(24);
  expect(lists[1].querySelectorAll('[role="option"]')).toHaveLength(5);
  await act(async () =>
    lists[1].querySelector<HTMLButtonElement>('[aria-selected="true"]')!.focus(),
  );
  await key("ArrowDown");
  await click(named("Apply"));
  expect(change).toHaveBeenLastCalledWith("13:15");
  expect(document.activeElement).toBe(trigger());
  await click(trigger());
  await click(named("Clear"));
  expect(change).toHaveBeenLastCalledWith("");
});

it("keeps required values, errors and disabled state on the shared frame", async () => {
  const change = vi.fn();
  await act(async () =>
    root.render(
      createElement(TimePicker, {
        label: "Time",
        hint: "Hint",
        error: "Error",
        value: "13:07",
        onChange: change,
        required: true,
      }),
    ),
  );
  expect(trigger().getAttribute("aria-required")).toBe("true");
  expect(trigger().getAttribute("aria-invalid")).toBe("true");
  expect(trigger().getAttribute("aria-describedby")).toBeTruthy();
  await click(trigger());
  expect(named("Clear")).toBeUndefined();
  await key("Escape");
  await act(async () =>
    root.render(
      createElement(TimePicker, {
        label: "Time",
        value: "13:07",
        onChange: change,
        disabled: true,
      }),
    ),
  );
  await click(trigger());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("parses typed 12-hour entry on commit and blocks malformed drafts", async () => {
  const change = vi.fn();
  await act(async () =>
    root.render(
      createElement(TimePicker, {
        label: "Time",
        value: "13:07",
        onChange: change,
        min: "09:00",
        max: "17:00",
      }),
    ),
  );
  await click(trigger());
  const input = document.querySelector<HTMLInputElement>('input[type="text"]')!;
  const type = async (text: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  await act(async () => input.focus());
  await type("bad");
  await key("Enter");
  expect(named("Apply").disabled).toBe(true);
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(change).not.toHaveBeenCalled();
  await type("6:15 PM");
  await key("Enter");
  expect(input.value).toBe("17:00");
  await click(named("Apply"));
  expect(change).toHaveBeenCalledExactlyOnceWith("17:00");
});

it("uses the same field and calendar for date and datetime", async () => {
  for (const component of [DatePicker, DateTimePicker]) {
    const value = component === DatePicker ? "2028-02-20" : "2028-02-20T13:07";
    await act(async () =>
      root.render(createElement(component, { label: "When", value, onChange: vi.fn() })),
    );
    await click(trigger());
    expect(document.querySelector('[role="grid"]')).not.toBeNull();
    expect(
      document.querySelector(
        'input[type="date"], input[type="time"], input[type="datetime-local"]',
      ),
    ).toBeNull();
    await key("Escape");
    expect(document.activeElement).toBe(trigger());
  }
});

it("previews and orders a pending backwards day range without committing before Apply", async () => {
  const change = vi.fn();
  await act(async () =>
    root.render(
      createElement(DateRangePicker, {
        label: "Period",
        value: { start: new Date(2028, 1, 10), end: new Date(2028, 1, 11) },
        presets: [],
        onChange: change,
      }),
    ),
  );
  await click(trigger());
  const day = (date: string) => document.querySelector<HTMLButtonElement>(`[data-date="${date}"]`)!;
  await click(day("2028-02-20"));
  await act(async () =>
    day("2028-02-17").dispatchEvent(new MouseEvent("mouseover", { bubbles: true })),
  );
  expect(day("2028-02-18").closest('[role="gridcell"]')!.hasAttribute("data-preview")).toBe(true);
  expect(change).not.toHaveBeenCalled();
  await click(day("2028-02-17"));
  await click(named("Apply"));
  expect(change).toHaveBeenCalledExactlyOnceWith({
    start: new Date(2028, 1, 17),
    end: new Date(2028, 1, 20),
  });
});
