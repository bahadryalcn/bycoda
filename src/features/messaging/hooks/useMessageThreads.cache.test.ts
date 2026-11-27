// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { syncMessagingAccounts, threadListCache } from "../model/messagingCache";
import type { MessageThread, MessagingAccount } from "../model/messagingTypes";
import { useMessageThreads } from "./useMessageThreads";

const list = vi.hoisted(() => vi.fn());
const lock = vi.hoisted(() => ({
  lock: { lockedGroupIds: new Set<string>() },
  listeners: new Set<() => void>(),
}));
vi.mock("../model/messagingApi", () => ({ listMessageThreads: list }));
vi.mock("../../group-lock/model/groupLock", () => ({
  getGroupLockView: () => ({ lock: lock.lock }),
  subscribeGroupLock: (listener: () => void) => {
    lock.listeners.add(listener);
    return () => lock.listeners.delete(listener);
  },
}));
/** Engages a lock the way the group-lock store does: new snapshot, then notify. */
function setLockedGroups(ids: string[]) {
  lock.lock = { lockedGroupIds: new Set(ids) };
  for (const listener of lock.listeners) listener();
}

function account(id: string, updatedAt = 1, connected = true): MessagingAccount {
  return {
    id,
    provider: "slack",
    label: id,
    identity: id,
    config: {},
    connected,
    createdAt: 1,
    updatedAt,
  };
}

function thread(accountId: string, id = `${accountId}-thread`): MessageThread {
  return {
    id,
    accountId,
    provider: "slack",
    title: id,
    participants: [],
    preview: "",
    updatedAt: 2,
    unread: false,
  };
}

afterEach(() => {
  setLockedGroups([]);
  syncMessagingAccounts([]);
  vi.unstubAllGlobals();
});

it("discards a reply that lands after its account was removed", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let release!: (threads: MessageThread[]) => void;
  list.mockImplementation(
    () =>
      new Promise<MessageThread[]>((resolve) => {
        release = resolve;
      }),
  );
  let result!: ReturnType<typeof useMessageThreads>;
  function Probe({ accounts }: { accounts: MessagingAccount[] }) {
    result = useMessageThreads(accounts, false);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Probe, { accounts: [account("gone")] })));
    // Removed while its first read is still pending.
    await act(async () => root.render(createElement(Probe, { accounts: [] })));
    await act(async () => release([thread("gone")]));
    expect(result.threads).toEqual([]);
  } finally {
    await act(async () => root.unmount());
  }
});

it("does not show the previous connection's threads when an account is re-identified", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  list.mockReset();
  list.mockResolvedValue([thread("reused", "old-conversation")]);
  let result!: ReturnType<typeof useMessageThreads>;
  function Probe({ accounts }: { accounts: MessagingAccount[] }) {
    result = useMessageThreads(accounts, false);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Probe, { accounts: [account("reused", 1)] })));
    expect(result.threads.map((item) => item.id)).toEqual(["old-conversation"]);

    // The same id is connected again as a different identity; its first read never returns.
    list.mockReset();
    list.mockImplementation(() => new Promise<MessageThread[]>(() => {}));
    await act(async () => root.render(createElement(Probe, { accounts: [account("reused", 2)] })));
    expect(result.threads).toEqual([]);
  } finally {
    await act(async () => root.unmount());
  }
});

it("drops cached threads when a group lock engages", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  list.mockReset();
  list.mockResolvedValue([thread("kept")]);
  let result!: ReturnType<typeof useMessageThreads>;
  function Probe() {
    result = useMessageThreads([account("kept")], false);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Probe)));
    expect(result.threads.map((item) => item.id)).toEqual(["kept-thread"]);

    await act(async () => setLockedGroups(["group-1"]));
    expect(result.threads).toEqual([]);
  } finally {
    await act(async () => root.unmount());
  }
});

it("drops cached threads when a group lock engages while no Messages view is mounted", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  list.mockReset();
  list.mockResolvedValue([thread("kept")]);
  let result!: ReturnType<typeof useMessageThreads>;
  function Probe() {
    result = useMessageThreads([account("kept")], false);
    return null;
  }
  const first = createRoot(document.createElement("div"));
  await act(async () => first.render(createElement(Probe)));
  expect(result.threads.map((item) => item.id)).toEqual(["kept-thread"]);
  // The panel closes, then the lock engages with nothing mounted.
  await act(async () => first.unmount());
  setLockedGroups(["group-2"]);
  expect(threadListCache.has("kept")).toBe(false);
});
