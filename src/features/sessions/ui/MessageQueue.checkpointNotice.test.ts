// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { beginParentInputClosure } from "../data/parentInputClosure";
import { MessageQueue } from "./MessageQueue";
import type { QueuedMessage } from "../model/session";

// The composer's notice stack is the single owner of this line; the queue must not repeat it.
const CHECKPOINT_NOTICE = "Preparing session checkpoint. Your draft is kept.";
const messages: QueuedMessage[] = [{ id: "q1", text: "first", attachments: [] }];

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

it("does not repeat the checkpoint notice while the parent session closes its inputs", async () => {
  await act(async () =>
    root.render(
      createElement(MessageQueue, {
        parentSessionId: "queue-checkpoint-notice",
        messages,
        canAttach: true,
        onSteer: () => true,
        onDelete: () => true,
      }),
    ),
  );
  let close!: ReturnType<typeof beginParentInputClosure>;
  await act(async () => {
    close = beginParentInputClosure("queue-checkpoint-notice", { owner: {}, timeoutMs: 5000 });
  });
  expect(container.textContent).not.toContain(CHECKPOINT_NOTICE);
  await act(async () => close.release());
});
