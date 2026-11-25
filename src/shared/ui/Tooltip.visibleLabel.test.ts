// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createPortal } from "react-dom";
import { afterEach, expect, it, vi } from "vitest";
import { Tooltip, useTooltip, type TooltipContent } from "./Tooltip";
import { Button } from "./Button";

const roots: Root[] = [];

it("ignores pointer and focus events from portalled picker content", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const portal = document.createElement("div");
  document.body.append(host, portal);
  const root = createRoot(host);
  roots.push(root);
  await act(async () =>
    root.render(
      createElement(Tooltip, {
        label: "Agent working folder",
        delay: 0,
        children: createElement(
          "div",
          null,
          createElement("button", { type: "button" }, "Project"),
          createPortal(createElement("input", { "aria-label": "Find project" }), portal),
        ),
      }),
    ),
  );
  const input = portal.querySelector("input")!;
  vi.spyOn(input, "matches").mockReturnValue(true);
  await act(async () => {
    input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    input.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
});

it("does not open when a dialog moves focus after a pointer press", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () =>
    root.render(
      createElement(Tooltip, {
        label: "Close",
        asChild: true,
        children: createElement("button", { type: "button" }, "x"),
      }),
    ),
  );
  const button = host.querySelector("button")!;
  vi.spyOn(button, "matches").mockReturnValue(true);
  const focus = async () => {
    await act(async () => {
      button.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  };
  document.documentElement.dataset.inputModality = "pointer";
  await focus();
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  document.documentElement.dataset.inputModality = "keyboard";
  await focus();
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("Close");
  delete document.documentElement.dataset.inputModality;
});

it("adds shared hints to an existing element without a layout box or lost events", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  const onClick = vi.fn();
  const onPointerEnter = vi.fn();
  await act(async () =>
    root.render(
      createElement(Tooltip, {
        label: "Opens details",
        asChild: true,
        delay: 0,
        children: createElement(
          "button",
          { type: "button", onClick, onPointerEnter, "aria-describedby": "existing" },
          "Open",
        ),
      }),
    ),
  );
  expect(host.children).toHaveLength(1);
  const button = host.firstElementChild as HTMLButtonElement;
  expect(button.hasAttribute("title")).toBe(false);
  await act(async () => {
    button.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  expect(onPointerEnter).toHaveBeenCalledOnce();
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("Opens details");
  expect(button.getAttribute("aria-describedby")).toContain("existing");
  act(() => button.click());
  expect(onClick).toHaveBeenCalledOnce();
  act(() => button.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  expect(button.getAttribute("aria-describedby")).toBe("existing");
});

afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("requires 450 ms on every control, even directly after another tooltip closes", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () =>
    root.render(
      ["First", "Second", "Third"].map((label) =>
        createElement(Tooltip, {
          key: label,
          label,
          asChild: true,
          children: createElement("button", { type: "button" }, label),
        }),
      ),
    ),
  );
  const [first, second, third] = host.querySelectorAll("button");
  const pointer = (element: HTMLButtonElement, type: "pointerover" | "pointerout") =>
    element.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: "mouse" }));
  const tooltip = () => document.querySelector('[role="tooltip"]');

  act(() => {
    pointer(first, "pointerover");
    vi.advanceTimersByTime(450);
  });
  expect(tooltip()?.textContent).toBe("First");
  act(() => {
    pointer(first, "pointerout");
    pointer(second, "pointerover");
    vi.advanceTimersByTime(60);
  });
  expect(tooltip()).toBeNull();
  act(() => {
    pointer(second, "pointerout");
    pointer(third, "pointerover");
    vi.advanceTimersByTime(449);
  });
  expect(tooltip()).toBeNull();
  act(() => vi.advanceTimersByTime(1));
  expect(tooltip()?.textContent).toBe("Third");

  act(() => {
    pointer(third, "pointerout");
    pointer(first, "pointerover");
  });
  vi.spyOn(first, "matches").mockReturnValue(true);
  act(() => first.dispatchEvent(new FocusEvent("focusin", { bubbles: true })));
  expect(tooltip()?.textContent).toBe("First");
});

function Anchor({ content, text }: { content: TooltipContent; text: string }) {
  const hint = useTooltip(content);
  return createElement(
    "div",
    null,
    createElement("button", { ...hint.trigger, id: "anchor", type: "button" }, text),
    hint.tooltip,
  );
}

async function hover(content: TooltipContent, text: string) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(createElement(Anchor, { content, text })));
  await act(async () => {
    host
      .querySelector("#anchor")!
      .dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
    await new Promise((resolve) => setTimeout(resolve, 1000));
  });
  return document.querySelector<HTMLElement>('[role="tooltip"]');
}

it("preserves explicitly supplied content when the anchor text matches", async () => {
  const tooltip = await hover({ label: "Notes", shortcut: "Ctrl+Shift+L" }, "Notes");
  expect(tooltip).not.toBeNull();
  expect(tooltip!.textContent).toContain("Notes");
  expect(tooltip!.querySelector('[role="img"]')).not.toBeNull();
});

it("leaves explicit tooltip content to its owner instead of suppressing it", async () => {
  expect((await hover({ label: "Notes" }, "Notes"))!.textContent).toBe("Notes");
});

it("still shows a label the control does not display, with its key caps", async () => {
  const tooltip = await hover({ label: "Open notes", shortcut: "Ctrl+Shift+L" }, "Notes");
  expect(tooltip!.textContent).toContain("Open notes");
});

it("keeps detail lines for a visible label", async () => {
  const tooltip = await hover({ label: "Notes", details: ["3 unread"] }, "Notes");
  expect(tooltip!.textContent).toBe("Notes3 unread");
});

it("does not infer overflow from different tooltip and anchor wording", async () => {
  expect(await hover({ when: "overflow", label: "Full notes title" }, "Notes")).toBeNull();
});

it("explains a disabled action even when its visible label does not overflow", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () =>
    root.render(
      createElement(
        Button,
        { disabled: true, disabledReason: "Choose a project first", tooltipWhen: "overflow" },
        "Start",
      ),
    ),
  );
  const button = host.querySelector("button")!;
  await act(async () => {
    button.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
    await new Promise((resolve) => setTimeout(resolve, 1000));
  });
  expect(button.getAttribute("aria-disabled")).toBe("true");
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("Choose a project first");
});
