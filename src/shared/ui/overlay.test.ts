// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Modal } from "./Modal";
import { Button } from "./Button";
import { ImageLightbox } from "./ImageLightbox";
import { Popover } from "./Popover";
import { NativePopupHost } from "./NativePopupHost";
import { SearchableSelect } from "./SearchableSelect";
import { useDragResize } from "../hooks/useDragResize";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

it("keeps image preview focus inside, closes with Escape and restores its trigger", async () => {
  const trigger = document.createElement("button");
  document.body.append(trigger);
  trigger.focus();
  const close = vi.fn();
  await act(async () =>
    root.render(
      createElement(ImageLightbox, {
        src: "data:image/png;base64,",
        alt: "Preview",
        onClose: close,
      }),
    ),
  );
  const button = document.querySelector<HTMLButtonElement>('[aria-label="Close image preview"]')!;
  const viewport = document.querySelector<HTMLElement>(
    '[role="group"][aria-label="Image preview: Preview"]',
  )!;
  expect(trigger.inert).toBe(true);
  expect(document.activeElement).toBe(viewport);
  await key(viewport, "Tab");
  expect(viewport.closest('[role="dialog"]')?.contains(document.activeElement)).toBe(true);
  await key(document.activeElement!, "Tab", true);
  expect(document.activeElement).toBe(viewport);
  await key(viewport, "Escape");
  expect(close).toHaveBeenCalledOnce();
  await act(async () => root.render(null));
  expect(trigger.inert).toBe(false);
  expect(document.activeElement).toBe(trigger);
});
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
const key = async (target: Element, value: string, shiftKey = false) => {
  const event = new KeyboardEvent("keydown", {
    key: value,
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  await act(async () => {
    target.dispatchEvent(event);
  });
  return event;
};

it.each([false, true])(
  "focuses the primary modal action and keeps keyboard navigation (native=%s)",
  async (native) => {
    const trigger = document.createElement("button");
    const host = document.createElement("div");
    document.body.append(trigger, host);
    trigger.focus();
    const close = vi.fn();
    await act(async () =>
      root.render(
        createElement(
          NativePopupHost.Provider,
          { value: native ? host : null },
          createElement(Modal, {
            title: "Rewind and edit message?",
            onClose: close,
            children: [
              createElement(Button, { key: "cancel", id: "cancel" }, "Cancel"),
              createElement(
                Button,
                { key: "edit", id: "edit", variant: "primary" },
                "Rewind and edit",
              ),
            ],
          }),
        ),
      ),
    );
    const edit = document.getElementById("edit")!;
    expect(document.activeElement).toBe(edit);
    await key(edit, "Tab", true);
    expect(document.activeElement?.id).toBe("cancel");
    await key(document.activeElement!, "Tab");
    expect(document.activeElement).toBe(edit);
    await key(edit, "Tab");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Close");
    trigger.focus();
    expect(document.querySelector('[role="dialog"]')!.contains(document.activeElement)).toBe(true);
    await key(edit, "Escape");
    expect(close).toHaveBeenCalledOnce();
    await act(async () => root.render(null));
    expect(document.activeElement).toBe(trigger);
  },
);

it("preserves explicit field autofocus ahead of the primary modal action", async () => {
  await act(async () =>
    root.render(
      createElement(Modal, {
        title: "Edit name",
        onClose: vi.fn(),
        children: [
          createElement("input", { key: "name", id: "name", autoFocus: true }),
          createElement(Button, { key: "save", variant: "primary" }, "Save"),
        ],
      }),
    ),
  );
  expect(document.activeElement?.id).toBe("name");
});

it.each(["disabled", "loading", "hidden", "aria-disabled"])(
  "skips a %s primary action when choosing initial focus",
  async (state) => {
    await act(async () =>
      root.render(
        createElement(Modal, {
          title: "Save changes",
          onClose: vi.fn(),
          children: [
            createElement(
              Button,
              { key: "blocked", variant: "primary", [state]: true },
              "Unavailable",
            ),
            createElement(Button, { key: "save", id: "save", variant: "primary" }, "Save"),
          ],
        }),
      ),
    );
    expect(document.activeElement?.id).toBe("save");
  },
);

it("traps Tab, blocks the background, and restores the trigger", async () => {
  const trigger = document.createElement("button");
  document.body.append(trigger);
  trigger.focus();
  await act(async () =>
    root.render(
      createElement(Modal, {
        title: "Example",
        onClose: vi.fn(),
        children: createElement("button", { id: "last" }, "Last"),
      }),
    ),
  );
  const dialog = document.querySelector('[aria-modal="true"]')!;
  const last = document.getElementById("last")!;
  expect(trigger.inert).toBe(true);
  last.focus();
  await key(last, "Tab");
  expect(document.activeElement).toBe(dialog.querySelector('[aria-label="Close"]'));
  await key(document.activeElement!, "Tab", true);
  expect(document.activeElement).toBe(last);
  trigger.focus();
  expect(dialog.contains(document.activeElement)).toBe(true);
  await act(async () => root.render(null));
  expect(document.activeElement).toBe(trigger);
  expect(trigger.inert).toBe(false);
});

it("dismisses only presses on the owning modal surface", async () => {
  const close = vi.fn();
  await act(async () =>
    root.render(
      createElement(Modal, {
        title: "Example",
        onClose: close,
        children: createElement("button", { id: "inside" }, "Inside"),
      }),
    ),
  );
  const surface = document.querySelector(".modal-backdrop")!.parentElement!;
  expect(surface.inert).not.toBe(true);
  await act(async () => {
    document
      .getElementById("inside")!
      .dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  });
  expect(close).not.toHaveBeenCalled();
  const outside = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  await act(async () => {
    surface.dispatchEvent(outside);
  });
  expect(close).toHaveBeenCalledOnce();
  expect(outside.defaultPrevented).toBe(true);
});

it.each([false, true])("dismisses only the top nested popover (native=%s)", async (native) => {
  const closed: string[] = [];
  const host = document.createElement("div");
  document.body.append(host);
  function Example() {
    const [inner, setInner] = useState(true);
    const [outer, setOuter] = useState(true);
    return createElement(Modal, {
      title: "Example",
      minimalHeader: true,
      onClose: () => closed.push("modal"),
      children: outer
        ? createElement(Popover, {
            anchor: host,
            onDismiss: () => {
              closed.push("outer");
              setOuter(false);
            },
            children: inner
              ? createElement(Popover, {
                  anchor: host,
                  onDismiss: () => {
                    closed.push("inner");
                    setInner(false);
                  },
                  children: createElement("button", { id: "nested" }, "Nested"),
                })
              : "Outer",
          })
        : "Body",
    });
  }
  await act(async () =>
    root.render(
      createElement(
        NativePopupHost.Provider,
        { value: native ? host : null },
        createElement(Example),
      ),
    ),
  );
  document.getElementById("nested")!.focus();
  expect(document.activeElement?.id).toBe("nested");
  await key(document.activeElement!, "Escape");
  expect(closed).toEqual(["inner"]);
  await key(document.activeElement!, "Escape");
  expect(closed).toEqual(["inner", "outer"]);
  await key(document.activeElement!, "Escape");
  expect(closed).toEqual(["inner", "outer", "modal"]);
});

it("restores the trigger when a modal unmounts with a child overlay open", async () => {
  const trigger = document.createElement("button");
  document.body.append(trigger);
  trigger.focus();
  await act(async () =>
    root.render(
      createElement(Modal, {
        title: "Example",
        onClose: vi.fn(),
        children: createElement(Popover, {
          anchor: trigger,
          onDismiss: vi.fn(),
          children: createElement("button", { id: "child" }, "Child"),
        }),
      }),
    ),
  );
  document.getElementById("child")!.focus();
  await act(async () => root.render(null));
  expect(document.activeElement).toBe(trigger);
  expect(trigger.inert).toBe(false);
});

it.each([false, true])(
  "keeps parent popovers open while interacting with a portalled child (native=%s)",
  async (native) => {
    const outer = vi.fn();
    const inner = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    await act(async () =>
      root.render(
        createElement(
          NativePopupHost.Provider,
          { value: native ? host : null },
          createElement(Popover, {
            anchor: host,
            onDismiss: outer,
            children: createElement(Popover, {
              anchor: host,
              onDismiss: inner,
              children: createElement("input", { id: "nested-input" }),
            }),
          }),
        ),
      ),
    );
    await act(async () => {
      document
        .getElementById("nested-input")!
        .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    expect(outer).not.toHaveBeenCalled();
    expect(inner).not.toHaveBeenCalled();
  },
);

it("keeps Home/End available to the search caret", async () => {
  await act(async () =>
    root.render(
      createElement(SearchableSelect, {
        label: "Choice",
        value: "a",
        options: [{ value: "a", label: "Alpha" }],
        onChange: vi.fn(),
      }),
    ),
  );
  await act(async () => container.querySelector("button")!.click());
  const input = document.querySelector("input")!;
  expect((await key(input, "Home")).defaultPrevented).toBe(false);
  expect((await key(input, "End")).defaultPrevented).toBe(false);
});

it("leaves IME confirmation and cancellation to the active composition", async () => {
  const onClose = vi.fn();
  const onChange = vi.fn();
  await act(async () =>
    root.render(
      createElement(Modal, {
        title: "Choose",
        onClose,
        children: createElement(SearchableSelect, {
          label: "Choice",
          value: "a",
          options: [{ value: "a", label: "Alpha" }],
          onChange,
        }),
      }),
    ),
  );
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[aria-label="Choice: Alpha"]')!.click(),
  );
  const input = document.querySelector("input")!;
  for (const key of ["Enter", "Escape", "ArrowDown"]) {
    const event = new KeyboardEvent("keydown", {
      key,
      isComposing: true,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      input.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
  }
  expect(onChange).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(document.querySelector('[role="listbox"]')).not.toBeNull();
});

it("clamps resized viewports below min and allows keyboard reset", async () => {
  let maximum = 500;
  function Example() {
    const resize = useDragResize({
      min: 200,
      max: () => maximum,
      initial: 400,
      defaultWidth: 240,
    });
    return createElement(
      "div",
      { ref: resize.setPaneRef },
      createElement("div", { ...resize.separatorProps }),
    );
  }
  await act(async () => root.render(createElement(Example)));
  const separator = container.querySelector('[role="separator"]')!;
  await key(separator, "ArrowLeft");
  expect(separator.getAttribute("aria-valuenow")).toBe("390");
  await key(separator, "Enter");
  expect(separator.getAttribute("aria-valuenow")).toBe("240");
  maximum = 150;
  await act(async () => window.dispatchEvent(new Event("resize")));
  expect(separator.getAttribute("aria-valuenow")).toBe("150");
  expect(separator.getAttribute("aria-valuemin")).toBe("150");
});

it("changes resize axis without retaining the previous dimension", async () => {
  function Example({ vertical }: { vertical: boolean }) {
    const resize = useDragResize({
      axis: vertical ? "vertical" : "horizontal",
      direction: "left",
      min: 160,
      max: () => 600,
      initial: 420,
      defaultWidth: vertical ? 300 : 420,
    });
    return createElement(
      "div",
      { ref: resize.setPaneRef },
      createElement("div", { ...resize.separatorProps }),
    );
  }
  await act(async () => root.render(createElement(Example, { vertical: false })));
  expect((container.firstElementChild as HTMLElement).style.width).toBe("420px");
  await act(async () => root.render(createElement(Example, { vertical: true })));
  const pane = container.firstElementChild as HTMLElement;
  const separator = container.querySelector('[role="separator"]')!;
  expect(pane.style.width).toBe("");
  expect(pane.style.height).toBe("300px");
  await key(separator, "ArrowUp");
  expect(pane.style.height).toBe("310px");
  await key(separator, "ArrowDown");
  expect(pane.style.height).toBe("300px");
});
