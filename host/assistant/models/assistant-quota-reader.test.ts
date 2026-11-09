import { describe, expect, it } from "vitest";
import type { UsageLimitsReport } from "../../usage/limits-report";
import {
  AssistantQuotaReader,
  QUOTA_REFRESH_MS,
  QUOTA_STALE_MS,
  quotaModelMatches,
} from "./assistant-quota-reader";

const win = (leftPercent: number, resetsAt: number | null = null) =>
  ({
    usedPercent: 100 - leftPercent,
    leftPercent,
    regainPercent: 0,
    windowMinutes: 300,
    resetsAt,
    timeLeftPercent: null,
    pace: null,
  }) as never;
const card = (kind: string, model: string | null, accounts: Record<string, unknown>) =>
  ({
    key: `${kind}:${model}`,
    kind,
    model,
    best: Object.values(accounts)[0],
    accounts: Object.entries(accounts).map(([id, reading]) => ({
      id,
      label: id,
      color: "",
      reading,
    })),
  }) as never;
const status = (id: string, ok = true) =>
  ({
    id,
    label: id,
    color: "",
    status: ok ? "ok" : "error",
    error: null,
    resetCredits: null,
  }) as never;

function setup(cards: unknown[], accounts = [status("default")]) {
  let now = 1_000_000;
  let calls = 0;
  let failing = false;
  const reader = new AssistantQuotaReader({
    now: () => now,
    readLimits: async () => {
      calls++;
      if (failing) throw new Error("boom");
      return {
        environmentId: "e",
        sampledAt: now,
        source: "host-provider-api",
        providers: [{ provider: "claude", cards, accounts }],
      } as unknown as UsageLimitsReport;
    },
  });
  return {
    reader,
    advance: (ms: number) => (now += ms),
    calls: () => calls,
    fail: () => (failing = true),
  };
}

describe("quotaModelMatches", () => {
  it("matches equal ids and delimiter-aligned prefixes only", () => {
    expect(quotaModelMatches("Sonnet", "sonnet")).toBe(true);
    expect(quotaModelMatches("Claude Sonnet", "claude-sonnet-4-5")).toBe(true);
    expect(quotaModelMatches("gpt-5", "gpt-5.1-codex")).toBe(true);
    expect(quotaModelMatches("gpt-5", "gpt-50")).toBe(false);
    expect(quotaModelMatches("opus", "sonnet")).toBe(false);
    expect(quotaModelMatches("", "sonnet")).toBe(false);
  });
});

describe("AssistantQuotaReader", () => {
  it("is unknown before the first sample and never blocks on the read", async () => {
    const { reader, calls } = setup([card("session", null, { default: win(80) })]);
    expect(reader.reading("claude", undefined, "sonnet")).toEqual({
      unknown: true,
      reason: "noSample",
    });
    expect(calls()).toBe(1);
    await reader.refresh("claude");
    expect(reader.reading("claude", undefined, "sonnet")).toMatchObject({ leftPercent: 80 });
  });
  it("takes the minimum across whole-account and model windows, ignoring other models", async () => {
    const { reader } = setup([
      card("session", null, { default: win(60, 5000) }),
      card("weekly", null, { default: win(30, 9000) }),
      card("weekly", "Sonnet", { default: win(10, 7000) }),
      card("weekly", "Opus", { default: win(2) }),
    ]);
    await reader.refresh("claude");
    expect(reader.reading("claude", "default", "sonnet-4-5")).toMatchObject({
      leftPercent: 10,
      resetsAt: 7000,
    });
    expect(reader.reading("claude", "default", "haiku")).toMatchObject({
      leftPercent: 30,
      resetsAt: 9000,
    });
  });
  it("reads only the requested account and never sums accounts", async () => {
    const { reader } = setup(
      [card("session", null, { default: win(90), work: win(5) })],
      [status("default"), status("work")],
    );
    await reader.refresh("claude");
    expect(reader.reading("claude", "work", "m")).toMatchObject({ leftPercent: 5 });
    expect(reader.reading("claude", undefined, "m")).toMatchObject({ leftPercent: 90 });
    expect(reader.reading("claude", "ghost", "m")).toMatchObject({ unknown: true });
  });
  it("is unknown for a failed account, a provider without quota and a missing window", async () => {
    const failed = setup([card("weekly", "Opus", { default: win(5) })], [status("default", false)]);
    await failed.reader.refresh("claude");
    expect(failed.reader.reading("claude", "default", "opus")).toMatchObject({ unknown: true });
    expect(failed.reader.reading("grok", undefined, "m")).toMatchObject({
      unknown: true,
      reason: "noQuota",
    });
    const other = setup([card("weekly", "Opus", { default: win(5) })]);
    await other.reader.refresh("claude");
    expect(other.reader.reading("claude", undefined, "sonnet")).toMatchObject({
      unknown: true,
      reason: "noWindow",
    });
  });
  it("refreshes in the background at most every 5 minutes and expires readings after 15", async () => {
    const t = setup([card("session", null, { default: win(70) })]);
    await t.reader.refresh("claude");
    t.reader.reading("claude", undefined, "m");
    expect(t.calls()).toBe(1);
    t.advance(QUOTA_REFRESH_MS + 1);
    t.fail();
    expect(t.reader.reading("claude", undefined, "m")).toMatchObject({ leftPercent: 70 });
    expect(t.calls()).toBe(2);
    await Promise.resolve();
    t.advance(QUOTA_STALE_MS);
    expect(t.reader.reading("claude", undefined, "m")).toEqual({ unknown: true, reason: "stale" });
  });
});
