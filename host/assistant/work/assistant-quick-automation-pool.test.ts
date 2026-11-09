import { afterEach, expect, it } from "vitest";
import type { AssistantQuickAutomationJob } from "../../../src/shared/model/host-contracts/assistant";
import {
  assistantQuickAutomationPoolJob,
  setQuickAutomationModelPool,
} from "./assistant-quick-automations";

afterEach(() => setQuickAutomationModelPool(undefined));
const job = (model: string) =>
  ({
    id: "job",
    kind: "quick",
    quickAction: {
      kind: "automation",
      harness: "codex",
      model,
      modelSettings: {},
      runtimeMode: "supervised",
    },
  }) as unknown as AssistantQuickAutomationJob;
const row = (over: Record<string, unknown>) => ({
  id: "r",
  harness: "claude" as const,
  model: "sonnet",
  modelSettings: { effort: "high" },
  runtimeMode: "auto" as const,
  maxRunMinutes: 30,
  roles: ["worker" as const],
  unknownLimit: "use" as const,
  ...over,
});

it("fills the voice quick automation model from the first worker pool row", async () => {
  setQuickAutomationModelPool(async () => ({
    rows: [row({ id: "chief", model: "opus", roles: ["chief"] }), row({})],
  }));
  const resolved = await assistantQuickAutomationPoolJob(job(""));
  expect(resolved.quickAction).toMatchObject({
    harness: "claude",
    model: "sonnet",
    modelSettings: { effort: "high" },
    runtimeMode: "auto",
  });
});
it("keeps an owner-chosen model and fails when the pool has no worker row", async () => {
  setQuickAutomationModelPool(async () => ({ rows: [row({})] }));
  expect((await assistantQuickAutomationPoolJob(job("owner-pick"))).quickAction).toMatchObject({
    model: "owner-pick",
  });
  setQuickAutomationModelPool(async () => ({ rows: [row({ roles: ["chief"] })] }));
  await expect(assistantQuickAutomationPoolJob(job(""))).rejects.toThrow("model pool");
});
