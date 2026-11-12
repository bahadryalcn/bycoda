// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ConfirmDialog, useConfirm, type ConfirmRequest } from "./ConfirmDialog";

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
  vi.unstubAllGlobals();
});

async function render(request: ConfirmRequest, onSettle = vi.fn()) {
  await act(async () => root.render(createElement(ConfirmDialog, { request, onSettle })));
  return onSettle;
}

const button = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (el) => el.textContent?.trim() === name,
  )!;
const click = (el: Element) =>
  act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

it("uses the standard padded Modal body and Cancel before the destructive action", async () => {
  await render({ title: "Delete?", message: "Cannot be undone", confirmLabel: "Delete" });
  const body = document.querySelector<HTMLElement>("[data-modal-scroll]")!;
  expect(body.className).toContain("px-4 pt-2 pb-4");
  expect(body.firstElementChild?.className).not.toMatch(/\bp[xy]-/);
  const actions = [...document.querySelectorAll("footer button")].map((node) =>
    node.textContent?.trim(),
  );
  expect(actions).toEqual(["Cancel", "Delete"]);
});

it("renders updated caller content without resetting an open confirmation", async () => {
  let open!: () => Promise<boolean>;
  const request = (message: string): ConfirmRequest => ({
    title: "Delete?",
    message,
    confirmLabel: "Delete",
    acknowledge: { label: "Also remove", control: "switch" },
  });
  function Probe({ message }: { message: string }) {
    const confirmation = useConfirm();
    open = () => confirmation.confirm(request(message));
    return confirmation.renderDialog(request(message));
  }
  await act(async () => root.render(createElement(Probe, { message: "First" })));
  let result!: Promise<boolean>;
  await act(async () => {
    result = open();
  });
  expect(document.body.textContent).toContain("First");
  const toggle = document.querySelector<HTMLButtonElement>('[role="switch"]')!;
  await click(toggle);
  await act(async () => root.render(createElement(Probe, { message: "Updated" })));
  expect(document.body.textContent).toContain("Updated");
  expect(document.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true");
  await click(button("Delete"));
  expect(await result).toBe(true);
});
const escape = () =>
  act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

it("uses the danger tone unless the request opts out", async () => {
  await render({ title: "Delete?", message: "Gone.", confirmLabel: "Delete" });
  expect(button("Delete").dataset.buttonTone).toBe("danger");
  await act(async () => root.unmount());
  root = createRoot(container);
  await render({ title: "Continue?", message: "Ok.", confirmLabel: "Continue", danger: false });
  expect(button("Continue").dataset.buttonTone).not.toBe("danger");
});

it("settles true at once without async work and false on cancel", async () => {
  const settle = await render({ title: "Delete?", message: "Gone.", confirmLabel: "Delete" });
  await click(button("Delete"));
  expect(settle).toHaveBeenLastCalledWith(true);
  await click(button("Cancel"));
  expect(settle).toHaveBeenLastCalledWith(false);
});

it("blocks double submit, ignores Escape and Cancel while pending, then settles", async () => {
  const work = deferred();
  const onConfirm = vi.fn(() => work.promise);
  const settle = await render({
    title: "Delete?",
    message: "Gone.",
    confirmLabel: "Delete",
    onConfirm,
  });
  // Two clicks in one tick must still start one operation.
  await act(async () => {
    button("Delete").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    button("Delete").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(onConfirm).toHaveBeenCalledTimes(1);
  expect(button("Delete").getAttribute("aria-busy")).toBe("true");
  expect(button("Cancel").disabled).toBe(true);
  await click(button("Cancel"));
  await escape();
  expect(settle).not.toHaveBeenCalled();
  await act(async () => work.resolve());
  expect(settle).toHaveBeenCalledWith(true);
});

it("keeps the dialog open on failure with the error visible and allows a retry", async () => {
  const first = deferred();
  const second = deferred();
  const onConfirm = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const settle = await render({
    title: "Delete?",
    message: "Gone.",
    confirmLabel: "Delete",
    onConfirm,
  });
  await click(button("Delete"));
  await act(async () => first.reject(new Error("Worktree is locked")));
  expect(settle).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Worktree is locked");
  expect(button("Delete").getAttribute("aria-busy")).toBeNull();
  expect(button("Cancel").disabled).toBe(false);
  await click(button("Delete"));
  expect(onConfirm).toHaveBeenCalledTimes(2);
  // The previous failure clears while the retry is in flight.
  expect(document.querySelector('[role="alert"]')).toBeNull();
  await act(async () => second.resolve());
  expect(settle).toHaveBeenCalledWith(true);
});

it("closes through Escape when nothing is pending", async () => {
  const settle = await render({ title: "Delete?", message: "Gone.", confirmLabel: "Delete" });
  await escape();
  expect(settle).toHaveBeenCalledWith(false);
});

it("calls onCancel synchronously on Cancel and Escape before settling", async () => {
  const onCancel = vi.fn();
  const request: ConfirmRequest = {
    title: "Delete?",
    message: "Gone.",
    confirmLabel: "Delete",
    onCancel,
  };
  const settle = await render(request);
  await click(button("Cancel"));
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(settle).toHaveBeenLastCalledWith(false);
  await render(request);
  await escape();
  expect(onCancel).toHaveBeenCalledTimes(2);
});

it("gives a second request with the same title a fresh dialog instance", async () => {
  let open!: () => Promise<boolean>;
  const request: ConfirmRequest = {
    title: "Delete?",
    message: "Gone.",
    confirmLabel: "Delete",
    acknowledge: { label: "Also remove", control: "switch" },
  };
  function Probe() {
    const confirmation = useConfirm();
    open = () => confirmation.confirm(request);
    return confirmation.dialog;
  }
  await act(async () => root.render(createElement(Probe)));
  await act(async () => {
    void open();
  });
  await click(document.querySelector<HTMLButtonElement>('[role="switch"]')!);
  expect(document.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true");
  await act(async () => {
    void open();
  });
  expect(document.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("false");
});
