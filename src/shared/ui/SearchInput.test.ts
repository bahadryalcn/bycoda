// @vitest-environment happy-dom
import { act, createElement, createRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SearchInput } from "./SearchInput";
import { TextField } from "./TextField";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function type(value: string) {
  const input = container.querySelector("input")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return input;
}

it("clears through the caller's change handler, restores results and keeps input focus", () => {
  const changed = vi.fn();
  function Fixture() {
    const [query, setQuery] = useState("");
    return createElement(
      "label",
      null,
      createElement(SearchInput, {
        value: query,
        onChange: (event) => {
          changed(event.currentTarget.value);
          setQuery(event.currentTarget.value);
        },
      }),
      createElement(
        "output",
        null,
        ["alpha", "beta"].filter((item) => item.includes(query)).join(","),
      ),
    );
  }
  act(() => root.render(createElement(Fixture)));
  expect(container.querySelector("button")).toBeNull();
  const input = type("alpha");
  expect(container.querySelector("output")!.textContent).toBe("alpha");
  act(() =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Clear search"]')!.click(),
  );
  expect(changed.mock.calls.map(([value]) => value)).toEqual(["alpha", ""]);
  expect(input.value).toBe("");
  expect(container.querySelector("output")!.textContent).toBe("alpha,beta");
  expect(container.querySelector("button")).toBeNull();
  expect(document.activeElement).toBe(input);
});

it("keeps popover searches focused without bubbling clear actions or submitting the form", () => {
  const clicked = vi.fn();
  const blurred = vi.fn();
  const submitted = vi.fn();
  act(() =>
    root.render(
      createElement(
        "form",
        { onClick: clicked, onSubmit: submitted },
        createElement(SearchInput, { defaultValue: "query", onBlur: blurred }),
      ),
    ),
  );
  const input = container.querySelector("input")!;
  input.focus();
  const button = container.querySelector("button")!;
  const pointer = new PointerEvent("pointerdown", { bubbles: true, cancelable: true });
  act(() => {
    button.dispatchEvent(pointer);
    button.click();
  });
  expect(pointer.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(input);
  expect(clicked).not.toHaveBeenCalled();
  expect(blurred).not.toHaveBeenCalled();
  expect(submitted).not.toHaveBeenCalled();
});

it.each([{ disabled: true }, { readOnly: true }, { clearable: false }])(
  "does not offer clearing when the caller prevents edits: %j",
  (props) => {
    act(() =>
      root.render(createElement(SearchInput, { value: "query", ...props, onChange: vi.fn() })),
    );
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector("input")!.value).toBe("query");
  },
);

it("forwards the input ref and preserves caller keyboard navigation", () => {
  const ref = createRef<HTMLInputElement>();
  const keyDown = vi.fn();
  act(() =>
    root.render(
      createElement(SearchInput, {
        ref,
        onKeyDown: keyDown,
        defaultValue: "query",
        standalone: true,
      }),
    ),
  );
  const input = container.querySelector("input")!;
  expect(ref.current).toBe(input);
  act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(keyDown).toHaveBeenCalledOnce();
  expect(input.value).toBe("query");
  act(() => container.querySelector<HTMLButtonElement>("button")!.click());
  expect(input.value).toBe("");
});

it("supports clearing a labeled Arc search field", () => {
  act(() =>
    root.render(
      createElement(TextField, { label: "Filter notes", clearable: true, defaultValue: "notes" }),
    ),
  );
  const input = container.querySelector("input")!;
  expect(container.querySelector("label")!.htmlFor).toBe(input.id);
  act(() => container.querySelector<HTMLButtonElement>("button")!.click());
  expect(input.value).toBe("");
  expect(document.activeElement).toBe(input);
});
it("keeps native identity, form data, required validation and clear state after a field reset", async () => {
  const ref = createRef<HTMLInputElement>();
  await act(async () =>
    root.render(
      createElement(
        "form",
        null,
        createElement(SearchInput, {
          ref,
          appearance: "field",
          name: "q",
          required: true,
          defaultValue: "query",
        }),
      ),
    ),
  );
  const form = container.querySelector("form")!;
  const input = container.querySelector("input")!;
  expect(ref.current).toBe(input);
  expect(new window.FormData(form).get("q")).toBe("query");
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  expect(input.checkValidity()).toBe(false);
  expect(container.querySelector("button")).toBeNull();
  await act(async () => {
    form.reset();
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
  expect(ref.current).toBe(input);
  expect(input.checkValidity()).toBe(true);
  expect(new window.FormData(form).get("q")).toBe("query");
  expect(container.querySelector("button")).not.toBeNull();
});
