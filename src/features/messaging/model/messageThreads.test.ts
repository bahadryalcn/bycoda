import { beforeEach, describe, expect, it } from "vitest";
import {
  accountFailures,
  applyAccountResult,
  filterThreads,
  markThreadSeen,
  mergeThreads,
  messageFilterCount,
  patchAccountThread,
  pruneMessageFilters,
  resetThreadSeenForTests,
  threadKey,
  threadUnread,
  toggleListValue,
  DEFAULT_MESSAGE_FILTERS,
} from "./messageThreads";
import type { MessageThread, MessagingAccount } from "./messagingTypes";

function account(id: string, provider: MessagingAccount["provider"] = "email"): MessagingAccount {
  return {
    id,
    provider,
    label: `Account ${id}`,
    identity: `${id}@example.com`,
    config: {},
    connected: true,
    createdAt: 1,
    updatedAt: 1,
  };
}

function thread(
  accountId: string,
  id: string,
  updatedAt: number,
  extra: Partial<MessageThread> = {},
) {
  return {
    id,
    accountId,
    provider: "email",
    title: `Thread ${id}`,
    participants: ["Ada <ada@example.com>"],
    preview: "Hello",
    updatedAt,
    unread: false,
    ...extra,
  } satisfies MessageThread;
}

beforeEach(() => resetThreadSeenForTests());

describe("mergeThreads", () => {
  it("merges accounts newest first with a stable tie order and ignores unknown accounts", () => {
    const accounts = [account("a"), account("b")];
    const merged = mergeThreads(accounts, {
      a: { threads: [thread("a", "1", 10), thread("a", "2", 30)], error: null, loaded: true },
      b: { threads: [thread("b", "1", 20), thread("b", "0", 30)], error: null, loaded: true },
      gone: { threads: [thread("gone", "x", 99)], error: null, loaded: true },
    });
    expect(merged.map(threadKey)).toEqual([
      threadKey({ accountId: "a", id: "2" }),
      threadKey({ accountId: "b", id: "0" }),
      threadKey({ accountId: "b", id: "1" }),
      threadKey({ accountId: "a", id: "1" }),
    ]);
  });

  it("keeps same thread ids from different accounts apart and drops duplicates", () => {
    const merged = mergeThreads([account("a"), account("b")], {
      a: { threads: [thread("a", "1", 1), thread("a", "1", 1)], error: null, loaded: true },
      b: { threads: [thread("b", "1", 1)], error: null, loaded: true },
    });
    expect(merged).toHaveLength(2);
  });
});

describe("applyAccountResult", () => {
  it("keeps last-good threads when a refresh fails and clears the error on success", () => {
    const good = applyAccountResult(undefined, { ok: true, threads: [thread("a", "1", 1)] });
    const failed = applyAccountResult(good, { ok: false, error: "timeout" });
    expect(failed.threads).toEqual(good.threads);
    expect(failed.error).toBe("timeout");
    expect(failed.loaded).toBe(true);
    expect(applyAccountResult(failed, { ok: true, threads: [] })).toEqual({
      threads: [],
      error: null,
      loaded: true,
    });
  });

  it("reports one failing account without hiding the other account's threads", () => {
    const accounts = [account("a"), account("b", "slack")];
    const byAccount = {
      a: applyAccountResult(undefined, { ok: false, error: "auth failed" }),
      b: applyAccountResult(undefined, { ok: true, threads: [thread("b", "c1", 5)] }),
    };
    expect(mergeThreads(accounts, byAccount)).toHaveLength(1);
    expect(accountFailures(accounts, byAccount)).toEqual([
      { account: accounts[0], error: "auth failed" },
    ]);
  });
});

describe("filterThreads", () => {
  const threads = [
    thread("a", "1", 3, { title: "Invoice March", preview: "Please pay" }),
    thread("b", "2", 2, { provider: "slack", title: "#general", participants: ["Grace"] }),
    thread("c", "3", 1, { provider: "discord", title: "dev", preview: "Build is green" }),
  ];

  it("searches title, preview and participants case-insensitively with every term", () => {
    expect(filterThreads(threads, DEFAULT_MESSAGE_FILTERS, "grace").map((t) => t.id)).toEqual([
      "2",
    ]);
    expect(filterThreads(threads, DEFAULT_MESSAGE_FILTERS, "BUILD green").map((t) => t.id)).toEqual(
      ["3"],
    );
    expect(filterThreads(threads, DEFAULT_MESSAGE_FILTERS, "invoice pay").map((t) => t.id)).toEqual(
      ["1"],
    );
    expect(filterThreads(threads, DEFAULT_MESSAGE_FILTERS, "  ")).toHaveLength(3);
  });

  it("hides accounts and providers", () => {
    const filters = { hiddenAccountIds: ["a"], hiddenProviders: ["discord" as const] };
    expect(filterThreads(threads, filters, "").map((t) => t.id)).toEqual(["2"]);
    expect(messageFilterCount(filters)).toBe(2);
    expect(messageFilterCount(DEFAULT_MESSAGE_FILTERS)).toBe(0);
  });

  it("prunes filters for removed accounts and providers", () => {
    const pruned = pruneMessageFilters(
      { hiddenAccountIds: ["a", "gone"], hiddenProviders: ["slack", "teams"] },
      [account("a", "slack")],
    );
    expect(pruned).toEqual({ hiddenAccountIds: ["a"], hiddenProviders: ["slack"] });
    expect(toggleListValue(["a"], "a")).toEqual([]);
    expect(toggleListValue(["a"], "b")).toEqual(["a", "b"]);
  });
});

describe("thread updates", () => {
  it("patches one thread after a reply", () => {
    const state = {
      threads: [thread("a", "1", 1), thread("a", "2", 1)],
      error: null,
      loaded: true,
    };
    const next = patchAccountThread(state, "2", { preview: "Sent", updatedAt: 9 });
    expect(next?.threads[1]).toMatchObject({ preview: "Sent", updatedAt: 9 });
    expect(next?.threads[0]).toBe(state.threads[0]);
    expect(patchAccountThread(undefined, "2", {})).toBeUndefined();
  });

  it("clears the local unread mark until the thread changes again", () => {
    const unread = thread("a", "1", 5, { unread: true });
    expect(threadUnread(unread)).toBe(true);
    markThreadSeen(unread);
    expect(threadUnread(unread)).toBe(false);
    expect(threadUnread({ ...unread, updatedAt: 6 })).toBe(true);
    expect(threadUnread(thread("a", "2", 1))).toBe(false);
  });
});
