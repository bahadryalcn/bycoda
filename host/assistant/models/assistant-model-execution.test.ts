import { describe, expect, it } from "vitest";
import type { AssistantModelPoolRow } from "../../../src/shared/model/assistantModelPool";
import type { AssistantProfile } from "../../../src/shared/model/host-contracts/assistant";
import {
  AssistantModelsHeldError,
  chooseAssistantExecution,
  createAssistantModelSelector,
} from "./assistant-model-execution";
import type { AssistantQuotaReading } from "./assistant-quota-reader";

const base = {
  harness: "claude",
  modelSettings: {},
  runtimeMode: "auto",
  maxRunMinutes: 60,
} as const;
const row = (id: string, extra: Partial<AssistantModelPoolRow> = {}): AssistantModelPoolRow => ({
  ...base,
  id,
  model: `m-${id}`,
  roles: ["worker"],
  minRemainingPercent: 10,
  unknownLimit: "use",
  ...extra,
});
const profile = {
  execution: { ...base, model: "profile-model" },
} as unknown as AssistantProfile;
function selector(rows: AssistantModelPoolRow[] | null, left: Record<string, number | "unknown">) {
  const record = rows
    ? {
        id: "model-pool",
        version: 1,
        createdAt: 1,
        updatedAt: 1,
        value: { rows },
      }
    : undefined;
  return createAssistantModelSelector({
    repository: {
      get: async () => record,
      put: async () => undefined,
    } as never,
    quota: {
      reading: (_h: string, _a: string | undefined, model: string): AssistantQuotaReading => {
        const value = left[model] ?? 100;
        return value === "unknown"
          ? { unknown: true, reason: "noSample" }
          : { leftPercent: value, resetsAt: 5000, sampledAt: 1 };
      },
    },
  });
}

describe("model selector", () => {
  it("returns null for a derived pool so the profile applies unchanged", async () => {
    expect(await selector(null, {})("worker", profile)).toBeNull();
  });
  it("uses the first row and carries a non-default account", async () => {
    const choice = await selector([row("a", { providerAccountId: "work" }), row("b")], {})(
      "worker",
      profile,
    );
    expect(choice).toMatchObject({
      rowId: "a",
      reason: "first",
      execution: { harness: "claude", model: "m-a", providerAccountId: "work" },
    });
  });
  it("omits the default account and skips a row below its threshold", async () => {
    const choice = await selector([row("a"), row("b", { providerAccountId: "default" })], {
      "m-a": 5,
    })("worker", profile);
    expect(choice).toMatchObject({ rowId: "b", reason: "skipped:a" });
    expect((choice as { execution: object }).execution).not.toHaveProperty("providerAccountId");
  });
  it("holds with the earliest reset when every row is limited", async () => {
    const choice = await selector([row("a"), row("b")], { "m-a": 1, "m-b": 2 })("worker", profile);
    expect(choice).toEqual({ held: "limits", nextResetAt: 5000 });
    await expect(
      chooseAssistantExecution(selector([row("a")], { "m-a": 1 }), "worker", profile),
    ).rejects.toMatchObject({
      name: "AssistantModelsHeldError",
      held: "limits",
      nextResetAt: 5000,
    });
  });
  it("selects separate rows per role and reports a role without rows", async () => {
    const pick = selector(
      [row("w"), row("r", { roles: ["reply"] }), row("c", { roles: ["chief"] })],
      {},
    );
    expect(await pick("reply", profile)).toMatchObject({ rowId: "r" });
    expect(await pick("chief", profile)).toMatchObject({ rowId: "c" });
    expect(await pick("planning", profile)).toEqual({ held: "noRow" });
    await expect(chooseAssistantExecution(pick, "planning", profile)).rejects.toBeInstanceOf(
      AssistantModelsHeldError,
    );
  });
  it("follows unknownLimit for unreadable quota", async () => {
    const pick = selector([row("a", { unknownLimit: "skip" }), row("b")], {
      "m-a": "unknown",
    });
    expect(await pick("worker", profile)).toMatchObject({ rowId: "b" });
  });
});
