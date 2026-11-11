import { expect, it } from "vitest";
import { bootPhase, createBootTimer } from "./boot-phases";

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
