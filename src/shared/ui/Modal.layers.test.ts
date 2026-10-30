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

  it("keeps blur and dim in the shared theme layer, only on the scrim and only once when nested", () => {
    const css = fs.readFileSync("src/styles/index.css", "utf8");
    expect(css).toMatch(/--ui-overlay-backdrop-blur:/);
    expect(css).toMatch(
      /\[data-modal-layer\] ~ \[data-modal-layer\] \.modal-backdrop \{[^}]*backdrop-filter: none;/,
    );
    expect(css).toMatch(/\.modal-backdrop \{[^}]*backdrop-filter: blur\(var\(--ui-overlay-backdrop-blur\)\)/);
    expect(css).toMatch(/@media \(forced-colors: active\), \(prefers-reduced-transparency: reduce\)/);
  });
});

describe("focus return", () => {
  function Host({ open, children }: { open: boolean; children?: unknown }) {
    return createElement(
      "section",
      { id: "context" },
      createElement("button", { id: "sibling" }, "Sibling"),
      children as never,
      open
        ? createElement(Modal, { title: "Example", onClose: vi.fn(), children: "Body" })
        : null,
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
