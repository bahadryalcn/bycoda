// @vitest-environment happy-dom
import fs from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Modal } from "./Modal";

let root: Root;
let container: HTMLDivElement;

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
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const flush = () => act(async () => {});

it("holds every dismissal path during a bounded operation and restores them afterwards", async () => {
  const onClose = vi.fn();
  const onEscape = vi.fn();
  const render = async (closeDisabled: boolean) =>
    act(async () =>
      root.render(
        createElement(Modal, {
          title: "Returning",
          onClose,
          onEscape,
          closeDisabled,
          children: "Returning to conversation…",
        }),
      ),
    );
  const close = () => document.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!;
  const backdrop = () => document.querySelector<HTMLElement>("[data-modal-layer]")!;
  const escape = () =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  await render(true);
  expect(close().disabled).toBe(true);
  await act(async () => {
    close().click();
    backdrop().dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    escape();
  });
  expect(onClose).not.toHaveBeenCalled();
  expect(onEscape).not.toHaveBeenCalled();
  await render(false);
  expect(close().disabled).toBe(false);
  await act(async () => escape());
  expect(onEscape).toHaveBeenCalledOnce();
  await act(async () => backdrop().dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
  await act(async () => close().click());
  expect(onClose).toHaveBeenCalledTimes(2);
});

describe("modal scrim layers", () => {
  it("renders one scrim per dialog layer, in opening order, for the nested-stack CSS", async () => {
    const Stack = ({ inner }: { inner: boolean }) =>
      createElement(Modal, {
        title: "Outer",
        onClose: vi.fn(),
        children: inner
          ? createElement(Modal, {
              title: "Inner",
              size: "sm",
              onClose: vi.fn(),
              children: "Inner body",
            })
          : "Outer body",
      });
    await act(async () => root.render(createElement(Stack, { inner: false })));
    await act(async () => root.render(createElement(Stack, { inner: true })));
    const layers = [...document.body.querySelectorAll(":scope > [data-modal-layer]")];
    expect(layers).toHaveLength(2);
    for (const layer of layers) expect(layer.querySelectorAll(".modal-backdrop")).toHaveLength(1);
    expect(layers[0]!.textContent).toContain("Outer");
    expect(layers[1]!.textContent).toContain("Inner body");
    // The scrim never takes pointer input from the dialog and carries no local colour or blur recipe.
    const scrim = layers[0]!.querySelector<HTMLElement>(".modal-backdrop")!;
    expect(scrim.className).toContain("pointer-events-none");
    expect(scrim.className).not.toMatch(/bg-|blur/);
  });

  it("keeps the nested dialog on top when both mount in the same commit", async () => {
    await act(async () =>
      root.render(
        createElement(Modal, {
          title: "Outer",
          onClose: vi.fn(),
          children: createElement(Modal, {
            title: "Inner",
            size: "sm",
            onClose: vi.fn(),
            children: "Inner body",
          }),
        }),
      ),
    );
    const layers = [...document.body.querySelectorAll(":scope > [data-modal-layer]")];
    expect(layers).toHaveLength(2);
    expect(layers[0]!.querySelector("[role='dialog']")!.textContent).toContain("Outer");
    expect(layers[1]!.textContent).toContain("Inner body");
  });

  it("keeps blur and dim in the shared theme layer, on the scrim only, with a lighter dim when nested", () => {
    const css = fs.readFileSync("src/styles/index.css", "utf8");
    expect(css).toMatch(/--ui-overlay-backdrop-blur:/);
    // A dialog above another still blurs the dialog beneath it; only its dim is lighter.
    const nested = css.match(
      /\[data-modal-layer\] ~ \[data-modal-layer\] \.modal-backdrop \{([^}]*)\}/,
    )?.[1];
    expect(nested).toContain("background: var(--ui-overlay-backdrop-nested);");
    expect(nested).not.toContain("backdrop-filter");
    expect(css).toMatch(
      /\.modal-backdrop \{[^}]*backdrop-filter: blur\(var\(--ui-overlay-backdrop-blur\)\)/,
    );
    expect(css).toMatch(
      /@media \(forced-colors: active\), \(prefers-reduced-transparency: reduce\)/,
    );
  });
});

describe("focus return", () => {
  function Host({ open, children }: { open: boolean; children?: unknown }) {
    return createElement(
      "section",
      { id: "context" },
      createElement("button", { id: "sibling" }, "Sibling"),
      children as never,
      open ? createElement(Modal, { title: "Example", onClose: vi.fn(), children: "Body" }) : null,
    );
  }

  it("returns focus to the opener without scrolling when the dialog closes", async () => {
    const trigger = createElement("button", { id: "opener", key: "opener" }, "Open");
    await act(async () => root.render(createElement(Host, { open: false, children: trigger })));
    const opener = document.getElementById("opener")!;
    opener.focus();
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    await act(async () => root.render(createElement(Host, { open: true, children: trigger })));
    expect(document.activeElement).not.toBe(opener);
    focus.mockClear();
    await act(async () => root.render(createElement(Host, { open: false, children: trigger })));
    await flush();
    expect(document.activeElement).toBe(opener);
    expect(focus.mock.calls.every(([options]) => options?.preventScroll === true)).toBe(true);
    expect(focus).toHaveBeenCalled();
  });

  it("falls back to the nearest surviving control in the same context when the opener is gone", async () => {
    const trigger = createElement("button", { id: "opener", key: "opener" }, "Open");
    await act(async () => root.render(createElement(Host, { open: false, children: trigger })));
    document.getElementById("opener")!.focus();
    await act(async () => root.render(createElement(Host, { open: true, children: trigger })));
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    // The confirmed action removed the opener and closed the dialog in the same commit.
    await act(async () => root.render(createElement(Host, { open: false })));
    await flush();
    expect(document.activeElement).toBe(document.getElementById("sibling"));
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
  });

  it("never falls back to the app root when the whole context is gone", async () => {
    function Top({ stage }: { stage: "closed" | "open" | "gone" }) {
      return stage === "gone"
        ? createElement("button", { id: "other" }, "Elsewhere")
        : createElement(
            "div",
            { id: "wrap" },
            createElement("button", { id: "opener" }, "Open"),
            stage === "open"
              ? createElement(Modal, { title: "Example", onClose: vi.fn(), children: "Body" })
              : null,
          );
    }
    await act(async () => root.render(createElement(Top, { stage: "closed" })));
    document.getElementById("opener")!.focus();
    await act(async () => root.render(createElement(Top, { stage: "open" })));
    await act(async () => root.render(createElement(Top, { stage: "gone" })));
    await flush();
    // `container` is a top-level root: it is not a context, so nothing is focused.
    expect(document.activeElement).toBe(document.body);
  });
});
