// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { syncMessagingAccounts } from "../model/messagingCache";
import type { MessageThread, MessagingAccount } from "../model/messagingTypes";
import { useMessageThreads } from "./useMessageThreads";

const list = vi.hoisted(() => vi.fn());
const lock = vi.hoisted(() => ({ lockedGroupIds: new Set<string>() }));
vi.mock("../model/messagingApi", () => ({ listMessageThreads: list }));
vi.mock("../../group-lock/hooks/useGroupLock", () => ({ useLockSnapshot: () => lock }));

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
  lock.lockedGroupIds = new Set();
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

    lock.lockedGroupIds = new Set(["group-1"]);
    await act(async () => root.render(createElement(Probe)));
    expect(result.threads).toEqual([]);
  } finally {
    await act(async () => root.unmount());
  }
});
