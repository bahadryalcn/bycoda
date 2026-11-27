import { describe, expect, it } from "vitest";
import {
  FAILOVER_HOLD_MS,
  LimitedAccounts,
  failoverAccountKey,
  pickAccountFailover,
  pickOrderFailover,
} from "./usageLimitFailover";

const entry = (id: string, harness: "claude" | "codex", providerAccountId?: string) => ({
  id,
  harness,
  model: `${harness}:model-${id}`,
  modelSettings: {},
  unknownLimit: "use" as const,
  ...(providerAccountId ? { providerAccountId } : {}),
});

describe("pickAccountFailover", () => {
  it("skips held, exhausted and unreadable accounts and keeps the model", async () => {
    const read: Record<string, boolean | Error> = {
      full: false,
      broken: new Error("network"),
      spare: true,
    };
    const target = await pickAccountFailover({
      harness: "claude",
      model: "claude:opus",
      accountIds: ["held", "full", "broken", "spare"],
      limited: (key) => key === failoverAccountKey("claude", "held"),
      hasQuota: async (id) => {
        const value = read[id];
        if (value instanceof Error) throw value;
        if (value === undefined) throw new Error("held account must not be read");
        return value;
      },
    });
    expect(target).toEqual({ harness: "claude", model: "claude:opus", providerAccountId: "spare" });
  });

  it("finds nothing when every other account is out of quota", async () => {
    await expect(
      pickAccountFailover({
        harness: "codex",
        model: "codex:gpt",
        accountIds: ["a"],
        limited: () => false,
        hasQuota: async () => false,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("pickOrderFailover", () => {
  it("takes the first entry the Host does not skip and whose account is not limited", () => {
    const target = pickOrderFailover({
      entries: [
        entry("1", "claude"),
        entry("2", "claude", "work"),
        entry("3", "codex"),
        entry("4", "claude", "bycoda"),
      ],
      statuses: [
        { entryId: "2", skip: "belowLimit" },
        { entryId: "3", leftPercent: 0 },
      ],
      limited: (key) => key === failoverAccountKey("claude", "default"),
    });
    expect(target).toEqual({
      harness: "claude",
      model: "claude:model-4",
      providerAccountId: "bycoda",
    });
  });

  it("finds nothing in an empty order", () => {
    expect(pickOrderFailover({ entries: [], statuses: [], limited: () => false })).toBeUndefined();
  });
});

describe("LimitedAccounts", () => {
  it("holds until the reported reset, or for the default hold without one", () => {
    const held = new LimitedAccounts();
    held.hold("a", 0, 5_000);
    held.hold("b", 0);
    expect(held.has("a", 4_999)).toBe(true);
    expect(held.has("a", 5_000)).toBe(false);
    expect(held.has("b", FAILOVER_HOLD_MS - 1)).toBe(true);
    expect(held.has("b", FAILOVER_HOLD_MS)).toBe(false);
    expect(held.has("c", 0)).toBe(false);
  });
});
