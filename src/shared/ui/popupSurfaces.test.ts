// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Combobox, ComboboxChoice, ComboboxItem } from "./arc/combobox/combobox";
import { SearchableSelect } from "./SearchableSelect";
import { ContextMenu } from "./arc/context-menu/context-menu";
import {
  NativePopupHost,
  useNativePopupFrame,
  PopupBackdrop,
  nativePopupFrameClassName,
} from "./NativePopupHost";
import { Popover } from "./Popover";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("innerWidth", 500);
  vi.stubGlobal("innerHeight", 400);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
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
const key = async (target: Element, value: string) => {
  await act(async () =>
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }),
    ),
  );
};

it.each([false, true])(
  "portals combobox suggestions and owns outside/Escape dismissal (editable %s)",
  async (allowCustomValue) => {
    const picked = vi.fn();
    await act(async () =>
      root.render(
        createElement(Combobox, {
          label: "Font",
          allowCustomValue,
          onValueChange: picked,
          options: [
            { value: "a", label: "Alpha" },
            { value: "b", label: "Blocked", disabled: true },
          ],
        }),
      ),
    );
    const input = container.querySelector("input")!;
    await act(async () => input.focus());
    const list = document.querySelector('[role="listbox"]')!;
    expect(container.contains(list)).toBe(false);
    expect(list.closest("[data-popover-side]")).not.toBeNull();
    const blocked = list.querySelector('[aria-disabled="true"]')!;
    await act(async () => blocked.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(picked).not.toHaveBeenCalled();
    await key(input, "Escape");
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    await act(async () => input.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await act(async () =>
      document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })),
    );
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  },
);

it("clamps a standalone context menu at the viewport edge and preserves disabled keyboard navigation", async () => {
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(1200);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(120);
  const picked = vi.fn();
  await act(async () =>
    root.render(
      createElement(ContextMenu, {
        children: "Target",
        items: [
          { id: "a", label: "Alpha" },
          { id: "b", label: "Blocked", disabled: true },
          { id: "c", label: "Gamma", onSelect: picked },
        ],
      }),
    ),
  );
  const target = container.querySelector('[aria-haspopup="menu"]')!;
  await act(async () =>
    target.dispatchEvent(
      new MouseEvent("contextmenu", {
        clientX: 495,
        clientY: 395,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
  const frame = menu.parentElement!;
  expect(frame.style.position).toBe("fixed");
  expect(frame.style.width).toBe("484px");
  expect(Number.parseFloat(frame.style.left)).toBe(8);
  expect(Number.parseFloat(frame.style.bottom)).toBeGreaterThanOrEqual(8);
  expect(document.activeElement?.textContent).toBe("Alpha");
  await key(menu, "ArrowDown");
  expect(document.activeElement?.textContent).toBe("Gamma");
  await act(async () => (document.activeElement as HTMLButtonElement).click());
  expect(picked).toHaveBeenCalledOnce();
  expect(document.querySelector('[role="menu"]')).toBeNull();
});

it("keeps portalled pill search focus and choice clicks within the owning picker", async () => {
  const picked = vi.fn();
  await act(async () =>
    root.render(
      createElement(SearchableSelect, {
        variant: "pill",
        value: "a",
        label: "Mode",
        searchable: true,
        onChange: picked,
        options: [
          { value: "a", label: "Alpha" },
          { value: "b", label: "Beta" },
        ],
      }),
    ),
  );
  const trigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!;
  await act(async () => trigger.click());
  const input = document.querySelector<HTMLInputElement>('input[role="combobox"]')!;
  expect(container.contains(input)).toBe(false);
  expect(document.activeElement).toBe(input);
  const beta = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (row) => row.textContent === "Beta",
  )!;
  await act(async () =>
    beta.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true })),
  );
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  await act(async () => beta.click());
  expect(picked).toHaveBeenCalledWith("b");
  expect(document.querySelector('[role="listbox"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it("renders native-window choices through the same row and label components", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  try {
    const row = createElement(
      ComboboxItem,
      { role: "option", "aria-selected": true },
      createElement(ComboboxChoice, { selected: true, label: "Alpha" }),
    );
    await act(async () =>
      root.render(createElement(Popover, { anchor: container, minWidth: 200 }, row)),
    );
    const webRow = document.querySelector<HTMLElement>('[role="option"]')!;
    const classes = webRow.className;
    const markup = webRow.innerHTML;
    expect(
      document.querySelector("[data-popover-side]")?.classList.contains(nativePopupFrameClassName),
    ).toBe(true);
    await act(async () =>
      root.render(
        createElement(
          NativePopupHost.Provider,
          { value: host },
          createElement(Popover, { anchor: container, minWidth: 200 }, row),
        ),
      ),
    );
    const nativeRow = host.querySelector<HTMLElement>('[role="option"]')!;
    expect(nativeRow.className).toBe(classes);
    expect(nativeRow.innerHTML).toBe(markup);
    expect(host.querySelector("[data-popover-flow]")?.getAttribute("style")).toContain(
      "--popup-max-width: 800px",
    );
  } finally {
    host.remove();
  }
});

it("shares native frame/backdrop and reports bounded outer dimensions on mount and resize", async () => {
  const sized = vi.fn();
  function NativeFrameFixture() {
    const { frameProps, contentClassName } = useNativePopupFrame({
      onContentSize: sized,
      minWidth: 200,
    });
    return createElement(
      "div",
      frameProps,
      createElement(PopupBackdrop),
      createElement("div", { className: contentClassName }, "Choices"),
    );
  }
  let resize: ResizeObserverCallback;
  let width = 440.2;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => ({ width, height: 120.2 }) as DOMRect,
  );
  await act(async () => root.render(createElement(NativeFrameFixture)));
  const frame = container.firstElementChild!;
  expect(frame.classList.contains(nativePopupFrameClassName)).toBe(true);
  expect(sized).toHaveBeenLastCalledWith({ width: 441, height: 121 });
  const backdrop = frame.querySelector('[aria-hidden="true"]')!.className;
  await act(async () => resize!([{ target: frame } as ResizeObserverEntry], {} as ResizeObserver));
  expect(sized).toHaveBeenCalledTimes(1);
  width = 1000;
  await act(async () => resize!([{ target: frame } as ResizeObserverEntry], {} as ResizeObserver));
  expect(sized).toHaveBeenLastCalledWith({ width: 800, height: 121 });
  await act(async () => root.render(createElement(PopupBackdrop)));
  expect(container.firstElementChild!.className).toBe(backdrop);
});
