// @vitest-environment happy-dom
import { invoke } from "@tauri-apps/api/core";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageThread, ThreadMessage } from "../model/messagingTypes";
import {
  readReplyDraft,
  replyDraftKey,
  resetReplyDraftsForTests,
  writeReplyDraftBody,
} from "../model/replyDrafts";
import { MessageReplyComposer } from "./MessageReplyComposer";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => false }));

const thread: MessageThread = {
  id: "t1",
  accountId: "acc",
  provider: "slack",
  title: "#general",
  participants: [],
  preview: "",
  updatedAt: 1,
  unread: false,
};

const sent: ThreadMessage = {
  id: "m1",
  threadId: "t1",
  author: "me",
  body: "Hello",
  at: 2,
  outbound: true,
  attachments: [],
};

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  resetReplyDraftsForTests();
  vi.mocked(invoke).mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(onSent: (message: ThreadMessage) => void) {
  act(() =>
    root.render(createElement(MessageReplyComposer, { thread, replyAddress: null, onSent })),
  );
}

async function pressSend() {
  const field = container.querySelector("textarea");
  if (!field) throw new Error("no textarea");
  await act(async () => {
    field.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }),
    );
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe("MessageReplyComposer", () => {
  it("keeps the draft on failure and retries with the same request id", async () => {
    const key = replyDraftKey("acc", "t1");
    writeReplyDraftBody(key, "Hello");
    vi.mocked(invoke).mockRejectedValueOnce(new Error("network down")).mockResolvedValueOnce(sent);
    const onSent = vi.fn();
    render(onSent);

    expect(container.textContent).toContain("Sends to #general in Slack");
    await pressSend();
    expect(container.textContent).toContain("network down");
    expect(container.querySelector("textarea")?.value).toBe("Hello");
    expect(onSent).not.toHaveBeenCalled();

    await pressSend();
    expect(onSent).toHaveBeenCalledWith(sent);
    const calls = vi.mocked(invoke).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toBe("messaging_reply");
    const first = calls[0][1] as { requestId: string; body: string };
    const second = calls[1][1] as { requestId: string; body: string };
    expect(first.body).toBe("Hello");
    expect(second.requestId).toBe(first.requestId);
    expect(container.querySelector("textarea")?.value).toBe("");
    expect(readReplyDraft(key).body).toBe("");
  });

  it("does not send an empty draft", async () => {
    render(vi.fn());
    await pressSend();
    expect(invoke).not.toHaveBeenCalled();
  });
});
