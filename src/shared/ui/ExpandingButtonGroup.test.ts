// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ExpandingButtonGroup } from "./ExpandingButtonGroup";

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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const icon = createElement("svg");
const button = (id: string) => container.querySelector<HTMLButtonElement>(`[data-id="${id}"]`)!;
async function tap(id: string) {
  await act(async () => {
    const event = new Event("pointerdown", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "pointerType", { value: "touch" });
    button(id).dispatchEvent(event);
    button(id).click();
  });
}

it("awaits real success, blocks duplicate and concurrent activation, and clears confirmation on time", async () => {
  vi.useFakeTimers();
  let resolve!: (result: boolean) => void;
  const pending = new Promise<boolean>((done) => {
    resolve = done;
  });
  const copy = vi.fn(() => pending);
  const link = vi.fn();
  await act(async () =>
    root.render(
      createElement(ExpandingButtonGroup, {
        label: "Note actions",
        confirmDuration: 100,
        items: [
          { id: "copy", label: "Copy", doneLabel: "Copied", icon, onSelect: copy },
          { id: "link", label: "Link", icon, onSelect: link },
        ],
      }),
    ),
  );
  await act(async () => {
    button("copy").click();
    button("copy").click();
    button("link").click();
  });
  expect(copy).toHaveBeenCalledOnce();
  expect(link).not.toHaveBeenCalled();
  expect(button("copy").getAttribute("aria-busy")).toBe("true");
  expect(button("copy").dataset.state).toBe("idle");
  await act(async () => resolve(true));
  expect(button("copy").dataset.state).toBe("done");
  await act(async () => vi.advanceTimersByTime(100));
  expect(button("copy").dataset.state).toBe("idle");
});

it.each(["false", "rejection"])(
  "does not fabricate success after %s and allows retry",
  async (failure) => {
    const select = vi.fn(async () => {
      if (failure === "rejection") throw new Error("offline");
      return false;
    });
    await act(async () =>
      root.render(
        createElement(ExpandingButtonGroup, {
          label: "Actions",
          items: [{ id: "copy", label: "Copy", doneLabel: "Copied", icon, onSelect: select }],
        }),
      ),
    );
    await act(async () => button("copy").click());
    expect(button("copy").dataset.state).toBe("idle");
    expect(button("copy").getAttribute("aria-busy")).toBeNull();
    await act(async () => button("copy").click());
    expect(select).toHaveBeenCalledTimes(2);
  },
);

it("reveals a collapsed command on first touch and exposes disabled commands through keyboard navigation", async () => {
  const select = vi.fn();
  const disabled = vi.fn();
  await act(async () =>
    root.render(
      createElement(ExpandingButtonGroup, {
        label: "Actions",
        items: [
          { id: "copy", label: "Copy", icon },
          { id: "chat", label: "Add to chat", icon, onSelect: select },
          { id: "disabled", label: "Unavailable", icon, disabled: true, onSelect: disabled },
        ],
      }),
    ),
  );
  await tap("chat");
  expect(button("chat").dataset.expanded).toBeDefined();
  expect(select).not.toHaveBeenCalled();
  await tap("chat");
  expect(select).toHaveBeenCalledOnce();
  await act(async () => {
    button("chat").focus();
    button("chat").dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
  });
  expect(document.activeElement).toBe(button("disabled"));
  await act(async () => button("disabled").click());
  expect(disabled).not.toHaveBeenCalled();
});
