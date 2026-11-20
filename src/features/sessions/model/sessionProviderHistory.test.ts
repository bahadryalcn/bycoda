import { describe, expect, it } from "vitest";
import type { Block, HarnessId } from "./session";
import { sameSessionProviderHistory, sessionProviderHistory } from "./sessionProviderHistory";

const turn = (id: string, harness?: HarnessId): Block => ({
  id,
  role: "user",
  text: "Go",
  ...(harness ? { turnModel: { harness, id: "model", name: "Model" } } : {}),
});
const handoff = (from: HarnessId, to: HarnessId, status: "ready" | "failed" = "ready"): Block => ({
  id: `${from}-${to}`,
  role: "handoff",
  text: "",
  handoff: { from, to, status },
});

describe("sessionProviderHistory", () => {
  it("keeps first-use order and marks the last submitted provider on a return handoff", () => {
    expect(
      sessionProviderHistory({
        harness: "claude",
        blocks: [
          turn("1", "claude"),
          handoff("claude", "codex"),
          turn("2", "codex"),
          handoff("codex", "claude"),
          turn("3", "claude"),
        ],
      }),
    ).toEqual({
      providers: ["claude", "codex"],
      activeHarness: "claude",
      activeModel: "Model",
      handedOffFrom: "codex",
    });
  });

  it("infers legacy turns from successful handoffs", () => {
    expect(
      sessionProviderHistory({
        harness: "codex",
        blocks: [turn("1"), handoff("claude", "codex"), turn("2")],
      }),
    ).toEqual({ providers: ["claude", "codex"], activeHarness: "codex", handedOffFrom: "claude" });
  });

  it("does not show a newly picked provider or unsent drafts as previously used", () => {
    expect(
      sessionProviderHistory({
        harness: "codex",
        pendingSwitch: {
          from: "claude",
          fromModel: "old",
          fromSettings: {},
        },
        blocks: [turn("1", "claude"), { ...turn("draft", "codex"), draft: true }],
      }),
    ).toEqual({
      providers: ["claude"],
      activeHarness: "claude",
      activeModel: "Model",
    });
  });

  it("does not attribute failed or pending transfers to their target", () => {
    expect(
      sessionProviderHistory({
        harness: "codex",
        blocks: [
          turn("1"),
          handoff("claude", "codex", "failed"),
          turn("2"),
          {
            ...handoff("claude", "cursor"),
            handoff: { from: "claude", to: "cursor", status: "ready", pending: true },
          },
        ],
      }),
    ).toEqual({ providers: ["claude"], activeHarness: "claude" });
  });

  it("uses the running turn independently of the next composer provider", () => {
    expect(
      sessionProviderHistory({
        harness: "cursor",
        blocks: [turn("1", "claude")],
        runningModelTarget: { harness: "codex", model: "model", modelSettings: {} },
      }),
    ).toEqual({
      providers: ["claude", "codex"],
      activeHarness: "codex",
      activeModel: "model",
      handedOffFrom: "claude",
    });
  });

  it("uses persisted metadata for cold rows and current provenance for hydrated ones", () => {
    const providerHistory = {
      providers: ["claude", "codex"] as HarnessId[],
      activeHarness: "codex" as const,
      handedOffFrom: "claude" as const,
    };
    expect(sessionProviderHistory({ harness: "codex", providerHistory })).toEqual(providerHistory);
    expect(
      sessionProviderHistory({ harness: "claude", providerHistory, blocks: [turn("1", "claude")] }),
    ).toEqual({ providers: ["claude"], activeHarness: "claude", activeModel: "Model" });
  });

  it("applies a running target to a transcript walk that is cached by block identity", () => {
    const blocks = [turn("1", "claude")];
    const idle = sessionProviderHistory({ harness: "claude", blocks });
    const running = sessionProviderHistory({
      harness: "claude",
      blocks,
      runningModelTarget: { harness: "codex", model: "gpt", modelSettings: {} },
    });
    expect(idle).toEqual({ providers: ["claude"], activeHarness: "claude", activeModel: "Model" });
    expect(running).toEqual({
      providers: ["claude", "codex"],
      activeHarness: "codex",
      activeModel: "gpt",
      handedOffFrom: "claude",
    });
    // The cached walk must not be mutated by the running-target tail.
    expect(sessionProviderHistory({ harness: "claude", blocks })).toEqual(idle);
  });

  it("re-walks the same blocks when the starting provider changes", () => {
    const blocks = [turn("1")];
    expect(sessionProviderHistory({ harness: "codex", blocks }).activeHarness).toBe("codex");
    expect(
      sessionProviderHistory({
        harness: "codex",
        pendingSwitch: { from: "claude", fromModel: "old", fromSettings: {} },
        blocks,
      }).activeHarness,
    ).toBe("claude");
  });
});

describe("sameSessionProviderHistory", () => {
  const base = {
    providers: ["claude", "codex"] as HarnessId[],
    activeHarness: "codex" as HarnessId,
    activeModel: "GPT",
    handedOffFrom: "claude" as HarnessId,
  };

  it("compares provider summaries by value", () => {
    expect(sameSessionProviderHistory(base, { ...base, providers: [...base.providers] })).toBe(
      true,
    );
    expect(sameSessionProviderHistory(undefined, undefined)).toBe(true);
    expect(sameSessionProviderHistory(undefined, base)).toBe(false);
    expect(sameSessionProviderHistory(base, { ...base, providers: ["codex", "claude"] })).toBe(
      false,
    );
    expect(sameSessionProviderHistory(base, { ...base, activeModel: undefined })).toBe(false);
    expect(sameSessionProviderHistory(base, { ...base, handedOffFrom: undefined })).toBe(false);
  });
});
