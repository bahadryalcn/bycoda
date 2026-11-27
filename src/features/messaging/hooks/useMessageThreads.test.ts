// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { MessageThread, MessagingAccount } from "../model/messagingTypes";
import { MESSAGES_REFRESH_INTERVAL_MS, useMessageThreads } from "./useMessageThreads";

const list = vi.hoisted(() => vi.fn());
vi.mock("../model/messagingApi", () => ({ listMessageThreads: list }));

it("shares unchanged threads across polls, including unchanged timestamps with changed content", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const accounts: MessagingAccount[] = [
    {
      id: "poll-test",
      provider: "slack",
      label: "",
      identity: "",
      config: {},
      connected: true,
      createdAt: 1,
      updatedAt: 1,
    },
  ];
  let rows: MessageThread[] = ["a", "b"].map((id) => ({
    id,
    accountId: accounts[0].id,
    provider: "slack",
    title: id,
    participants: ["Ada"],
    preview: "hello",
    updatedAt: 2,
    unread: false,
  }));
  list.mockImplementation(async () =>
    rows.map((thread) => ({ ...thread, participants: [...thread.participants] })),
  );
  let result!: ReturnType<typeof useMessageThreads>;
  function Probe() {
    result = useMessageThreads(accounts, true);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Probe)));
    const first = result.threads;
    await act(async () => vi.advanceTimersByTimeAsync(MESSAGES_REFRESH_INTERVAL_MS));
    expect(list).toHaveBeenCalledTimes(2);
    expect(result.threads).toBe(first);
    rows = [{ ...rows[1], unread: true, participants: ["Grace"] }, rows[0]];
    await act(async () => vi.advanceTimersByTimeAsync(MESSAGES_REFRESH_INTERVAL_MS));
    expect(result.threads[0]).toBe(first[0]);
    expect(result.threads[1]).not.toBe(first[1]);
    expect(result.threads[1].participants).toEqual(["Grace"]);
    rows = [rows[0]];
    await act(async () => vi.advanceTimersByTimeAsync(MESSAGES_REFRESH_INTERVAL_MS));
    expect(result.threads.map((thread) => thread.id)).toEqual(["b"]);
    const retained = result.threads;
    list.mockRejectedValue(new Error("offline"));
    await act(async () => vi.advanceTimersByTimeAsync(MESSAGES_REFRESH_INTERVAL_MS));
    expect(result.failures[0].error).toBe("offline");
    expect(result.threads[0].unread).toBe(true);
    expect(result.threads).toBe(retained);
    list.mockResolvedValue(rows);
    await act(async () => vi.advanceTimersByTimeAsync(MESSAGES_REFRESH_INTERVAL_MS));
    expect(result.failures).toEqual([]);
    expect(result.threads).toBe(retained);
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

it("retries only the failed accounts and keeps the healthy account's threads", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const accounts: MessagingAccount[] = ["healthy", "broken"].map((id) => ({
    id,
    provider: "slack",
    label: id,
    identity: "",
    config: {},
    connected: true,
    createdAt: 1,
    updatedAt: 1,
  }));
  const thread = (accountId: string): MessageThread => ({
    id: `${accountId}-thread`,
    accountId,
    provider: "slack",
    title: accountId,
    participants: [],
    preview: "",
    updatedAt: 2,
    unread: false,
  });
  list.mockReset();
  list.mockImplementation(async (accountId: string) => {
    if (accountId === "broken") throw new Error("offline");
    return [thread(accountId)];
  });
  let result!: ReturnType<typeof useMessageThreads>;
  function Probe() {
    result = useMessageThreads(accounts, false);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Probe)));
    expect(result.failures.map(({ account }) => account.id)).toEqual(["broken"]);
    expect(result.threads.map((item) => item.id)).toEqual(["healthy-thread"]);
    list.mockClear();
    list.mockResolvedValue([thread("broken")]);
    await act(async () => result.refreshAccounts(["broken"]));
    expect(list.mock.calls.map(([accountId]) => accountId)).toEqual(["broken"]);
    expect(result.failures).toEqual([]);
    expect(result.threads.map((item) => item.id).sort()).toEqual([
      "broken-thread",
      "healthy-thread",
    ]);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
