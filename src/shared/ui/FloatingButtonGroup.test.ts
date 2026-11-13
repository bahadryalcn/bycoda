// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FloatingButtonGroup } from "./FloatingButtonGroup";

/** Hovers a control until the shared tooltip opens and returns its text (key caps included). */
async function tooltipText(element: HTMLElement): Promise<string> {
  await act(async () => {
    element.dispatchEvent(new Event("pointerover", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 520));
  });
  const text = document.querySelector('[role="tooltip"]')?.textContent ?? "";
  await act(async () => {
    element.dispatchEvent(new Event("pointerout", { bubbles: true }));
  });
  return text;
}

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

it("roves vertically across enabled commands and keeps one tab stop", () => {
  const onSelect = vi.fn();
  act(() =>
    root.render(
      createElement(FloatingButtonGroup, {
        label: "Selection actions",
        orientation: "vertical",
        items: [
          { id: "first", label: "First", onSelect },
          { id: "disabled", label: "Disabled", disabled: true, onSelect },
          { id: "pending", label: "Pending", loading: true, onSelect },
          { id: "last", label: "Last", onSelect },
        ],
      }),
    ),
  );
  const buttons = Array.from(container.querySelectorAll("button"));
  act(() => buttons[0]!.focus());
  const key = (value: string) =>
    act(() =>
      document.activeElement!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: value,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
  key("ArrowDown");
  expect(document.activeElement).toBe(buttons[3]);
  key("ArrowDown");
  expect(document.activeElement).toBe(buttons[0]);
  key("End");
  expect(document.activeElement).toBe(buttons[3]);
  key("Home");
  expect(document.activeElement).toBe(buttons[0]);
  expect(buttons.filter((button) => button.tabIndex === 0)).toHaveLength(1);
  act(() => {
    buttons[1]!.click();
    buttons[2]!.click();
  });
  expect(onSelect).not.toHaveBeenCalled();
});

it("preserves pointer selections and exposes icon commands without hover", async () => {
  const onSelect = vi.fn();
  act(() =>
    root.render(
      createElement(FloatingButtonGroup, {
        label: "Text commands",
        preserveSelection: true,
        items: [
          {
            id: "copy",
            label: "Copy selection",
            shortcut: "Ctrl+C",
            icon: createElement("span", null, "C"),
            iconOnly: true,
            onSelect,
          },
        ],
      }),
    ),
  );
  const button = container.querySelector("button")!;
  const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  act(() => {
    button.dispatchEvent(down);
  });
  expect(down.defaultPrevented).toBe(true);
  expect(button.getAttribute("aria-label")).toBe("Copy selection");
  // The hint (name plus key caps) rides in the shared tooltip, not a native title.
  expect(button.title).toBe("");
  expect(await tooltipText(button)).toBe("Copy selectionCtrlC");
  act(() => button.click());
  expect(onSelect).toHaveBeenCalledOnce();
  expect(container.querySelectorAll('[role="toolbar"]')).toHaveLength(1);
});

it("hands a popup trigger to its owner while keeping roving focus and the group's tooltip", async () => {
  const owner = vi.fn();
  const onSelect = vi.fn();
  const received: string[] = [];
  act(() =>
    root.render(
      createElement(FloatingButtonGroup, {
        label: "Message actions",
        iconOnly: true,
        items: [
          {
            id: "copy",
            label: "Copy",
            icon: createElement("span", null, "C"),
            onSelect,
          },
          {
            id: "menu",
            label: "Handoff",
            tooltip: "Hand this session over",
            icon: createElement("span", null, "H"),
            render: (renderTrigger) =>
              renderTrigger({
                ref: (node) => {
                  received.push(node ? "attached" : "detached");
                },
                ariaLabel: "Handoff: 2 agents",
                "aria-haspopup": "menu",
                "aria-expanded": true,
                onSelect: owner,
              }),
          },
          {
            id: "last",
            label: "Last",
            icon: createElement("span", null, "L"),
            onSelect,
          },
        ],
      }),
    ),
  );
  const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("[data-fbg-item]"));
  expect(buttons).toHaveLength(3);
  const trigger = buttons[1]!;
  expect(received).toEqual(["attached"]);
  expect(trigger.getAttribute("aria-label")).toBe("Handoff: 2 agents");
  expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  expect(await tooltipText(trigger)).toBe("Hand this session over");
  act(() => trigger.click());
  expect(owner).toHaveBeenCalledOnce();
  // The popup item stays in the arrow-key order of the one toolbar.
  act(() => buttons[0]!.focus());
  act(() => {
    buttons[0]!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  expect(document.activeElement).toBe(trigger);
  expect(buttons.filter((button) => button.tabIndex === 0)).toHaveLength(1);
});

it("lets a disabled popup trigger refuse activation", () => {
  const owner = vi.fn();
  act(() =>
    root.render(
      createElement(FloatingButtonGroup, {
        label: "Actions",
        items: [
          {
            id: "menu",
            label: "Handoff",
            render: (renderTrigger) => renderTrigger({ disabled: true, onSelect: owner }),
          },
        ],
      }),
    ),
  );
  const trigger = container.querySelector<HTMLButtonElement>("[data-fbg-item]")!;
  act(() => trigger.click());
  expect(owner).not.toHaveBeenCalled();
  expect(trigger.getAttribute("aria-disabled")).toBe("true");
});

it("shows pending and result tones on the same icon-only item", () => {
  const onSelect = vi.fn();
  const render = (props: { label: string; tone?: "success" | "danger"; loading?: boolean }) =>
    act(() =>
      root.render(
        createElement(FloatingButtonGroup, {
          label: "Message actions",
          iconOnly: true,
          items: [
            {
              id: "copy",
              icon: createElement("span", null, "C"),
              onSelect,
              ...props,
            },
          ],
        }),
      ),
    );
  render({ label: "Copy response" });
  const button = container.querySelector<HTMLButtonElement>("[data-fbg-item]")!;
  expect(button.getAttribute("data-button-tone")).toBe("neutral");
  render({ label: "Copy response", loading: true });
  expect(button.getAttribute("aria-busy")).toBe("true");
  act(() => button.click());
  expect(onSelect).not.toHaveBeenCalled();
  render({ label: "Copied", tone: "success" });
  expect(button.getAttribute("data-button-tone")).toBe("success");
  expect(button.getAttribute("aria-label")).toBe("Copied");
  expect(button.hasAttribute("data-icon-only")).toBe(true);
  render({ label: "Retry copy", tone: "danger" });
  expect(button.getAttribute("data-button-tone")).toBe("danger");
  act(() => button.click());
  expect(onSelect).toHaveBeenCalledOnce();
});

it("drops the tray inset with padding none", () => {
  const render = (padding?: "none") =>
    act(() =>
      root.render(
        createElement(FloatingButtonGroup, {
          label: "Bare actions",
          padding,
          items: [{ id: "one", label: "One" }],
        }),
      ),
    );
  render();
  expect(container.querySelector("[role=toolbar]")?.getAttribute("data-padding")).toBeNull();
  render("none");
  expect(container.querySelector("[role=toolbar]")?.getAttribute("data-padding")).toBe("none");
});

it("forwards a selected toolbar dot without changing pressed semantics or action activation", () => {
  const onSelect = vi.fn();
  act(() =>
    root.render(
      createElement(FloatingButtonGroup, {
        label: "Inspection",
        items: [
          { id: "wrap", label: "Wrap lines", pressed: true, selectionIndicator: "dot", onSelect },
        ],
      }),
    ),
  );
  const button = container.querySelector("button")!;
  expect(button.dataset.selectionIndicator).toBe("dot");
  expect(button.getAttribute("aria-pressed")).toBe("true");
  act(() => button.click());
  expect(onSelect).toHaveBeenCalledOnce();
});
