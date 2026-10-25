// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newSession, type Block, type ComposerTurnOptions } from "../model/session";
import { failedTurnRetry, RetryFailedTurn } from "./RetryFailedTurn";
import { sessionIssue } from "../model/sessionIssue";
import { isNoticeBlock, isActivityBlock } from "../model/transcriptActivity";

const blocks: Block[] = [
  {
    id: "user",
    role: "user",
    text: "Inspect this image",
    intent: "plan",
    attachments: [
      {
        id: "image",
        kind: "image",
        name: "image.png",
        mimeType: "image/png",
        size: 10,
        data: "abc",
      },
    ],
  },
  {
    id: "error",
    role: "system",
    notice: "error",
    text: "Selected model is at capacity. Please try a different model.",
  },
];
const chat = () => ({ ...newSession("codex", "/tmp"), blocks });

it("keeps legacy host writer errors visible, failed and retryable", () => {
  const error: Block = {
    id: "legacy-error",
    role: "system",
    text: "thread old-thread already has an active writer",
  };
  const session = { ...chat(), blocks: [blocks[0], error] };
  expect(sessionIssue(session)).toBe("failed");
  expect(isNoticeBlock(error)).toBe(true);
  expect(isActivityBlock(error)).toBe(false);
  expect(failedTurnRetry(session)?.errorId).toBe(error.id);
  expect(sessionIssue({ ...session, blocks: [{ ...error, role: "user" }] })).toBeUndefined();
});
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("resends the original text, attachments and intent once without needing a provider turn id", () => {
  const onSubmit = vi.fn();
  act(() => root.render(createElement(RetryFailedTurn, { session: chat(), onSubmit })));
  const button = host.querySelector("button")!;
  act(() => {
    button.click();
    button.click();
  });
  expect(onSubmit).toHaveBeenCalledOnce();
  expect(onSubmit).toHaveBeenCalledWith(
    blocks[0].text,
    blocks[0].attachments,
    expect.objectContaining({ intent: "plan", onSendRejected: expect.any(Function) }),
  );
  expect(button.getAttribute("aria-busy")).toBe("true");
});

it("allows retry again after immediate or asynchronous rejection", () => {
  let options: ComposerTurnOptions | undefined;
  const onSubmit = vi.fn((_text, _attachments, next: ComposerTurnOptions | undefined) => {
    options = next;
    return onSubmit.mock.calls.length === 1 ? false : undefined;
  });
  act(() => root.render(createElement(RetryFailedTurn, { session: chat(), onSubmit })));
  const button = host.querySelector("button")!;
  act(() => button.click());
  expect(button.disabled).toBe(false);
  act(() => button.click());
  expect(button.getAttribute("aria-busy")).toBe("true");
  act(() => {
    options?.onSendRejected?.();
  });
  expect(button.disabled).toBe(false);
});

it("only offers the latest failed turn and hides once a new turn starts or recovers", () => {
  expect(failedTurnRetry(chat())?.errorId).toBe("error");
  expect(
    failedTurnRetry({ ...chat(), blocks: [...blocks, { id: "next", role: "user", text: "Next" }] }),
  ).toBeNull();
  expect(
    failedTurnRetry({
      ...chat(),
      blocks: [...blocks, { id: "answer", role: "assistant", text: "Done" }],
    }),
  ).toBeNull();
  expect(
    failedTurnRetry({
      ...chat(),
      blocks: [blocks[0], { id: "tool", role: "tool", text: "Failed", tool: { status: "failed" } }],
    }),
  ).toBeNull();
});

it("enables retry for a new failure without letting an old rejection unlock it", () => {
  const options: ComposerTurnOptions[] = [];
  const onSubmit = vi.fn((_text, _attachments, next: ComposerTurnOptions | undefined) => {
    options.push(next!);
  });
  act(() => root.render(createElement(RetryFailedTurn, { session: chat(), onSubmit })));
  act(() => host.querySelector("button")!.click());
  const session = {
    ...chat(),
    blocks: [...blocks, { ...blocks[0], id: "retry-user" }, { ...blocks[1], id: "new-error" }],
  };
  act(() => root.render(createElement(RetryFailedTurn, { session, onSubmit })));
  const button = host.querySelector("button")!;
  expect(button.disabled).toBe(false);
  act(() => button.click());
  act(() => {
    options[0].onSendRejected?.();
  });
  expect(button.getAttribute("aria-busy")).toBe("true");
  act(() => {
    options[1].onSendRejected?.();
  });
  expect(button.disabled).toBe(false);
});

it("holds retry during work, questions, queued sends, incomplete history and host conflicts", () => {
  for (const patch of [
    { busy: true },
    { historyLoading: true },
    { adoptedSyncConflict: true },
    { continuingElsewhere: true },
    { worktreeRemoved: true },
    { editingQueuedMessageId: "queued" },
    { queuedMessages: [{ id: "queued", text: "Next", attachments: [] }] },
    { pendingQuestion: {} as NonNullable<ReturnType<typeof chat>["pendingQuestion"]> },
  ])
    expect(failedTurnRetry({ ...chat(), ...patch })).toBeNull();
  act(() =>
    root.render(
      createElement(RetryFailedTurn, { session: chat(), blocked: true, onSubmit: vi.fn() }),
    ),
  );
  expect(host.querySelector("button")).toBeNull();
});
