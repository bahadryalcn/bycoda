import { afterEach, expect, it } from "vitest";
import { cleanups, setup } from "../engine-support/engine.test-support";
import { HostAutomations } from "./automations";

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture() {
  const f = await setup();
  const automations = new HostAutomations(f.store, f.engine);
  await automations.ready;
  const snapshot = JSON.stringify({
    automation: {
      id: "native-audit",
      cwd: f.project.cwd,
      name: "Native audit",
      prompt: "Inspect source",
      harness: "codex",
      model: "codex:test",
      modelSettings: {},
      runtimeMode: "supervised",
      scheduleKind: "daily",
      minute: 0,
      time: "09:00",
      dayOfWeek: 1,
      enabled: true,
      nextRunAt: Date.now() + 60_000,
      createdAt: 1,
      updatedAt: 2,
      missedRunGraceMinutes: 60,
    },
    runs: [
      {
        id: "native-run",
        trigger: "manual",
        scheduledFor: 1,
        createdAt: 1,
        completedAt: 2,
        status: "succeeded",
        sessionId: "native-session",
      },
    ],
  });
  const proof = {
    automationId: "native-audit",
    receipt: "receipt-1",
    targetHostId: f.store.environmentId,
    snapshot,
    phase: "prepared" as const,
  };
  return { ...f, automations, proof, input: { projectId: f.project.id, nativeMigration: proof } };
}

it("imports disabled, preserves native history and activates only exact committed receipt", async () => {
  const f = await fixture();
  const imported = await f.automations.save(f.input);
  expect(imported).toMatchObject({
    enabled: false,
    missedRunGraceMinutes: 60,
    nativeMigrationState: { phase: "prepared" },
  });
  await expect(f.automations.runNow(imported.id)).rejects.toThrow("not committed");
  const history = await f.automations.runs(imported.id);
  expect(history).toHaveLength(1);
  expect(history[0]).toMatchObject({
    nativeRunId: "native-run",
    nativeSessionId: "native-session",
  });
  expect(history[0].sessionId).toBeUndefined();
  await expect(
    f.automations.save({
      ...f.input,
      nativeMigration: { ...f.proof, phase: "committed", hostAutomationId: "other" },
    }),
  ).rejects.toThrow("another Host automation");
  const committed = await f.automations.save({
    ...f.input,
    nativeMigration: { ...f.proof, phase: "committed", hostAutomationId: imported.id },
  });
  expect(committed.enabled).toBe(true);
  expect((await f.automations.save(f.input)).enabled).toBe(true);
  expect(await f.automations.runs(imported.id)).toHaveLength(1);
  await f.automations.close();
});

it("rejects changed snapshots and wrong Host/project without changing prepared state", async () => {
  const f = await fixture();
  const imported = await f.automations.save(f.input);
  await expect(
    f.automations.save({
      ...f.input,
      nativeMigration: {
        ...f.proof,
        snapshot: f.proof.snapshot.replace("Inspect source", "Changed instructions"),
      },
    }),
  ).rejects.toThrow("payload changed");
  await expect(
    f.automations.save({ ...f.input, nativeMigration: { ...f.proof, targetHostId: "other-host" } }),
  ).rejects.toThrow("another Host");
  expect((await f.automations.list()).find((item) => item.id === imported.id)?.enabled).toBe(false);
  await f.automations.close();
});
