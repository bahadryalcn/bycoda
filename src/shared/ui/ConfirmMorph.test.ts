// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ConfirmMorph } from "./ConfirmMorph";

let root: Root;
let container: HTMLDivElement;
let now: number;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  now = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
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
const control = () => container.firstElementChild as HTMLDivElement;
const button = (label: string) =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => !node.closest("[inert]") && node.textContent?.includes(label),
  )!;
async function click(label: string) {
  await act(async () => button(label).click());
}

it("keeps arming grace, prevents duplicate pending execution and focuses real reject/retry/undo states", async () => {
  let reject!: (error: Error) => void;
  const confirm = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, fail) => {
          reject = fail;
        }),
    )
    .mockResolvedValue(undefined);
  const undo = vi.fn().mockRejectedValueOnce(new Error("Undo failed")).mockResolvedValue(undefined);
  const ref = createRef<HTMLDivElement>();
  await act(async () =>
    root.render(
      createElement(ConfirmMorph, {
        ref,
        label: "Delete note",
        onConfirm: confirm,
        onUndo: undo,
        confirmTimeout: 0,
        resultTimeout: 0,
      }),
    ),
  );
  expect(ref.current).toBe(control());
  await click("Delete note");
  expect(document.activeElement).toBe(button("Confirm delete"));
  now += 100;
  await click("Confirm delete");
  expect(confirm).not.toHaveBeenCalled();
  now += 300;
  await act(async () => {
    button("Confirm delete").click();
    button("Confirm delete").click();
  });
  expect(confirm).toHaveBeenCalledOnce();
  expect(control().dataset.state).toBe("pending");
  expect(document.activeElement).toBe(control());
  expect(container.querySelector('button[aria-busy="true"]')).not.toBeNull();
  await act(async () => reject(new Error("Offline")));
  expect(control().dataset.state).toBe("error");
  expect(document.activeElement).toBe(button("Retry"));
  await click("Retry");
  expect(confirm).toHaveBeenCalledTimes(2);
  expect(control().dataset.state).toBe("done");
  expect(document.activeElement).toBe(button("Undo"));
  await click("Undo");
  expect(control().dataset.state).toBe("error");
  await click("Retry");
  expect(undo).toHaveBeenCalledTimes(2);
  expect(control().dataset.state).toBe("idle");
  expect(document.activeElement).toBe(button("Delete note"));
});

it("preserves hold pointer capture and cancels before confirmation on pointer cancellation", async () => {
  const confirm = vi.fn();
  const cancel = vi.fn();
  await act(async () =>
    root.render(
      createElement(ConfirmMorph, {
        label: "Delete note",
        confirmMode: "hold",
        holdDuration: 1000,
        onConfirm: confirm,
        onCancel: cancel,
        confirmTimeout: 0,
      }),
    ),
  );
  await click("Delete note");
  now += 300;
  const hold = button("Confirm delete");
  const capture = vi.fn();
  Object.defineProperty(hold, "setPointerCapture", { value: capture });
  await act(async () => {
    const down = new Event("pointerdown", { bubbles: true });
    Object.defineProperties(down, { button: { value: 0 }, pointerId: { value: 7 } });
    hold.dispatchEvent(down);
    hold.dispatchEvent(new Event("pointercancel", { bubbles: true }));
  });
  expect(capture).toHaveBeenCalledWith(7);
  expect(confirm).not.toHaveBeenCalled();
  await act(async () =>
    hold.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  expect(control().dataset.state).toBe("idle");
  expect(cancel).toHaveBeenCalledOnce();
});

it.each(["escape", "outside"])(
  "cancels countdown through %s without running the operation",
  async (reason) => {
    const confirm = vi.fn();
    const cancel = vi.fn();
    await act(async () =>
      root.render(
        createElement(ConfirmMorph, {
          label: "Delete note",
          confirmMode: "countdown",
          countdown: 30,
          onConfirm: confirm,
          onCancel: cancel,
          confirmTimeout: 0,
        }),
      ),
    );
    await click("Delete note");
    now += 300;
    await click("Confirm delete");
    expect(control().dataset.face).toBe("counting");
    await act(async () => {
      if (reason === "escape")
        control().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      else document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(control().dataset.state).toBe("idle");
    expect(cancel).toHaveBeenCalledOnce();
    expect(confirm).not.toHaveBeenCalled();
  },
);
