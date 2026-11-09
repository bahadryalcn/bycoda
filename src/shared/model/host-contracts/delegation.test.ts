import { describe, expect, it } from "vitest";
import {
  CROSS_ADVISOR_KEY,
  CROSS_SUBAGENTS_KEY,
  DELEGATION_LIMITS,
  DELEGATION_PARENT_KEY,
  carryCrossDelegation,
  decodeAdvisor,
  decodeDelegationParent,
  decodeSubagents,
  delegateRefKey,
  encodeAdvisor,
  encodeSubagents,
  isReservedDelegationKey,
  providerModelSettings,
  type DelegateModelRef,
} from "./delegation";

const claude: DelegateModelRef = { harness: "claude", model: "claude:opus-5-5" };
const codex: DelegateModelRef = { harness: "codex", model: "gpt-6.1-sol" };
const codexOtherAccount: DelegateModelRef = { ...codex, providerAccountId: "acct-2" };

function many(count: number): DelegateModelRef[] {
  return Array.from({ length: count }, (_, index) => ({
    harness: "codex",
    model: `model-${index}`,
  }));
}

describe("decodeSubagents", () => {
  it("never throws on garbage, non-JSON, or wrong shapes", () => {
    expect(decodeSubagents(undefined)).toEqual([]);
    expect(decodeSubagents(null)).toEqual([]);
    expect(decodeSubagents(42)).toEqual([]);
    expect(decodeSubagents("")).toEqual([]);
    expect(decodeSubagents("not json")).toEqual([]);
    expect(decodeSubagents('{"harness":"codex"}')).toEqual([]);
    expect(decodeSubagents('[null, 1, "x", {}]')).toEqual([]);
  });

  it("drops entries with an unknown harness or extra fields", () => {
    const value = JSON.stringify([
      { harness: "unknown-harness", model: "m" },
      { harness: "codex", model: "ok" },
      { harness: "codex", model: "ok-with-extra", extra: true },
    ]);
    expect(decodeSubagents(value)).toEqual([{ harness: "codex", model: "ok" }]);
  });

  it("rejects an empty model id and an over-long account id", () => {
    const value = JSON.stringify([
      { harness: "codex", model: "" },
      { harness: "codex", model: "x", providerAccountId: "a".repeat(65) },
    ]);
    expect(decodeSubagents(value)).toEqual([]);
  });

  it("ignores values over the byte limit instead of parsing them", () => {
    const huge = JSON.stringify([
      { harness: "codex", model: "x".repeat(DELEGATION_LIMITS.valueBytes) },
    ]);
    expect(huge.length).toBeGreaterThan(DELEGATION_LIMITS.valueBytes);
    expect(decodeSubagents(huge)).toEqual([]);
  });

  it("dedupes by harness, model and account", () => {
    const value = JSON.stringify([codex, codex, codexOtherAccount]);
    expect(decodeSubagents(value)).toEqual([codex, codexOtherAccount]);
  });

  it("caps the list at the subagent limit", () => {
    const refs = decodeSubagents(JSON.stringify(many(DELEGATION_LIMITS.subagentModels + 5)));
    expect(refs).toHaveLength(DELEGATION_LIMITS.subagentModels);
    expect(refs[0]).toEqual({ harness: "codex", model: "model-0" });
  });
});

describe("encodeSubagents", () => {
  it("returns undefined for an empty list", () => {
    expect(encodeSubagents([])).toBeUndefined();
  });

  it("round-trips a valid list", () => {
    const encoded = encodeSubagents([claude, codexOtherAccount]);
    expect(encoded).toBeDefined();
    expect(decodeSubagents(encoded)).toEqual([claude, codexOtherAccount]);
  });

  it("drops duplicates and caps the list when encoding", () => {
    const encoded = encodeSubagents([...many(DELEGATION_LIMITS.subagentModels + 2), codex]);
    expect(decodeSubagents(encoded)).toHaveLength(DELEGATION_LIMITS.subagentModels);
  });
});

describe("advisor encode and decode", () => {
  it("round-trips a valid ref", () => {
    expect(decodeAdvisor(encodeAdvisor(codexOtherAccount))).toEqual(codexOtherAccount);
  });

  it("encodes undefined and invalid refs as undefined", () => {
    expect(encodeAdvisor(undefined)).toBeUndefined();
    expect(
      encodeAdvisor({ harness: "nope", model: "m" } as unknown as DelegateModelRef),
    ).toBeUndefined();
  });

  it("decodes garbage as undefined without throwing", () => {
    expect(decodeAdvisor(undefined)).toBeUndefined();
    expect(decodeAdvisor("{")).toBeUndefined();
    expect(decodeAdvisor("[]")).toBeUndefined();
    expect(decodeAdvisor(JSON.stringify({ harness: "claude" }))).toBeUndefined();
  });
});

describe("delegateRefKey", () => {
  it("is readable and includes the harness once", () => {
    expect(delegateRefKey(codex)).toBe("codex:gpt-6.1-sol");
    expect(delegateRefKey(claude)).toBe("claude:opus-5-5");
  });

  it("is unique per account", () => {
    expect(delegateRefKey(codexOtherAccount)).toBe("codex:gpt-6.1-sol@acct-2");
    expect(delegateRefKey(codexOtherAccount)).not.toBe(delegateRefKey(codex));
  });
});

describe("carryCrossDelegation", () => {
  it("preserves explicit off separately from absent settings", () => {
    expect(
      carryCrossDelegation({ [CROSS_SUBAGENTS_KEY]: "[]", [CROSS_ADVISOR_KEY]: "null" }, {}),
    ).toEqual({
      [CROSS_SUBAGENTS_KEY]: "[]",
      [CROSS_ADVISOR_KEY]: "null",
    });
    expect(carryCrossDelegation({}, {})).toEqual({});
  });
  it("copies valid reserved keys into the target", () => {
    const from = {
      [CROSS_SUBAGENTS_KEY]: encodeSubagents([codex]) ?? "",
      [CROSS_ADVISOR_KEY]: encodeAdvisor(claude) ?? "",
      effort: "high",
    };
    const into = carryCrossDelegation(from, { effort: "low" });
    expect(into).toEqual({
      effort: "low",
      [CROSS_SUBAGENTS_KEY]: encodeSubagents([codex]),
      [CROSS_ADVISOR_KEY]: encodeAdvisor(claude),
    });
  });

  it("drops invalid reserved values instead of copying them", () => {
    const into = carryCrossDelegation(
      {
        [CROSS_SUBAGENTS_KEY]: "garbage",
        [CROSS_ADVISOR_KEY]: JSON.stringify({ harness: "nope", model: "m" }),
        [DELEGATION_PARENT_KEY]: "{not json",
      },
      { effort: "high" },
    );
    expect(into).toEqual({ effort: "high" });
  });

  it("returns the target unchanged when there is no source", () => {
    const into = { effort: "high" };
    expect(carryCrossDelegation(undefined, into)).toBe(into);
  });

  it("keeps a valid delegation parent link", () => {
    const parent = JSON.stringify({
      parentSessionId: "parent-1",
      runId: "run-1",
      kind: "subagent",
      model: "codex:gpt-6.1-sol",
      startedAt: 1_700_000_000_000,
    });
    expect(carryCrossDelegation({ [DELEGATION_PARENT_KEY]: parent }, {})).toEqual({
      [DELEGATION_PARENT_KEY]: JSON.stringify(JSON.parse(parent)),
    });
  });
});

describe("providerModelSettings", () => {
  it("strips every reserved key and keeps provider settings", () => {
    const settings = {
      effort: "high",
      [CROSS_SUBAGENTS_KEY]: encodeSubagents([codex]) ?? "",
      [CROSS_ADVISOR_KEY]: encodeAdvisor(claude) ?? "",
      [DELEGATION_PARENT_KEY]: "{}",
    };
    expect(providerModelSettings(settings)).toEqual({ effort: "high" });
  });

  it("returns the same object when no reserved key is present", () => {
    const settings = { effort: "high" };
    expect(providerModelSettings(settings)).toBe(settings);
  });

  it("passes undefined through", () => {
    expect(providerModelSettings(undefined)).toBeUndefined();
  });

  it("does not mutate the input", () => {
    const settings = { effort: "high", [CROSS_ADVISOR_KEY]: encodeAdvisor(claude) ?? "" };
    providerModelSettings(settings);
    expect(settings).toHaveProperty(CROSS_ADVISOR_KEY);
  });
});

describe("reserved keys", () => {
  it("marks exactly the three bycoda-owned keys as reserved", () => {
    expect(isReservedDelegationKey(CROSS_SUBAGENTS_KEY)).toBe(true);
    expect(isReservedDelegationKey(CROSS_ADVISOR_KEY)).toBe(true);
    expect(isReservedDelegationKey(DELEGATION_PARENT_KEY)).toBe(true);
    expect(isReservedDelegationKey("effort")).toBe(false);
  });
});

describe("decodeDelegationParent", () => {
  it("reads a valid parent link and rejects a malformed one", () => {
    const parent = {
      parentSessionId: "p",
      runId: "r",
      kind: "advisor",
      model: "claude:opus-5-5",
      startedAt: 5,
    };
    expect(decodeDelegationParent(JSON.stringify(parent))).toEqual(parent);
    expect(decodeDelegationParent(JSON.stringify({ ...parent, kind: "other" }))).toBeUndefined();
    expect(decodeDelegationParent(JSON.stringify({ ...parent, startedAt: -1 }))).toBeUndefined();
    expect(decodeDelegationParent(undefined)).toBeUndefined();
  });
});
