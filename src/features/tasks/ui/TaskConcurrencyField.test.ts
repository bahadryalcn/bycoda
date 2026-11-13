// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TaskConcurrencyField } from "./TaskConcurrencyField";
import { GoalConcurrencyOption } from "./GoalFormParts";

let container: HTMLDivElement;
let root: Root;
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
function input() {
  return container.querySelector<HTMLInputElement>('input[type="number"]')!;
}
async function type(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function blur() {
  await act(async () => input().dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
}

it.each([9, 99, Number.MAX_SAFE_INTEGER])(
  "saves %i concurrent tasks after the complete edit",
  async (value) => {
    const onSave = vi.fn(async () => true);
    await act(async () =>
      root.render(createElement(TaskConcurrencyField, { label: "Concurrency", value: 2, onSave })),
    );
    expect(input().max).toBe("");
    await type(String(value));
    expect(onSave).not.toHaveBeenCalled();
    await blur();
    expect(onSave).toHaveBeenCalledExactlyOnceWith(value);
  },
);

it.each(["", "0", "-1", "1.5", String(Number.MAX_SAFE_INTEGER + 1)])(
  "retains invalid draft %s without saving",
  async (value) => {
    const onSave = vi.fn();
    await act(async () =>
      root.render(createElement(TaskConcurrencyField, { label: "Concurrency", value: 2, onSave })),
    );
    await type(value);
    await blur();
    expect(onSave).not.toHaveBeenCalled();
    expect(input().value).toBe(value);
    expect(input().getAttribute("aria-invalid")).toBe("true");
  },
);

it("retains rejected edits and makes Enter save without submitting the task", async () => {
  const onSave = vi.fn(async () => false);
  await act(async () =>
    root.render(createElement(TaskConcurrencyField, { label: "Concurrency", value: 2, onSave })),
  );
  await type("19");
  await act(async () => input().focus());
  const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  await act(async () => input().dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
  expect(onSave).toHaveBeenCalledExactlyOnceWith(19);
  expect(input().value).toBe("19");
});

it("preserves an unfinished edit across a machine refresh", async () => {
  const onSave = vi.fn(async () => true);
  await act(async () =>
    root.render(createElement(TaskConcurrencyField, { label: "Concurrency", value: 2, onSave })),
  );
  await type("19");
  await act(async () =>
    root.render(createElement(TaskConcurrencyField, { label: "Concurrency", value: 42, onSave })),
  );
  expect(input().value).toBe("19");
  await blur();
  expect(onSave).toHaveBeenCalledExactlyOnceWith(19);
});

it("keeps the draft and displays a failed save", async () => {
  const onSave = vi.fn(async () => {
    throw new Error("Host unavailable");
  });
  await act(async () =>
    root.render(createElement(TaskConcurrencyField, { label: "Concurrency", value: 2, onSave })),
  );
  await type("10");
  await blur();
  expect(input().value).toBe("10");
  expect(container.textContent).toContain("Host unavailable");
});

it("does not send edits from a stale machine", async () => {
  const onSave = vi.fn();
  await act(async () =>
    root.render(
      createElement(TaskConcurrencyField, {
        label: "Concurrency",
        value: 99,
        disabled: true,
        onSave,
      }),
    ),
  );
  await blur();
  expect(input().value).toBe("99");
  expect(onSave).not.toHaveBeenCalled();
});

it("accepts goal concurrency above eight and preserves zero as machine inheritance", async () => {
  const onChange = vi.fn();
  await act(async () => root.render(createElement(GoalConcurrencyOption, { value: 99, onChange })));
  expect(input().value).toBe("99");
  expect(input().max).toBe("");
  await type("123");
  expect(onChange).toHaveBeenLastCalledWith(123);
  await type("0");
  expect(onChange).toHaveBeenLastCalledWith(0);
  onChange.mockClear();
  await type(String(Number.MAX_SAFE_INTEGER + 1));
  expect(onChange).not.toHaveBeenCalled();
  expect(input().getAttribute("aria-invalid")).toBe("true");
});
