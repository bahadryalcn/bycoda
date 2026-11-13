import { expect, it, vi } from "vitest";
import type { AssistantQuickAutomationJob } from "../../../src/shared/model/host-contracts/assistant";
import {
  assistantQuickAutomationPoolJob,
  assistantQuickAutomationConfiguration,
  setQuickAutomationModelPool,
} from "./assistant-quick-automations";
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

it("stores default routing for an empty voice choice without consulting the worker pool", async () => {
  const pool = vi.fn(async () => {
    throw new Error("Worker pool must not be read");
  });
  setQuickAutomationModelPool(pool);
  const result = await assistantQuickAutomationPoolJob(job(""), {
    harness: "codex",
    model: "codex:fallback",
    modelSettings: {},
  });
  expect(result.quickAction).toMatchObject({
    harness: "codex",
    modelChoice: { kind: "default" },
    modelSettings: {},
    runtimeMode: "supervised",
  });
  expect(result.quickAction.model.length).toBeGreaterThan(0);
  expect(pool).not.toHaveBeenCalled();
  setQuickAutomationModelPool(undefined);
});
it("keeps an explicit owner choice as legacy fixed", async () => {
  const original = job("owner-model");
  expect(await assistantQuickAutomationPoolJob(original)).toBe(original);
});

it("preserves routing and account when building the persisted canonical automation", () => {
  const original = job("codex:fallback");
  const configured = {
    ...original,
    quickAction: {
      ...original.quickAction,
      projectId: "project",
      name: "Audit",
      prompt: "Audit",
      scheduleKind: "daily" as const,
      minute: 0,
      time: "09:00",
      dayOfWeek: 1,
      maxRunMinutes: 0,
      maxRunsPerDay: 0,
      isolate: false,
      enabled: true,
      modelChoice: { kind: "pool" as const, poolId: "pool" },
      providerAccountId: "account",
    },
  };
  expect(assistantQuickAutomationConfiguration(configured)).toMatchObject({
    modelChoice: { kind: "pool", poolId: "pool" },
    providerAccountId: "account",
  });
});

it("keeps an explicit pool for a model-free item and requires a concrete fallback", async () => {
  const original = {
    ...job(""),
    quickAction: { ...job("").quickAction, modelChoice: { kind: "pool" as const, poolId: "pool" } },
  };
  const result = await assistantQuickAutomationPoolJob(original, {
    harness: "claude",
    model: "claude:fallback",
    modelSettings: {},
  });
  expect(result.quickAction).toMatchObject({
    modelChoice: { kind: "pool", poolId: "pool" },
    model: "claude:fallback",
  });
  await expect(assistantQuickAutomationPoolJob(job(""))).rejects.toThrow("fallback model");
  const fixed = {
    ...original,
    quickAction: { ...original.quickAction, modelChoice: { kind: "fixed" as const } },
  };
  await expect(assistantQuickAutomationPoolJob(fixed)).rejects.toThrow("fixed automation");
});
