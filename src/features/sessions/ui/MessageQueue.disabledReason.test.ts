// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { beginParentInputClosure } from "../data/parentInputClosure";
import { MessageQueue } from "./MessageQueue";
import type { QueuedMessage } from "../model/session";

const SENDING = "Unavailable while the queue is sending";
const CHECKPOINT = "Unavailable while the session checkpoint is prepared";
const messages: QueuedMessage[] = [
  { id: "q1", text: "first", attachments: [] },
  { id: "q2", text: "second", attachments: [] },
];
const rowActions = [
  "Reorder queued message",
  "Steer",
  "Edit queued message",
  "Remove queued message",
];

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

const buttons = (label: string) =>
  [...container.querySelectorAll<HTMLButtonElement>(`button[aria-label="${label}"]`)];

it("names why every row action is off while a queued send is pending", async () => {
  await act(async () =>
    root.render(
      createElement(MessageQueue, {
        messages,
        canAttach: true,
        onSteer: () => new Promise<boolean>(() => {}),
        onDelete: () => true,
      }),
    ),
  );
  for (const label of rowActions) {
    expect(buttons(label)).toHaveLength(2);
    for (const node of buttons(label)) {
      expect(node.getAttribute("aria-disabled"), label).toBeNull();
      expect(node.getAttribute("aria-description"), label).toBeNull();
    }
  }
  await act(async () => buttons("Steer")[0].click());
  // The sending row's Steer is now labelled "Sending…"; every other action is off and explained.
  const sending = buttons("Sending…");
  expect(sending).toHaveLength(1);
  const off = [...sending, ...rowActions.flatMap((label) => buttons(label))];
  expect(off).toHaveLength(8);
  for (const node of off) {
    expect(node.getAttribute("aria-disabled"), node.ariaLabel ?? "").toBe("true");
    expect(node.getAttribute("aria-description"), node.ariaLabel ?? "").toBe(SENDING);
  }
});

it("names the checkpoint while the session closes its inputs and clears it afterwards", async () => {
  const onDelete = vi.fn();
  await act(async () =>
    root.render(
      createElement(MessageQueue, {
        parentSessionId: "queue-disabled-reason",
        messages,
        canAttach: true,
        onSteer: () => true,
        onDelete,
      }),
    ),
  );
  let close!: ReturnType<typeof beginParentInputClosure>;
  await act(async () => {
    close = beginParentInputClosure("queue-disabled-reason", { owner: {}, timeoutMs: 5000 });
  });
  const off = rowActions.flatMap((label) => buttons(label));
  expect(off).toHaveLength(8);
  for (const node of off) {
    expect(node.getAttribute("aria-disabled"), node.ariaLabel ?? "").toBe("true");
    expect(node.getAttribute("aria-description"), node.ariaLabel ?? "").toBe(CHECKPOINT);
  }
  // An explained control stays focusable but inert: the admission conditions are unchanged.
  await act(async () => buttons("Remove queued message")[0].click());
  expect(onDelete).not.toHaveBeenCalled();
  await act(async () => close.release());
  for (const node of rowActions.flatMap((label) => buttons(label))) {
    expect(node.getAttribute("aria-disabled"), node.ariaLabel ?? "").toBeNull();
    expect(node.getAttribute("aria-description"), node.ariaLabel ?? "").toBeNull();
  }
});

it("explains Undo while another queue action is pending", async () => {
  await act(async () =>
    root.render(
      createElement(MessageQueue, {
        messages,
        canAttach: true,
        onDelete: () => ({ undo: () => new Promise<boolean>(() => {}) }),
      }),
    ),
  );
  await act(async () => buttons("Remove queued message")[0].click());
  await act(async () => buttons("Remove queued message")[1].click());
  const undo = () => [
    ...container.querySelectorAll<HTMLButtonElement>("[data-queue-removal] button"),
  ];
  expect(undo()).toHaveLength(2);
  for (const node of undo()) expect(node.getAttribute("aria-description")).toBeNull();
  await act(async () => undo()[0].click());
  for (const node of undo()) {
    expect(node.getAttribute("aria-disabled")).toBe("true");
    expect(node.getAttribute("aria-description")).toBe(SENDING);
  }
});
