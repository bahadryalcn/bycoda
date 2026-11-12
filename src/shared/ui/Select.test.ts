// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Select } from "./Select";

let root: Root;
let container: HTMLDivElement;
const change = vi.fn();
const options = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
];
const trigger = () => container.querySelector<HTMLButtonElement>("button")!;
const menu = () => document.querySelector<HTMLElement>('[role="listbox"]');
const key = (target: Element, value: string) =>
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }),
  );
async function render(disabled = false) {
  await act(async () =>
    root.render(
      createElement(Select, {
        label: "Choice",
        value: "a",
        options,
        disabled,
        onValueChange: change,
      }),
    ),
  );
}
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
  change.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete document.documentElement.dataset.theme;
  vi.unstubAllGlobals();
});

it.each(["light", "dark"])(
  "closes an open %s menu on disable and discards stale pointer/keyboard selection",
  async (theme) => {
    document.documentElement.dataset.theme = theme;
    await render();
    await act(async () => trigger().click());
    const staleMenu = menu()!;
    const staleOption = staleMenu.querySelectorAll<HTMLButtonElement>('[role="option"]')[1];
    expect(staleOption).toBeDefined();
    await render(true);
    expect(menu()).toBeNull();
    expect(trigger().disabled).toBe(true);
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(trigger().hasAttribute("aria-controls")).toBe(false);
    await act(async () => {
      staleOption.click();
      key(staleMenu, "Enter");
    });
    expect(change).not.toHaveBeenCalled();
    await render(false);
    expect(menu()).toBeNull();
    await act(async () => {
      trigger().focus();
      key(trigger(), "ArrowDown");
    });
    await act(async () => {
      key(menu()!, "ArrowDown");
    });
    await act(async () => {
      key(menu()!, "Enter");
    });
    expect(change).toHaveBeenCalledExactlyOnceWith("b");
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  },
);

it.each(["pointer", "keyboard"])(
  "rejects %s activation when the native form control becomes disabled",
  async (mode) => {
    await render();
    await act(async () => trigger().click());
    trigger().disabled = true;
    await act(async () => {
      if (mode === "pointer")
        menu()!.querySelectorAll<HTMLButtonElement>('[role="option"]')[1].click();
      else {
        key(menu()!, "ArrowDown");
      }
    });
    expect(change).not.toHaveBeenCalled();
  },
);

it("skips disabled options in keyboard navigation and never selects them", async () => {
  await act(async () =>
    root.render(
      createElement(Select, {
        label: "Choice",
        value: "a",
        options: [
          { value: "a", label: "Alpha" },
          { value: "b", label: "Beta", disabled: true },
          { value: "c", label: "Gamma" },
          { value: "d", label: "Delta", disabled: true },
        ],
        onValueChange: change,
      }),
    ),
  );
  await act(async () => {
    trigger().focus();
    key(trigger(), "ArrowDown");
  });
  const rows = Array.from(menu()!.querySelectorAll<HTMLButtonElement>('[role="option"]'));
  expect(rows.map((row) => row.disabled)).toEqual([false, true, false, true]);
  expect(rows[1].getAttribute("aria-disabled")).toBe("true");
  const activeLabel = () =>
    menu()!.querySelector('[role="option"][data-highlighted]')?.textContent?.trim();
  expect(activeLabel()).toBe("Alpha");
  await act(async () => key(menu()!, "ArrowDown"));
  expect(activeLabel()).toBe("Gamma");
  expect(menu()!.getAttribute("aria-activedescendant")).toBe(rows[2].id);
  await act(async () => key(menu()!, "ArrowDown"));
  expect(activeLabel()).toBe("Gamma");
  await act(async () => key(menu()!, "End"));
  expect(activeLabel()).toBe("Gamma");
  await act(async () => key(menu()!, "Home"));
  expect(activeLabel()).toBe("Alpha");
  await act(async () => rows[1].click());
  expect(change).not.toHaveBeenCalled();
  await act(async () => key(menu()!, "ArrowDown"));
  await act(async () => key(menu()!, "Enter"));
  expect(change).toHaveBeenCalledExactlyOnceWith("c");
});

it("keeps a committed disabled or missing value visible on the trigger", async () => {
  await act(async () =>
    root.render(
      createElement(Select, {
        label: "Choice",
        value: "b",
        options: [
          { value: "a", label: "Alpha" },
          { value: "b", label: "Beta", disabled: true },
        ],
        onValueChange: change,
      }),
    ),
  );
  expect(trigger().textContent).toContain("Beta");
  await act(async () =>
    root.render(
      createElement(Select, { label: "Choice", value: "gone", options, onValueChange: change }),
    ),
  );
  expect(trigger().textContent).toContain("gone");
});

it("marks a trigger invalid through native aria and keeps disabled out of the tab order of a menu", async () => {
  await act(async () =>
    root.render(
      createElement(Select, {
        label: "Choice",
        value: "a",
        options,
        "aria-invalid": true,
        "aria-describedby": "choice-error",
        onValueChange: change,
      }),
    ),
  );
  expect(trigger().getAttribute("aria-invalid")).toBe("true");
  expect(trigger().getAttribute("aria-describedby")).toBe("choice-error");
});

it("keeps the keyboard cursor when a parent re-renders an open select with a new options array", async () => {
  const make = () => [
    { value: "a", label: "Alpha" },
    { value: "b", label: "Beta" },
    { value: "c", label: "Gamma" },
  ];
  const draw = () =>
    act(async () =>
      root.render(
        createElement(Select, {
          label: "Choice",
          value: "a",
          options: make(),
          onValueChange: change,
        }),
      ),
    );
  await draw();
  await act(async () => {
    trigger().focus();
    key(trigger(), "ArrowDown");
  });
  const activeLabel = () =>
    menu()!.querySelector('[role="option"][data-highlighted]')?.textContent?.trim();
  await act(async () => key(menu()!, "ArrowDown"));
  expect(activeLabel()).toBe("Beta");
  await draw();
  expect(activeLabel()).toBe("Beta");
});

it("closes during a disabled render and does not reopen when enabled again", async () => {
  await render();
  await act(async () => trigger().click());
  expect(menu()).not.toBeNull();
  await render(true);
  expect(menu()).toBeNull();
  await render(false);
  expect(menu()).toBeNull();
});

it("shows the label by default and keeps it for assistive tech only with hideLabel", async () => {
  const show = (hideLabel: boolean) =>
    act(async () =>
      root.render(
        createElement(Select, {
          label: "Choice",
          value: "a",
          options,
          hideLabel,
          onValueChange: change,
        }),
      ),
    );
  await show(false);
  expect(container.querySelector("label")?.textContent).toBe("Choice");
  expect(container.querySelector(".max-w-52")).toBeNull();
  await show(true);
  expect(container.querySelector("label")).toBeNull();
  expect(trigger().getAttribute("aria-label")).toBe("Choice: Alpha");
  expect(container.querySelector(".max-w-52")).not.toBeNull();
});

it("retains option icons in both selected trigger and list", async () => {
  await act(async () =>
    root.render(
      createElement(Select, {
        label: "Provider",
        value: "a",
        options: [
          {
            value: "a",
            label: "Alpha",
            icon: createElement("span", { "data-provider-icon": true }),
          },
        ],
        onValueChange: change,
      }),
    ),
  );
  expect(trigger().querySelector("[data-provider-icon]")).not.toBeNull();
  await act(async () => trigger().click());
  expect(menu()?.querySelector("[data-provider-icon]")).not.toBeNull();
});
