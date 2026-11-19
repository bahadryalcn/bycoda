import { beforeEach, expect, it } from "vitest";
import {
  accountGeneration,
  dropMessagingAccount,
  rememberThreadPage,
  syncMessagingAccounts,
  threadListCache,
  threadPageCache,
} from "./messagingCache";
import type { MessagingAccount } from "./messagingTypes";

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

const page = { messages: [], earlier: null };
const threadOf = (accountId: string) => JSON.stringify([accountId, "t1"]);

beforeEach(() => {
  syncMessagingAccounts([]);
});

it("drops a removed account's threads and bodies and keeps the other accounts", () => {
  syncMessagingAccounts([account("a"), account("b")]);
  threadListCache.set("a", { threads: [], error: null, loaded: true });
  threadListCache.set("b", { threads: [], error: null, loaded: true });
  rememberThreadPage(threadOf("a"), page);
  rememberThreadPage(threadOf("b"), page);

  syncMessagingAccounts([account("b")]);

  expect(threadListCache.has("a")).toBe(false);
  expect(threadPageCache.has(threadOf("a"))).toBe(false);
  expect(threadListCache.has("b")).toBe(true);
  expect(threadPageCache.has(threadOf("b"))).toBe(true);
});

it("drops an account that is still listed but no longer connected", () => {
  syncMessagingAccounts([account("a")]);
  rememberThreadPage(threadOf("a"), page);

  syncMessagingAccounts([account("a", 1, false)]);

  expect(threadPageCache.has(threadOf("a"))).toBe(false);
});

it("drops an account whose credentials changed under the same id", () => {
  syncMessagingAccounts([account("a", 1)]);
  threadListCache.set("a", { threads: [], error: null, loaded: true });
  rememberThreadPage(threadOf("a"), page);
  const before = accountGeneration("a");

  syncMessagingAccounts([account("a", 2)]);

  expect(threadListCache.has("a")).toBe(false);
  expect(threadPageCache.has(threadOf("a"))).toBe(false);
  // A read that started under the old credentials is fenced by this change.
  expect(accountGeneration("a")).not.toBe(before);
});

it("keeps caches when the connected account is unchanged", () => {
  syncMessagingAccounts([account("a", 1)]);
  rememberThreadPage(threadOf("a"), page);
  const before = accountGeneration("a");

  syncMessagingAccounts([account("a", 1)]);

  expect(threadPageCache.has(threadOf("a"))).toBe(true);
  expect(accountGeneration("a")).toBe(before);
});

it("bumps the generation of a dropped account so its in-flight reads are fenced", () => {
  syncMessagingAccounts([account("a")]);
  const before = accountGeneration("a");

  dropMessagingAccount("a");

  expect(accountGeneration("a")).toBe(before + 1);
});
