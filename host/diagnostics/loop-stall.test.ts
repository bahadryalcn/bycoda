import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { setStallProfilesEnabled, trackRpc, watchLoopStalls } from "./loop-stall";

const dirs: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(profileDir?: string, profilesEnabled: (() => boolean) | null = () => true) {
  vi.useFakeTimers();
  let clock = 0;
  let wallClock = 1_000_000;
  const log = {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  };
  const profiler = vi.fn(async () => '{"nodes":[]}');
  const watch = watchLoopStalls({
    log,
    profileDir,
    profiler,
    profilesEnabled: profilesEnabled ?? undefined,
    now: () => clock,
    wall: () => wallClock,
  });
  /** One timer tick that arrived `lagMs` late. */
  const tick = async (lagMs = 0) => {
    clock += 200 + lagMs;
    wallClock += 200 + lagMs;
    await vi.advanceTimersByTimeAsync(200);
  };
  /** A tick after the machine slept: wall time jumps, the monotonic clock barely moves. */
  const sleepTick = async (wallJumpMs: number, monotonicMs = 200) => {
    clock += monotonicMs;
    wallClock += wallJumpMs;
    await vi.advanceTimersByTimeAsync(200);
  };
  return { log, profiler, watch, tick, sleepTick, now: () => clock };
}

it("warns about a stall when it happens, rate-limited, and reports the max", async () => {
  const { log, watch, tick } = fixture();
  await tick();
  expect(log.warn).not.toHaveBeenCalled();
  await tick(1_200);
  await tick(800);
  expect(log.warn).toHaveBeenCalledTimes(1);
  expect(log.warn).toHaveBeenCalledWith("event loop stalled", {
    lagMs: 1_200,
    recentStalls: 1,
    rpcCompleted: 0,
  });
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
  expect(profiler).not.toHaveBeenCalled();
  for (let index = 0; index < 60; index++) await tick();
  await vi.waitFor(() =>
    expect(log.warn).toHaveBeenCalledWith("stall profile saved", expect.anything()),
  );
  expect(profiler).toHaveBeenCalledTimes(1);
  const files = readdirSync(dir).sort();
  expect(files.filter((name) => name.endsWith(".cpuprofile"))).toHaveLength(3);
  expect(files).toContain("host.log");
  expect(files).not.toContain("stall-1.cpuprofile");
  watch.stop();
});

it("profiles nothing until the owner turns stall profiles on", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bycoda-stall-"));
  dirs.push(dir);
  const { profiler, watch, tick } = fixture(dir, null);
  for (let index = 0; index < 5; index++) await tick(700);
  expect(profiler).not.toHaveBeenCalled();
  setStallProfilesEnabled(true);
  try {
    for (let index = 0; index < 3; index++) await tick(700);
    for (let index = 0; index < 60; index++) await tick();
    expect(profiler).toHaveBeenCalledTimes(1);
  } finally {
    setStallProfilesEnabled(false);
    watch.stop();
  }
});

it("profiles nothing without a directory", async () => {
  const { profiler, watch, tick } = fixture();
  for (let index = 0; index < 5; index++) await tick(700);
  expect(profiler).not.toHaveBeenCalled();
  watch.stop();
});

it("treats a laptop sleep as a resume, not a stall", async () => {
  const { log, profiler, watch, tick, sleepTick } = fixture();
  await tick();
  await sleepTick(15 * 60_000);
  expect(log.warn).not.toHaveBeenCalled();
  expect(log.info).toHaveBeenCalledWith("Host resumed after suspend", { wallGapMs: 900_000 });
  expect(watch.takeMaxLagMs()).toBe(0);
  expect(profiler).not.toHaveBeenCalled();
  watch.stop();
});

it("names the in-flight RPCs older than the lag and counts those completed", async () => {
  const { log, watch, tick, now } = fixture();
  await tick();
  const slow = trackRpc("files.searchContent", now);
  const quick = trackRpc("sessions.get", now);
  quick();
  await tick(2_000);
  expect(log.warn).toHaveBeenCalledTimes(1);
  expect(log.warn).toHaveBeenCalledWith(
    "event loop stalled",
    expect.objectContaining({ rpcCompleted: 1, inflight: "files.searchContent 2200ms" }),
  );
  slow();
  watch.stop();
});

it("reports a long gap where both clocks agree as a pause, without stats or profiling", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bycoda-stall-"));
  dirs.push(dir);
  const { log, profiler, watch, tick } = fixture(dir);
  await tick(15 * 60_000);
  expect(log.warn).not.toHaveBeenCalled();
  expect(log.info).toHaveBeenCalledWith("Host paused (likely sleep or debugger)", {
    gapMs: 900_200,
  });
  expect(watch.takeMaxLagMs()).toBe(0);
  expect(profiler).not.toHaveBeenCalled();
  watch.stop();
});

it("never starts the profiler during a wave, only once the loop has been quiet", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bycoda-stall-"));
  dirs.push(dir);
  const { profiler, watch, tick } = fixture(dir);
  for (let index = 0; index < 10; index++) {
    await tick(700);
    await tick();
  }
  expect(profiler).not.toHaveBeenCalled();
  for (let index = 0; index < 60; index++) await tick();
  expect(profiler).toHaveBeenCalledTimes(1);
  watch.stop();
});

it("leaves held long polls out of the in-flight list and names a finished slow call", async () => {
  const { log, watch, tick, now } = fixture();
  await tick();
  const held = trackRpc("machine.changes", now, true);
  const slow = trackRpc("files.searchContent", now);
  const done = trackRpc("git.status", now);
  const longDone = trackRpc("a".repeat(200), now);
  await tick(300);
  done();
  longDone();
  await tick(1_200);
  const fields = log.warn.mock.calls.find((call) => call[0] === "event loop stalled")![1];
  expect(fields.inflight).toBe("files.searchContent 1900ms");
  expect(fields.inflight).not.toContain("machine.changes");
  expect(fields.finished).toContain("git.status 500ms");
  expect(fields.finished).toContain(`${"a".repeat(64)} `);
  expect(fields.finished).not.toContain("a".repeat(65));
  held();
  slow();
  watch.stop();
});

it("drops a profile request the hourly limit refused instead of profiling an idle Host later", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bycoda-stall-"));
  dirs.push(dir);
  const { log, profiler, watch, tick, sleepTick } = fixture(dir);
  for (let index = 0; index < 3; index++) await tick(700);
  for (let index = 0; index < 60; index++) await tick();
  await vi.waitFor(() =>
    expect(log.warn).toHaveBeenCalledWith("stall profile saved", expect.anything()),
  );
  expect(profiler).toHaveBeenCalledTimes(1);
  // A second wave inside the hour is refused at its quiet tick.
  for (let index = 0; index < 3; index++) await tick(700);
  for (let index = 0; index < 60; index++) await tick();
  expect(profiler).toHaveBeenCalledTimes(1);
  // Hours later the Host is idle: the refused wave must not be profiled now.
  await sleepTick(2 * 60 * 60_000, 2 * 60 * 60_000);
  for (let index = 0; index < 60; index++) await tick();
  expect(profiler).toHaveBeenCalledTimes(1);
  watch.stop();
});

it("reports a 90 s gap where both clocks agree as a pause (Windows sleep)", async () => {
  const { log, watch, tick } = fixture();
  await tick();
  await tick(90_000);
  expect(log.warn).not.toHaveBeenCalled();
  expect(log.info).toHaveBeenCalledWith("Host paused (likely sleep or debugger)", {
    gapMs: 90_200,
  });
  watch.stop();
});
