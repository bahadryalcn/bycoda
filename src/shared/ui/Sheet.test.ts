// @vitest-environment happy-dom
import { Activity, act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Sheet } from "./Sheet";
import { Modal } from "./Modal";

it("leaves Escape in another pane alone and closes only the focused pane", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const first = vi.fn();
  const second = vi.fn();
  try {
    act(() =>
      root.render(
        createElement(
          "div",
          null,
          ...[first, second].map((onClose, index) =>
            createElement(
              "div",
              { key: index },
              createElement("button", { id: `outside-${index}` }, "Catalog"),
              createElement(Sheet, {
                modal: false,
                anchor: "container",
                title: `Pane ${index}`,
                initialFocus: false,
                dismissOnOutside: false,
                onClose,
                children: createElement("input", { id: `inside-${index}` }),
              }),
            ),
          ),
        ),
      ),
    );
    document.getElementById("inside-1")!.focus();
    act(() =>
      document.activeElement!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      ),
    );
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  } finally {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it("leaves Escape to a nested modal before closing its container sheet", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const close = vi.fn();
  const closeModal = vi.fn();
  const draw = (nested: boolean) =>
    act(() =>
      root.render(
        createElement(Sheet, {
          modal: false,
          anchor: "container",
          title: "Details",
          initialFocus: false,
          onClose: close,
          children: createElement(
            "div",
            null,
            createElement("input", { id: "sheet-draft", defaultValue: "draft" }),
            nested
              ? createElement(Modal, {
                  title: "Edit",
                  onClose: closeModal,
                  children: createElement("input"),
                })
              : null,
          ),
        }),
      ),
    );
  try {
    draw(true);
    act(() =>
      document.activeElement!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      ),
    );
    expect(closeModal).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    draw(false);
    document.getElementById("sheet-draft")!.focus();
    act(() =>
      document.activeElement!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      ),
    );
    expect(close).toHaveBeenCalledOnce();
  } finally {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it("releases Escape while Activity hides the sheet and preserves its draft", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const close = vi.fn();
  const draw = (visible: boolean) =>
    act(() =>
      root.render(
        createElement(Activity, {
          mode: visible ? "visible" : "hidden",
          children: createElement(Sheet, {
            modal: false,
            anchor: "container",
            title: "Details",
            initialFocus: false,
            onClose: close,
            children: createElement("input", { id: "retained-draft", defaultValue: "draft" }),
          }),
        }),
      ),
    );
  try {
    draw(true);
    const field = document.getElementById("retained-draft") as HTMLInputElement;
    field.value = "unfinished";
    draw(false);
    act(() =>
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      ),
    );
    expect(close).not.toHaveBeenCalled();
    draw(true);
    expect(document.getElementById("retained-draft")).toBe(field);
    expect(field.value).toBe("unfinished");
    field.focus();
    act(() =>
      field.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
          isComposing: true,
        }),
      ),
    );
    expect(close).not.toHaveBeenCalled();
    act(() =>
      field.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      ),
    );
    expect(close).toHaveBeenCalledOnce();
  } finally {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it("keeps a persistent non-modal workspace named as a region with its custom header", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const close = vi.fn();
  try {
    act(() =>
      root.render(
        createElement(Sheet, {
          modal: false,
          role: "region",
          anchor: "container",
          title: "Server details",
          header: createElement("h2", null, "Production"),
          dismissOnOutside: false,
          onClose: close,
          children: createElement("input", { defaultValue: "draft" }),
        }),
      ),
    );
    const region = document.querySelector<HTMLElement>(
      '[role="region"][aria-label="Server details"]',
    )!;
    expect(region.textContent).toContain("Production");
    expect(region.hasAttribute("aria-modal")).toBe(false);
    region.querySelector("input")!.focus();
    act(() =>
      region
        .querySelector("input")!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(close).toHaveBeenCalledOnce();
  } finally {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it.each(["container", "viewport"] as const)(
  "hides a closed %s sheet that stays mounted, and shows it again on reopen",
  (anchor) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const render = (open: boolean) =>
      act(() =>
        root.render(
          createElement(Sheet, {
            modal: false,
            anchor,
            side: "end",
            open,
            title: "Panel",
            onClose: () => undefined,
            children: createElement("textarea", { defaultValue: "draft" }),
          }),
        ),
      );
    try {
      render(true);
      const panel = document.querySelector<HTMLElement>('section[role="dialog"]')!;
      expect(panel.hidden).toBe(false);
      render(false);
      // A closed panel must not stay painted over the pane while its content is kept.
      expect(document.querySelector<HTMLElement>('section[role="dialog"]')).toBe(panel);
      expect(panel.hidden).toBe(true);
      expect(panel.querySelector("textarea")?.value).toBe("draft");
      render(true);
      expect(panel.hidden).toBe(false);
    } finally {
      act(() => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  },
);

it.each([
  [undefined, undefined, true],
  ["md", "auto", true],
  ["none", "auto", false],
  [undefined, "none", false],
] as const)("non-modal body padding=%s scroll=%s pads: %s", (padding, scroll, padded) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    act(() =>
      root.render(
        createElement(Sheet, {
          modal: false,
          anchor: "container",
          title: "Panel",
          onClose: () => undefined,
          padding,
          scroll,
          children: createElement("p", { id: "child" }, "x"),
        }),
      ),
    );
    const body = document.getElementById("child")!.parentElement!;
    expect(body.classList.contains("px-4")).toBe(padded);
    expect(body.classList.contains("pb-4")).toBe(padded);
  } finally {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
