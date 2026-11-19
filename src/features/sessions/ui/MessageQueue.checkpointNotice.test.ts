// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { beginParentInputClosure } from "../data/parentInputClosure";
import { Composer } from "./Composer";
import { MessageQueue } from "./MessageQueue";
import type { QueuedMessage } from "../model/session";

vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  invoke: async () => [],
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));

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

it("announces the checkpoint once with a pending question and a queued message", async () => {
  const sessionId = "composer-checkpoint-notice";
  const noop = () => {};
  await act(async () =>
    root.render(
      createElement(Composer, {
        sessionId,
        focused: false,
        harness: "codex",
        model: "",
        runtimeMode: "supervised",
        executionCwd: "/fixture",
        hideTopBar: true,
        queuedMessages: messages,
        question: {
          requestId: 1,
          questions: [
            {
              id: "answer",
              prompt: "Pending question",
              multiSelect: false,
              allowCustom: true,
              options: [],
            },
          ],
        },
        onFocus: noop,
        onCwdChange: noop,
        onModelChange: noop,
        onRuntimeModeChange: noop,
        onQuestionReply: noop,
        onSubmit: noop,
      }),
    ),
  );
  expect(container.textContent).toContain("Pending question");
  expect(container.textContent).toContain(messages[0].text);
  const notices = () =>
    [...container.querySelectorAll('[role="status"]')].filter(
      (element) => element.textContent === CHECKPOINT_NOTICE,
    );
  expect(notices()).toHaveLength(0);

  let close!: ReturnType<typeof beginParentInputClosure>;
  await act(async () => {
    close = beginParentInputClosure(sessionId, { owner: {}, timeoutMs: 5000 });
  });
  try {
    expect(notices()).toHaveLength(1);
    expect(container.textContent?.split(CHECKPOINT_NOTICE)).toHaveLength(2);
  } finally {
    await act(async () => close.release());
  }
  expect(notices()).toHaveLength(0);
});
