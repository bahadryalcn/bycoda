import { expect, it } from "vitest";
import { AssistantRequestSchema } from "../../../src/shared/model/host-contracts/assistant";
import {
  EMPTY_MODEL_ROUTING,
  type ModelRoutingState,
} from "../../../src/shared/model/host-contracts/model-routing";
import { getAssistantModelPool } from "./assistant-model-pool";

it("models.pool.get is a read-only view of every main-order entry", async () => {
  const state: ModelRoutingState = {
    ...EMPTY_MODEL_ROUTING,
    version: 7,
    updatedAt: 100,
    entries: Array.from({ length: 40 }, (_, index) => ({
      id: String(index),
      harness: "codex",
      model: "m",
      providerAccountId: "work",
      modelSettings: { effort: "high" },
      unknownLimit: "skip",
    })),
  };
  const pool = await getAssistantModelPool({
    routing: { get: async () => state },
    profile: async () => ({ execution: { runtimeMode: "supervised", maxRunMinutes: 12 } }) as never,
  });
  expect(pool.version).toBe(7);
  expect(pool.rows).toHaveLength(40);
  expect(pool.rows[0]).toMatchObject({
    id: "0",
    providerAccountId: "work",
    roles: ["worker", "planning", "chief", "reply"],
    runtimeMode: "supervised",
    maxRunMinutes: 12,
  });
  expect(AssistantRequestSchema.safeParse({ op: "models.pool.get" }).success).toBe(true);
  expect(
    AssistantRequestSchema.safeParse({ op: "models.pool.set", expectedVersion: 0, rows: [] })
      .success,
  ).toBe(false);
});
it("an empty order never invents catalog or profile entries", async () => {
  const pool = await getAssistantModelPool({
    routing: { get: async () => ({ ...EMPTY_MODEL_ROUTING, version: 0, updatedAt: 0 }) },
    profile: async () => ({ execution: { model: "profile-model" } }) as never,
  });
  expect(pool.rows).toEqual([]);
});
