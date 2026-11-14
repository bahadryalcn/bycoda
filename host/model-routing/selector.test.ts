import { describe, expect, it, vi } from "vitest";
import {
  EMPTY_MODEL_ROUTING,
  ModelRoutingResolutionSchema,
  type ModelRoutingDraft,
  type ModelRoutingEntry,
} from "../../src/shared/model/host-contracts/model-routing";
import { modelRoutingEntryStatus, selectModelRouting, type ModelRoutingSignals } from "./selector";

const entry = (id: string, extra: Partial<ModelRoutingEntry> = {}): ModelRoutingEntry => ({
  id,
  harness: "codex",
  model: "codex:gpt",
  modelSettings: { effort: "high" },
  unknownLimit: "use",
  ...extra,
});
const state = (entries: ModelRoutingEntry[] = []): ModelRoutingDraft => ({
  ...structuredClone(EMPTY_MODEL_ROUTING),
  entries,
});
const signals = (extra: Partial<ModelRoutingSignals> = {}): ModelRoutingSignals => ({
  available: () => true,
  signedIn: () => true,
  quota: () => ({ unknown: true }),
  accountKind: () => undefined,
  ...extra,
});
const input = { role: "task.worker" as const };

describe("model routing selection", () => {
  it("keeps empty orders and unresolved pools unconfigured", () => {
    expect(selectModelRouting(state(), input, signals())).toEqual({
      ok: false,
      reason: "notConfigured",
      skipped: [],
    });
    const draft = state([entry("a")]);
    draft.pools = [{ id: "p", name: "P", entryIds: ["deleted"] }];
    for (const poolId of ["missing", "p"])
      expect(
        selectModelRouting(draft, { ...input, choice: { kind: "pool", poolId } }, signals()),
      ).toMatchObject({ ok: false, reason: "notConfigured" });
  });
  it("uses role, default role, and item override in order", () => {
    const draft = state([entry("a"), entry("b")]);
    draft.pools = [{ id: "p", name: "P", entryIds: ["deleted", "b", "a"] }];
    draft.roles["task.worker"] = { kind: "pool", poolId: "p" };
    for (const choice of [undefined, { kind: "default" as const }])
      expect(selectModelRouting(draft, { ...input, choice }, signals())).toMatchObject({
        ok: true,
        source: { kind: "pool", poolId: "p", entryId: "b" },
      });
    expect(
      selectModelRouting(draft, { ...input, choice: { kind: "order" } }, signals()),
    ).toMatchObject({ ok: true, source: { kind: "order", entryId: "a" } });
  });
  it("records every skip reason with precedence then chooses first eligible", () => {
    const draft = state([
      entry("off"),
      entry("out"),
      entry("low", { minRemainingPercent: 50 }),
      entry("unknown", { unknownLimit: "skip" }),
      entry("yes"),
      entry("later"),
    ]);
    const result = selectModelRouting(
      draft,
      input,
      signals({
        available: (e) => e.id !== "off",
        signedIn: (e) => !["off", "out"].includes(e.id),
        quota: (e) => (e.id === "low" ? { leftPercent: 49 } : { unknown: true }),
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      source: { entryId: "yes" },
      skipped: [
        { entryId: "off", reason: "unavailable" },
        { entryId: "out", reason: "signedOut" },
        { entryId: "low", reason: "belowLimit" },
        { entryId: "unknown", reason: "unknownLimit" },
      ],
    });
    expect(ModelRoutingResolutionSchema.parse(result)).toEqual(result);
  });
  it("accepts exact threshold and zero remaining at default threshold", () => {
    for (const [minRemainingPercent, leftPercent] of [
      [50, 50],
      [undefined, 0],
    ] as const)
      expect(
        selectModelRouting(
          state([entry("a", { minRemainingPercent })]),
          input,
          signals({ quota: () => ({ leftPercent }) }),
        ),
      ).toMatchObject({ ok: true });
  });
  it("holds all-skipped order with earliest known reset, never a random fallback", () => {
    const draft = state([
      entry("a", { minRemainingPercent: 1 }),
      entry("b", { minRemainingPercent: 1 }),
      entry("c", { unknownLimit: "skip" }),
    ]);
    expect(
      selectModelRouting(
        draft,
        input,
        signals({
          quota: (e) =>
            e.id === "c"
              ? { unknown: true }
              : { leftPercent: 0, resetsAt: e.id === "a" ? 300 : 200 },
        }),
      ),
    ).toMatchObject({ ok: false, reason: "noEligibleEntry", nextResetAt: 200 });
    const result = selectModelRouting(
      state([entry("a", { unknownLimit: "skip" })]),
      input,
      signals(),
    );
    expect(result).toEqual({
      ok: false,
      reason: "noEligibleEntry",
      skipped: [{ entryId: "a", reason: "unknownLimit" }],
    });
  });
  it("fixed item and role bypass signals, preserve target, and require target", () => {
    const draft = state();
    const target = {
      harness: "codex" as const,
      model: "absent",
      providerAccountId: "work",
      modelSettings: { crossAdvisor: "item" },
    };
    const fail = () => {
      throw new Error("must not read");
    };
    const noSignals = { available: fail, signedIn: fail, quota: fail };
    expect(
      selectModelRouting(draft, { ...input, choice: { kind: "fixed" }, fixed: target }, noSignals),
    ).toMatchObject({ ok: true, target, source: { kind: "fixed" } });
    expect(() =>
      selectModelRouting(draft, { ...input, choice: { kind: "fixed" } }, noSignals),
    ).toThrow("requires a target");
    draft.roles["task.worker"] = { kind: "fixed", target };
    expect(selectModelRouting(draft, input, noSignals)).toMatchObject({ ok: true, target });
  });
  it("layers delegation global, provider, account, then fixed item keys without mutation", () => {
    const draft = state([entry("a")]);
    draft.delegation = {
      global: { crossAdvisor: "global", imageModels: "image" },
      providers: { codex: { crossAdvisor: "provider", crossSubagents: "provider" } },
      accounts: { "codex\ndefault": { crossAdvisor: "account" } },
    };
    const original = structuredClone(draft);
    expect(selectModelRouting(draft, input, signals())).toMatchObject({
      ok: true,
      target: {
        modelSettings: {
          effort: "high",
          crossAdvisor: "account",
          crossSubagents: "provider",
          imageModels: "image",
        },
      },
    });
    const result = selectModelRouting(
      draft,
      {
        ...input,
        choice: { kind: "fixed" },
        fixed: { harness: "codex", model: "x", modelSettings: { crossAdvisor: "item" } },
      },
      signals(),
    );
    expect(result).toMatchObject({
      ok: true,
      target: { modelSettings: { crossAdvisor: "item", crossSubagents: "provider" } },
    });
    expect(draft).toEqual(original);
  });
  it("exposes same quota and skip to status", () => {
    const quota = vi.fn(() => ({ leftPercent: 20, resetsAt: 100 }));
    expect(
      modelRoutingEntryStatus(entry("a", { minRemainingPercent: 21 }), signals({ quota })),
    ).toEqual({ entryId: "a", skip: "belowLimit", leftPercent: 20, resetsAt: 100 });
    expect(quota).toHaveBeenCalledTimes(1);
  });
  it("scopes delegation to chosen harness and exact account", () => {
    const draft = state([entry("a", { providerAccountId: "work" })]);
    draft.delegation = {
      global: { crossAdvisor: "global" },
      providers: { claude: { crossAdvisor: "claude" } },
      accounts: {
        "codex\nwork": { crossAdvisor: "work" },
        "codex\ndefault": { imageModels: "default" },
        "claude\nwork": { crossSubagents: "claude" },
      },
    };
    const result = selectModelRouting(draft, input, signals());
    expect(result).toMatchObject({
      ok: true,
      target: {
        providerAccountId: "work",
        modelSettings: { effort: "high", crossAdvisor: "work" },
      },
    });
    if (result.ok)
      expect(Object.keys(result.target.modelSettings).sort()).toEqual(["crossAdvisor", "effort"]);
  });
});

describe("nested pools and project scope", () => {
  const withPools = (): ModelRoutingDraft => {
    const draft = state(["a", "b", "c", "d"].map((id) => entry(id)));
    draft.pools = [
      { id: "outer", name: "Outer", entryIds: ["c"], poolIds: ["inner", "other"] },
      { id: "inner", name: "Inner", entryIds: ["b", "c"], poolIds: ["outer"] },
      { id: "other", name: "Other", entryIds: ["d", "b"] },
    ];
    return draft;
  };
  const pick = (draft: ModelRoutingDraft, available: (id: string) => boolean) =>
    selectModelRouting(
      draft,
      { ...input, choice: { kind: "pool", poolId: "outer" } },
      signals({ available: (e) => available(e.id) }),
    );

  it("walks own entries, then included pools depth-first, deduped and cycle-safe", () => {
    const skipped: string[] = [];
    const result = pick(withPools(), (id) => {
      skipped.push(id);
      return false;
    });
    expect(result).toMatchObject({ ok: false, reason: "noEligibleEntry" });
    expect(result.skipped.map((s) => s.entryId)).toEqual(["c", "b", "d"]);
    expect(pick(withPools(), (id) => id === "d")).toMatchObject({
      ok: true,
      source: { kind: "pool", poolId: "outer", entryId: "d" },
    });
  });

  const scoped = (cwd: string | undefined, kinds: Record<string, "work" | "personal"> = {}) => {
    const draft = state([
      entry("personal"),
      entry("shared"),
      entry("work"),
    ]);
    draft.projectKinds = { "c:/proj/app": "work", ...kinds };
    return selectModelRouting(
      draft,
      { ...input, cwd },
      signals({
        accountKind: (e) => (e.id === "shared" ? undefined : (e.id as "personal" | "work")),
      }),
    );
  };

  it("skips other-scope accounts for a tagged project only", () => {
    expect(scoped("C:\Proj\App\\")).toMatchObject({
      ok: true,
      source: { entryId: "shared" },
      skipped: [{ entryId: "personal", reason: "otherScope" }],
    });
    expect(scoped("C:/proj/app", { "c:/proj/app": "personal" })).toMatchObject({
      source: { entryId: "personal" },
    });
    expect(scoped(undefined)).toMatchObject({ source: { entryId: "personal" } });
    expect(scoped("C:/untagged")).toMatchObject({ source: { entryId: "personal" } });
  });

  it("reports noEligibleEntry when scope removes every entry and never filters fixed", () => {
    const draft = state([entry("p1")]);
    draft.projectKinds = { "/x": "work" };
    const only = signals({ accountKind: () => "personal" });
    expect(selectModelRouting(draft, { ...input, cwd: "/x" }, only)).toMatchObject({
      ok: false,
      reason: "noEligibleEntry",
      skipped: [{ entryId: "p1", reason: "otherScope" }],
    });
    expect(
      selectModelRouting(
        draft,
        { ...input, cwd: "/x", choice: { kind: "fixed" }, fixed: entry("f") },
        only,
      ),
    ).toMatchObject({ ok: true, source: { kind: "fixed" } });
  });
});
