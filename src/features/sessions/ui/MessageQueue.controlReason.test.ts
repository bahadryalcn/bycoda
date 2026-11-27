// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MessageQueue } from "./MessageQueue";
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
  vi.unstubAllGlobals();
});

it("opens a long queue in pages and keeps every message reachable", async () => {
  const messages = Array.from({ length: 48 }, (_, i) => ({
    id: "q" + i,
    text: "Queued message " + i,
    attachments: [],
  }));
  await act(async () =>
    root.render(createElement(MessageQueue, { messages, canAttach: true, onSteer: () => true })),
  );
  const handles = () => Array.from(container.querySelectorAll("[data-queue-handle]"));
  expect(handles().length).toBeGreaterThan(5);
  expect(handles().length).toBeLessThan(messages.length);
  for (let page = 0; page < messages.length && handles().length < messages.length; page++) {
    const previousCount = handles().length;
    const more = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Show more",
    );
    expect(more).toBeDefined();
    await act(async () => more!.click());
    expect(handles().length).toBeGreaterThan(previousCount);
    expect(document.activeElement).toBe(handles()[previousCount]);
  }
  expect(handles().map((row) => row.getAttribute("data-queue-handle"))).toEqual(
    messages.map((m) => m.id),
  );
});

it("moves the last rendered row past the boundary and preserves keyboard focus", async () => {
  const messages = Array.from({ length: 48 }, (_, i) => ({
    id: "q" + i,
    text: "row",
    attachments: [],
  }));
  function Queue() {
    const [items, setItems] = useState(messages);
    return createElement(MessageQueue, {
      messages: items,
      canAttach: true,
      onReorder: (order) =>
        setItems(order.map((id) => messages.find((message) => message.id === id)!)),
    });
  }
  await act(async () => root.render(createElement(Queue)));
  const handles = () => [...container.querySelectorAll<HTMLButtonElement>("[data-queue-handle]")];
  const before = handles();
  const last = before[before.length - 1];
  last.focus();
  await act(async () => {
    last.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true }),
    );
  });
  expect(handles()[before.length]).toBe(last);
  expect(document.activeElement).toBe(last);
});

it("replaces Steer on an unconfirmed delivery with an inline notice and keeps row action names unduplicated", async () => {
  const messages: QueuedMessage[] = [
    { id: "q1", text: "first", attachments: [], deliveryUnknown: true },
    { id: "q2", text: "second", attachments: [] },
  ];
  await act(async () =>
    root.render(createElement(MessageQueue, { messages, canAttach: true, onSteer: () => true })),
  );
  const steer = [...container.querySelectorAll<HTMLButtonElement>('button[aria-label="Steer"]')];
  // The unconfirmed head settles in its own inline "Send again" notice; only the next row can Steer.
  expect(container.querySelector("[data-delivery-progress=unknown]")?.textContent).toContain(
    "Send again",
  );
  expect(steer).toHaveLength(1);
  expect(steer[0].getAttribute("aria-disabled")).toBeNull();
  for (const label of ["Reorder queued message", "Edit queued message"]) {
    for (const node of container.querySelectorAll(`button[aria-label="${label}"]`)) {
      expect(node.textContent).toBe("");
    }
  }
});

it.each([
  [
    "paused",
    false,
    "Resume",
    "This queue action is unavailable. Reopen the conversation and try again.",
  ],
  ["restored", true, "Send next", "Queue is waiting for the current turn to finish."],
  [undefined, true, "Steer", "This host cannot steer the active turn. The message remains queued."],
] as const)(
  "explains an unavailable queue action in status %s",
  async (status, busy, label, reason) => {
    const messages: QueuedMessage[] = [{ id: "q1", text: "first", attachments: [] }];
    await act(async () =>
      root.render(createElement(MessageQueue, { messages, status, busy, canAttach: true })),
    );
    const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (node) => node.getAttribute("aria-label") === label || node.textContent === label,
    );
    expect(button?.disabled).toBe(false);
    expect(button?.getAttribute("aria-disabled")).toBe("true");
    expect(button?.getAttribute("aria-description")).toBe(reason);
  },
);
