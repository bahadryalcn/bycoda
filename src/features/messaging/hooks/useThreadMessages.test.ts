// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { MessageThread, ThreadMessage } from "../model/messagingTypes";
import { useThreadMessages } from "./useThreadMessages";

const list = vi.hoisted(() => vi.fn());
vi.mock("../model/messagingApi", () => ({ listThreadMessages: list }));

function message(id: string, at: number): ThreadMessage {
  return { id, threadId: "t", author: "Ada", body: id, at, outbound: false, attachments: [] };
}

function thread(updatedAt: number): MessageThread {
  return {
    id: "t",
    accountId: "acct",
    provider: "slack",
    title: "t",
    participants: [],
    preview: "",
    updatedAt,
    unread: false,
  };
}

it("pages earlier messages in and keeps them across a refresh and a sent reply", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let newest = [message("c", 3), message("d", 4)];
  list.mockImplementation(async (_account: string, _thread: string, before?: string) =>
    before === "before-c"
      ? { messages: [message("a", 1), message("b", 2)] }
      : { messages: newest, earlier: "before-c" },
  );
  let result!: ReturnType<typeof useThreadMessages>;
  function Probe({ updatedAt }: { updatedAt: number }) {
    result = useThreadMessages(thread(updatedAt));
    return null;
  }
  const root = createRoot(document.createElement("div"));
  const ids = () => result.messages?.map((entry) => entry.id);
  try {
    await act(async () => root.render(createElement(Probe, { updatedAt: 1 })));
    expect(ids()).toEqual(["c", "d"]);
    expect(result.hasEarlier).toBe(true);

    await act(async () => result.loadEarlier());
    expect(list).toHaveBeenLastCalledWith("acct", "t", "before-c");
    expect(ids()).toEqual(["a", "b", "c", "d"]);
    // The oldest page has no cursor: the history is complete.
    expect(result.hasEarlier).toBe(false);

    // Newer activity refreshes only the newest page and must not drop the earlier ones.
    newest = [message("c", 3), message("d", 4), message("e", 5)];
    await act(async () => root.render(createElement(Probe, { updatedAt: 2 })));
    expect(ids()).toEqual(["a", "b", "c", "d", "e"]);
    expect(result.hasEarlier).toBe(false);

    await act(async () => result.append({ ...message("sent", 6), outbound: true }));
    expect(ids()).toEqual(["a", "b", "c", "d", "e", "sent"]);

    // An explicit reload starts over from the newest page.
    await act(async () => result.reload());
    expect(ids()).toEqual(["c", "d", "e"]);
    expect(result.hasEarlier).toBe(true);
  } finally {
    await act(async () => root.unmount());
  }
});

it("keeps the loaded messages and offers a retry when an earlier page fails", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let fail = true;
  list.mockImplementation(async (_account: string, _thread: string, before?: string) => {
    if (!before) return { messages: [message("c", 3)], earlier: "before-c" };
    if (fail) throw new Error("offline");
    return { messages: [message("b", 2)] };
  });
  let result!: ReturnType<typeof useThreadMessages>;
  function Probe() {
    result = useThreadMessages({ ...thread(7), id: "retry" });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Probe)));
    await act(async () => result.loadEarlier());
    expect(result.earlierError).toContain("offline");
    expect(result.messages?.map((entry) => entry.id)).toEqual(["c"]);
    expect(result.hasEarlier).toBe(true);

    fail = false;
    await act(async () => result.loadEarlier());
    expect(result.earlierError).toBeNull();
    expect(result.messages?.map((entry) => entry.id)).toEqual(["b", "c"]);
  } finally {
    await act(async () => root.unmount());
  }
});

it("ignores a second request for the same cursor while one is pending", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let release!: () => void;
  const calls: (string | undefined)[] = [];
  list.mockImplementation(async (_account: string, _thread: string, before?: string) => {
    calls.push(before);
    if (!before) return { messages: [message("c", 3)], earlier: "before-c" };
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return { messages: [message("b", 2)] };
  });
  let result!: ReturnType<typeof useThreadMessages>;
  function Probe() {
    result = useThreadMessages({ ...thread(8), id: "pending" });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Probe)));
    await act(async () => {
      result.loadEarlier();
      result.loadEarlier();
    });
    expect(calls.filter((before) => before === "before-c")).toHaveLength(1);
    expect(result.loadingEarlier).toBe(true);
    await act(async () => release());
    expect(result.loadingEarlier).toBe(false);
    expect(result.messages?.map((entry) => entry.id)).toEqual(["b", "c"]);
  } finally {
    await act(async () => root.unmount());
  }
});
