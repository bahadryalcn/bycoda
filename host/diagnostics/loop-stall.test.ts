import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { watchLoopStalls } from "./loop-stall";

const dirs: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(profileDir?: string) {
  vi.useFakeTimers();
  let clock = 0;
  const log = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const profiler = vi.fn(async () => '{"nodes":[]}');
  const watch = watchLoopStalls({ log, profileDir, profiler, now: () => clock });
  /** One timer tick that arrived `lagMs` late. */
  const tick = async (lagMs = 0) => {
    clock += 200 + lagMs;
    await vi.advanceTimersByTimeAsync(200);
  };
  return { log, profiler, watch, tick, advance: (ms: number) => (clock += ms) };
}

it("warns about a stall when it happens, rate-limited, and reports the max", async () => {
  const { log, watch, tick } = fixture();
  await tick();
  expect(log.warn).not.toHaveBeenCalled();
  await tick(1_200);
  await tick(800);
  expect(log.warn).toHaveBeenCalledTimes(1);
  expect(log.warn).toHaveBeenCalledWith("event loop stalled", { lagMs: 1_200, recentStalls: 1 });
  expect(watch.takeMaxLagMs()).toBe(1_200);
  expect(watch.takeMaxLagMs()).toBe(0);
  watch.stop();
});

it("saves one CPU profile for repeated stalls and keeps only the newest ones", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bycoda-stall-"));
  dirs.push(dir);
  for (const name of ["stall-1.cpuprofile", "stall-2.cpuprofile", "stall-3.cpuprofile"])
    writeFileSync(join(dir, name), "{}");
  writeFileSync(join(dir, "host.log"), "");
  const { log, profiler, watch, tick } = fixture(dir);
  for (let index = 0; index < 5; index++) await tick(700);
  await vi.waitFor(() => expect(log.warn).toHaveBeenCalledWith("stall profile saved", expect.anything()));
  expect(profiler).toHaveBeenCalledTimes(1);
  const files = readdirSync(dir).sort();
  expect(files.filter((name) => name.endsWith(".cpuprofile"))).toHaveLength(3);
  expect(files).toContain("host.log");
  expect(files).not.toContain("stall-1.cpuprofile");
  watch.stop();
});

it("profiles nothing without a directory", async () => {
  const { profiler, watch, tick } = fixture();
  for (let index = 0; index < 5; index++) await tick(700);
  expect(profiler).not.toHaveBeenCalled();
  watch.stop();
});
