import { beforeEach, describe, expect, it } from "vitest";
import {
  AssistantRequestValidationSchema,
  AssistantResponseValidationSchema,
} from "../../../src/shared/model/host-contracts/assistant";
import type { AssistantModelPoolRow } from "../../../src/shared/model/assistantModelPool";
import {
  assistantModelPoolOp,
  deriveAssistantModelPool,
  getAssistantModelPool,
  setAssistantModelPool,
  setAssistantModelPoolPorts,
} from "./assistant-model-pool";

const execution = (model: string, harness: "codex" | "claude" = "codex") => ({
  harness,
  model,
  modelSettings: {},
  runtimeMode: "auto" as const,
  maxRunMinutes: 60,
});
const profile = {
  execution: execution("gpt-5"),
  chiefExecution: execution("gpt-5"),
  replyExecution: execution("fast", "claude"),
  planningExecution: undefined,
} as never;
const row = (id: string, extra: Partial<AssistantModelPoolRow> = {}): AssistantModelPoolRow => ({
  ...execution("gpt-5"),
  id,
  roles: ["worker"],
  minRemainingPercent: 0,
  unknownLimit: "use",
  ...extra,
});

function deps() {
  const records = new Map<string, { version: number }>();
  return {
    repository: {
      get: async (_table: string, id: string) => records.get(id),
      put: async (_table: string, value: { id: string }, expected?: number) => {
        const old = records.get(value.id);
        if ((old?.version ?? 0) !== expected) throw new Error("stale");
        const next = { ...value, version: (old?.version ?? 0) + 1 };
        records.set(value.id, next);
        return next;
      },
    } as never,
    profile: async () => profile,
    now: () => 1000,
  };
}

beforeEach(() => {
  setAssistantModelPoolPorts({
    accounts: async () => ({
      codex: [
        { id: "default", label: "", color: "" },
        { id: "work", label: "", color: "" },
      ],
    }),
    catalog: undefined,
  });
});

describe("derived pool", () => {
  it("groups roles by distinct execution and falls back to the worker model", () => {
    const rows = deriveAssistantModelPool(profile);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      harness: "codex",
      providerAccountId: "default",
      roles: ["worker", "planning", "chief"],
      minRemainingPercent: 0,
      unknownLimit: "use",
    });
    expect(rows[1]).toMatchObject({ harness: "claude", roles: ["reply"] });
  });
  it("leaves the account unset for a harness without provider accounts, so it saves unchanged", async () => {
    const rows = deriveAssistantModelPool({
      execution: { ...execution("gpt-5"), harness: "grok", model: "grok-4" },
      replyExecution: execution("fast", "claude"),
    } as never);
    expect(rows[0]).not.toHaveProperty("providerAccountId");
    expect(rows[1]).toMatchObject({ harness: "claude", providerAccountId: "default" });
    await expect(setAssistantModelPool(deps(), 0, rows)).resolves.toBeDefined();
  });
  it("is empty without any execution", () => {
    expect(deriveAssistantModelPool({ execution: null } as never)).toEqual([]);
  });
  it("is returned as derived at version 0 until a pool is saved", async () => {
    expect(await getAssistantModelPool(deps())).toMatchObject({ derived: true, version: 0 });
  });
});

describe("derived pool with a catalog", () => {
  const same = {
    ...(profile as object),
    replyExecution: execution("gpt-5"),
    planningExecution: undefined,
  } as never;
  it("uses the value-aware default only for the derived view", async () => {
    setAssistantModelPoolPorts({
      catalog: async () => ({
        models: {
          codex: [
            { id: "gpt-5", name: "GPT-5" },
            { id: "mini", name: "GPT-5 Mini" },
          ],
        },
      }),
    });
    const d = { ...deps(), profile: async () => same };
    const derived = await getAssistantModelPool(d);
    expect(derived.derived).toBe(true);
    expect(derived.rows.map((r) => r.model)).toEqual(["gpt-5", "mini"]);
    await setAssistantModelPool(d, 0, [row("a")]);
    expect((await getAssistantModelPool(d)).rows.map((r) => r.id)).toEqual(["a"]);
  });
});

describe("set", () => {
  it("saves, bumps the version and rejects a stale expectedVersion", async () => {
    const d = deps();
    const saved = await setAssistantModelPool(d, 0, [row("a"), row("b")]);
    expect(saved).toMatchObject({ derived: false, version: 1, updatedAt: 1000 });
    expect(saved.rows.map((r) => r.id)).toEqual(["a", "b"]);
    await expect(setAssistantModelPool(d, 0, [row("a")])).rejects.toThrow(/reload/);
    expect((await setAssistantModelPool(d, 1, [row("c")])).version).toBe(2);
  });
  it("rejects duplicate ids, a missing worker row and bad accounts", async () => {
    const d = deps();
    await expect(setAssistantModelPool(d, 0, [row("a"), row("a")])).rejects.toThrow(/unique/);
    await expect(setAssistantModelPool(d, 0, [row("a", { roles: ["chief"] })])).rejects.toThrow(
      /worker/,
    );
    await expect(
      setAssistantModelPool(d, 0, [row("a", { providerAccountId: "nope" })]),
    ).rejects.toThrow(/Unknown/);
    await expect(
      setAssistantModelPool(d, 0, [row("a", { harness: "grok", providerAccountId: "x" })]),
    ).rejects.toThrow(/no provider accounts/);
    await expect(
      setAssistantModelPool(d, 0, [row("a", { providerAccountId: "work" })]),
    ).resolves.toBeTruthy();
  });
  it("checks the catalog only when it lists the harness", async () => {
    const d = deps();
    setAssistantModelPoolPorts({ catalog: async () => ({ models: { codex: [{ id: "gpt-5" }] } }) });
    await expect(setAssistantModelPool(d, 0, [row("a", { model: "ghost" })])).rejects.toThrow(
      /not available/,
    );
    await expect(
      setAssistantModelPool(d, 0, [row("a", { harness: "grok", model: "any" })]),
    ).resolves.toBeTruthy();
    setAssistantModelPoolPorts({ catalog: async () => undefined });
    await expect(setAssistantModelPool(d, 1, [row("a", { model: "ghost" })])).resolves.toBeTruthy();
  });
  it("clearing the pool returns to the derived view", async () => {
    const d = deps();
    await setAssistantModelPool(d, 0, [row("a")]);
    expect(await setAssistantModelPool(d, 1, [])).toMatchObject({ derived: true, version: 2 });
  });
  it("only the owner may set", async () => {
    const d = deps();
    await expect(
      assistantModelPoolOp(
        { op: "models.pool.set", expectedVersion: 0, rows: [row("a")] },
        "chief",
        d,
      ),
    ).rejects.toThrow(/owner/);
    await expect(
      assistantModelPoolOp({ op: "models.pool.get" }, "assistant", d),
    ).resolves.toHaveProperty("modelPool");
  });
});

describe("wire compatibility", () => {
  it("parses the new ops and a modelPool response", () => {
    expect(AssistantRequestValidationSchema.parse({ op: "models.pool.get" })).toBeTruthy();
    expect(
      AssistantRequestValidationSchema.parse({
        op: "models.pool.set",
        expectedVersion: 0,
        rows: [row("a")],
      }),
    ).toBeTruthy();
    expect(
      AssistantResponseValidationSchema.parse({
        modelPool: { rows: [row("a")], version: 1, updatedAt: 1, derived: false },
      }),
    ).toBeTruthy();
  });
  it("keeps the pool out of profile and snapshot (old phone apps parse strictly)", () => {
    expect(() =>
      AssistantRequestValidationSchema.parse({
        op: "profile.update",
        expectedVersion: 0,
        patch: { modelPool: [] },
      }),
    ).toThrow();
    const snapshot = AssistantResponseValidationSchema.shape.snapshot.unwrap();
    expect(Object.keys(snapshot.shape)).not.toContain("modelPool");
    expect(Object.keys(snapshot.shape.profile.shape)).not.toContain("modelPool");
  });
});
