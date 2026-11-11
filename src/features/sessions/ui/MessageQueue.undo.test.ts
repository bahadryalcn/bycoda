// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MessageQueue } from "./MessageQueue";
import { QueueRemovalNotice } from "./QueueRemovalNotice";
import type { QueuedMessage } from "../model/session";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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

it("removes once without confirmation and keeps Undo after the last row disappears", async () => {
  const undo = vi.fn(() => true);
  const remove = vi.fn();
  function Harness() {
    const [messages, setMessages] = useState<QueuedMessage[]>([
      { id: "q1", text: "saved message", attachments: [] },
    ]);
    return createElement(MessageQueue, {
      messages,
      canAttach: true,
      onDelete: (id) => {
        remove(id);
        const retained = messages;
        setMessages([]);
        return {
          undo: () => {
            setMessages(retained);
            return undo();
          },
        };
      },
    });
  }
  await act(async () => root.render(createElement(Harness)));
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Remove queued message"]')!
      .click(),
  );
  expect(remove).toHaveBeenCalledExactlyOnceWith("q1");
  expect(container.querySelector("[data-queue-handle]")).toBeNull();
  expect(container.querySelector("[data-queue-summary]")).toBeNull();
  expect(container.textContent).toContain("Message removed");
  expect(container.textContent).not.toContain("Confirm delete");
  const action = [...container.querySelectorAll("button")].find(
    (node) => node.textContent === "Undo",
  )!;
  await act(async () => action.click());
  expect(undo).toHaveBeenCalledOnce();
  expect(container.querySelector("[data-queue-handle]")).not.toBeNull();
  expect(container.querySelector("[data-queue-removal]")).toBeNull();
});

it("disposes retained removal recovery when the queue unmounts", async () => {
  const dispose = vi.fn();
  await act(async () =>
    root.render(
      createElement(MessageQueue, {
        messages: [{ id: "q1", text: "saved message", attachments: [] }],
        canAttach: true,
        onDelete: () => ({ undo: () => true, dispose }),
      }),
    ),
  );
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Remove queued message"]')!
      .click(),
  );
  expect(container.querySelector("[data-queue-removal]")).not.toBeNull();
  expect(dispose).not.toHaveBeenCalled();
  await act(async () => root.render(null));
  expect(dispose).toHaveBeenCalledOnce();
});

it("expires after five seconds and clears its timer on unmount", async () => {
  vi.useFakeTimers();
  const dismiss = vi.fn();
  await act(async () =>
    root.render(
      createElement(QueueRemovalNotice, {
        id: "removed",
        onUndo: async () => true,
        onDismiss: dismiss,
        disabled: false,
      }),
    ),
  );
  await act(async () => vi.advanceTimersByTime(4999));
  expect(dismiss).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTime(1));
  expect(dismiss).toHaveBeenCalledExactlyOnceWith("removed");
  await act(async () => root.render(null));
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps recovery available across pending and failed restores", async () => {
  vi.useFakeTimers();
  let reject!: (error: Error) => void;
  const undo = vi.fn(
    () =>
      new Promise<boolean>((_resolve, fail) => {
        reject = fail;
      }),
  );
  const dismiss = vi.fn();
  await act(async () =>
    root.render(
      createElement(QueueRemovalNotice, {
        id: "removed",
        onUndo: undo,
        onDismiss: dismiss,
        disabled: false,
      }),
    ),
  );
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  await act(async () => vi.advanceTimersByTime(6000));
  expect(dismiss).not.toHaveBeenCalled();
  await act(async () => reject(new Error("offline")));
  await act(async () => vi.advanceTimersByTime(6000));
  expect(dismiss).not.toHaveBeenCalled();
  expect(container.querySelector<HTMLButtonElement>("button")!.disabled).toBe(false);
});
