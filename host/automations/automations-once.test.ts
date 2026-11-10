import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostProvider } from "../providers/providers";
import { HostEngine } from "../engine";
import { HostStore } from "../store";
import { HostAutomations } from "./automations";

if (process.platform === "win32") vi.setConfig({ testTimeout: 60000 });
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const DAY = 86_400_000;

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-automations-once-"));
  const store = new HostStore(join(directory, "host.db"));
  const project = await store.addProject(directory, "Test");
  const sent: unknown[] = [];
  const provider: HostProvider = {
    send: vi.fn(
      (input) =>
        new Promise<void>((resolve) => {
          sent.push(input);
          resolve();
        }),
    ),
    cancel: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    bind: vi.fn(),
    approve: vi.fn(),
    answer: vi.fn(),
  };
  const engine = new HostEngine(store, { claude: provider });
  vi.spyOn(engine.checkpoints, "begin").mockResolvedValue();
  vi.spyOn(engine.checkpoints, "finish").mockResolvedValue();
  const clock = { now: new Date("2026-10-05T08:00:00").getTime() };
  const automations = new HostAutomations(store, engine, () => clock.now);
  cleanups.push(async () => {
    await engine.close();
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const input = (overrides: Record<string, unknown> = {}) => ({
    id: "once",
    name: "One time",
    prompt: "Do it",
    projectId: project.id,
    harness: "claude",
    model: "claude:test",
    modelSettings: {},
    runtimeMode: "auto",
    isolate: false,
    scheduleKind: "daily",
    minute: 0,
    time: "09:00",
    dayOfWeek: 1,
    maxRunMinutes: 0,
    maxRunsPerDay: 0,
    enabled: true,
    ...overrides,
  });
  return { automations, clock, input, sent };
}

it("runs a one-time automation once at its time and then turns itself off", async () => {
  const f = await setup();
  await f.automations.save(f.input());
  const runAt = f.clock.now + 3 * DAY + 3_600_000;
  await f.automations.scheduleOnce("once", runAt);
  expect((await f.automations.list())[0].nextRunAt).toBe(runAt);
  // The daily occurrence tomorrow must not fire it early.
  f.clock.now += DAY + 3_600_000;
  await f.automations.tick();
  expect(f.sent).toHaveLength(0);
  f.clock.now = runAt + 1000;
  await f.automations.tick();
  await vi.waitFor(() => expect(f.sent).toHaveLength(1));
  expect((await f.automations.list())[0].enabled).toBe(false);
  f.clock.now += 2 * DAY;
  await f.automations.tick();
  await f.automations.tick();
  expect(f.sent).toHaveLength(1);
  expect(await f.automations.runs("once")).toHaveLength(1);
});

it("rejects a past or too-distant run time", async () => {
  const f = await setup();
  await f.automations.save(f.input());
  await expect(f.automations.scheduleOnce("once", f.clock.now - 1)).rejects.toThrow("future");
  await expect(f.automations.scheduleOnce("once", f.clock.now + 400 * DAY)).rejects.toThrow(
    "one year",
  );
  await expect(f.automations.scheduleOnce("missing", f.clock.now + DAY)).rejects.toThrow(
    "not found",
  );
});

it("keeps the arming through a pause edit but drops it when the schedule changes", async () => {
  const f = await setup();
  await f.automations.save(f.input());
  const runAt = f.clock.now + 5 * DAY;
  await f.automations.scheduleOnce("once", runAt);
  await f.automations.save(f.input({ enabled: false }));
  await f.automations.save(f.input({ enabled: true }));
  expect((await f.automations.list())[0].nextRunAt).toBe(runAt);
  await f.automations.save(f.input({ time: "10:30" }));
  expect((await f.automations.list())[0].nextRunAt).toBeLessThan(runAt);
});
