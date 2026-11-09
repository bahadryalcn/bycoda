import { expect, it } from "vitest";
import {
  voiceGlobalToolAllowed,
  voiceThreadToolAllowed,
} from "../../src/shared/model/voiceToolScope";
import { VOICE_CAPABILITY_COVERAGE } from "../voice/voice-capability-coverage";
import { CONVERSATION_TOOLS } from "./conversation-tools";
import { assertPoolExecution } from "./conversation-model-pool-guard";
import { callModelPoolTool } from "./conversation-model-pool-source";

const row = (over: Record<string, unknown>) => ({
  id: "a",
  harness: "codex" as const,
  model: "gpt",
  modelSettings: { effort: "high" },
  runtimeMode: "supervised" as const,
  maxRunMinutes: 30,
  roles: ["worker" as const],
  unknownLimit: "use" as const,
  ...over,
});
const pool = { rows: [row({}), row({ id: "b", providerAccountId: "work", model: "gpt-2" })] };

it("returns the canonical row execution for a pool model and rejects others", () => {
  expect(
    assertPoolExecution({ harness: "codex", model: "gpt", modelSettings: { effort: "low" } }, pool),
  ).toMatchObject({ poolRowId: "a", modelSettings: { effort: "high" }, runtimeMode: "supervised" });
  expect(() => assertPoolExecution({ harness: "codex", model: "x" }, pool)).toThrow(
    "This model is not in the assistant's model pool. Choose one of: gpt, gpt-2.",
  );
  // Same model on an account that is not in the pool is outside it.
  expect(() =>
    assertPoolExecution({ harness: "codex", model: "gpt", providerAccountId: "work" }, pool),
  ).toThrow("model pool");
  expect(assertPoolExecution({ poolRowId: "b" }, pool)).toMatchObject({
    model: "gpt-2",
    providerAccountId: "work",
  });
});
it("lists the pool for the voice model in both voice scopes", async () => {
  expect(voiceGlobalToolAllowed("conversation", "models.pool.list")).toBe(true);
  expect(voiceThreadToolAllowed("conversation", "models.pool.list")).toBe(true);
  expect(VOICE_CAPABILITY_COVERAGE.models.tools).toContain("models.pool.list");
  expect(CONVERSATION_TOOLS).toHaveProperty("models.pool.list");
  const result = (await callModelPoolTool("models.pool.list", {}, async () => pool)) as {
    rows: { id: string; effort: string | null; account: string; roles: string[] }[];
  };
  expect(result.rows.map((entry) => [entry.id, entry.effort, entry.account])).toEqual([
    ["a", "high", "default"],
    ["b", "high", "work"],
  ]);
  await expect(callModelPoolTool("models.pool.list", { x: 1 }, async () => pool)).rejects.toThrow();
});
