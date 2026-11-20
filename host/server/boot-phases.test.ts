import { afterEach, expect, it, vi } from "vitest";
import { BOOT_STALL_WARNING_MS, bootPhase, createBootTimer, readyWithin } from "./boot-phases";

afterEach(() => vi.useRealTimers());

function recorder() {
  const lines: string[] = [];
  const write = (level: string) => (message: string, fields?: Record<string, unknown>) => {
    lines.push(`${level} ${message} ${JSON.stringify(fields)}`);
  };
  return { lines, log: { info: write("info"), warn: write("warn") } };
}

it("reports contiguous phases that add up to the total start-up time", () => {
  const { lines, log } = recorder();
  let clock = 1_000;
  const boot = createBootTimer(
    log,
    () => clock,
    () => 2_300.4,
  );
  boot.phase("owner-lease");
  clock += 40;
  boot.phase("db-open");
  clock += 18_000;
  boot.phase("listen");
  clock += 5;
  boot.ready();
  expect(lines).toEqual([
    'info boot {"phase":"pre-serve","ms":2300}',
    'info boot {"phase":"owner-lease","ms":40}',
    'info boot {"phase":"db-open","ms":18000}',
    'info boot {"phase":"listen","ms":5}',
    'info boot {"phase":"total","ms":18045}',
  ]);
});

it("names the phase in which start-up failed, once", () => {
  const { lines, log } = recorder();
  let clock = 0;
  const boot = createBootTimer(
    log,
    () => clock,
    () => 0,
  );
  boot.phase("owner-lease");
  clock += 3;
  boot.failed();
  boot.failed();
  expect(lines.slice(1)).toEqual(['warn boot failed {"phase":"owner-lease","ms":3}']);
});

it("times an awaited step without changing its result or its failure", async () => {
  const { lines, log } = recorder();
  let clock = 0;
  const now = () => clock;
  const value = await bootPhase(
    "tasks",
    async () => {
      clock += 250;
      return "ready";
    },
    log,
    now,
  );
  expect(value).toBe("ready");
  const failure = new Error("recover failed");
  await expect(
    bootPhase(
      "lifecycle",
      async () => {
        clock += 7;
        throw failure;
      },
      log,
      now,
    ),
  ).rejects.toBe(failure);
  expect(lines).toEqual([
    'info boot {"phase":"tasks","ms":250}',
    'warn boot failed {"phase":"lifecycle","ms":7}',
  ]);
});

it("names a step that has not settled at each stall interval until it ends", async () => {
  vi.useFakeTimers();
  const { lines, log } = recorder();
  let clock = 0;
  let finish!: () => void;
  const step = bootPhase(
    "recovery-managed",
    () => new Promise<void>((resolve) => (finish = resolve)),
    log,
    () => clock,
  );
  clock = BOOT_STALL_WARNING_MS;
  await vi.advanceTimersByTimeAsync(BOOT_STALL_WARNING_MS);
  clock = 2 * BOOT_STALL_WARNING_MS;
  await vi.advanceTimersByTimeAsync(BOOT_STALL_WARNING_MS);
  finish();
  await step;
  await vi.advanceTimersByTimeAsync(BOOT_STALL_WARNING_MS);
  expect(lines).toEqual([
    'warn boot stalled {"phase":"recovery-managed","ms":30000}',
    'warn boot stalled {"phase":"recovery-managed","ms":60000}',
    'info boot {"phase":"recovery-managed","ms":60000}',
  ]);
});

it("lets start-up continue without an optional service that misses its deadline", async () => {
  vi.useFakeTimers();
  const { lines, log } = recorder();
  let clock = 0;
  let finish!: () => void;
  const ready = new Promise<void>((resolve) => (finish = resolve));
  const waited = readyWithin("recovery-service-social", ready, 1_000, log, () => clock);
  clock = 1_000;
  await vi.advanceTimersByTimeAsync(1_000);
  await expect(waited).resolves.toBeUndefined();
  clock = 5_000;
  finish();
  await vi.advanceTimersByTimeAsync(0);
  expect(lines).toEqual([
    'warn boot degraded {"phase":"recovery-service-social","ms":1000}',
    'info boot {"phase":"recovery-service-social","ms":5000,"late":true}',
  ]);
  // A readiness failure within the deadline still fails start-up.
  const failure = new Error("social store failed");
  await expect(readyWithin("social", Promise.reject(failure), 1_000, log)).rejects.toBe(failure);
});
