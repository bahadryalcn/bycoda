import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { buildCrashMarker, createFatalHandler, crashMarkerPath } from "./crash";
import { installConsoleBridge, parseConsoleCategory } from "./console-bridge";
import { createLogger, LogSink, parseLogLevel, setDefaultLogSink } from "./logger";

const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "bycoda-log-"));
  dirs.push(dir);
  return dir;
};
const at = new Date("2026-11-09T10:00:00.000Z");
afterEach(() => {
  setDefaultLogSink(undefined);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const sinkIn = (dir: string, extra: Partial<ConstructorParameters<typeof LogSink>[0]> = {}) =>
  new LogSink({ dir, mirror: false, now: () => at, ...extra });

it("writes shared-format lines and filters below the minimum level", async () => {
  const dir = tempDir();
  const sink = sinkIn(dir);
  const log = createLogger("host.rpc", sink);
  log.debug("hidden");
  log.warn("slow call", { method: "git.action", ms: 2500 });
  log.child("x").info("child");
  await sink.flush();
  expect(readFileSync(sink.path, "utf8")).toBe(
    "2026-11-09T10:00:00.000Z WARN  [host.rpc] slow call method=git.action ms=2500\n" +
      "2026-11-09T10:00:00.000Z INFO  [host.rpc.x] child\n",
  );
  sink.close();
});

it("parses the log level with an info default", () => {
  expect(parseLogLevel("DEBUG")).toBe("debug");
  expect(parseLogLevel("nonsense")).toBe("info");
  expect(parseLogLevel(undefined)).toBe("info");
});

it("truncates long messages and fields", async () => {
  const dir = tempDir();
  const sink = sinkIn(dir);
  createLogger("host", sink).info("m".repeat(20_000), { f: "v".repeat(5_000) });
  sink.flushSync();
  const line = readFileSync(sink.path, "utf8");
  expect(line.length).toBeLessThan(11_000);
  sink.close();
});

it("rotates through host.1.log to host.3.log and drops the oldest", async () => {
  const dir = tempDir();
  const sink = sinkIn(dir, { maxBytes: 200, keep: 3 });
  const log = createLogger("host", sink);
  for (let i = 0; i < 6; i++) {
    log.info(`batch-${i} ${"x".repeat(150)}`);
    await sink.flush();
  }
  expect(existsSync(join(dir, "host.3.log"))).toBe(true);
  expect(existsSync(join(dir, "host.4.log"))).toBe(false);
  expect(readFileSync(sink.path, "utf8")).toContain("batch-5");
  expect(readFileSync(join(dir, "host.1.log"), "utf8")).toContain("batch-4");
  expect(readFileSync(join(dir, "host.3.log"), "utf8")).toContain("batch-2");
  sink.close();
});

it("bounds the queue, drops the oldest and reports the count", async () => {
  const dir = tempDir();
  const sink = sinkIn(dir, { maxQueuedLines: 3 });
  const log = createLogger("host", sink);
  for (let i = 0; i < 5; i++) log.info(`line-${i}`);
  await sink.flush();
  const text = readFileSync(sink.path, "utf8");
  expect(text).toContain("dropped 2 lines");
  expect(text).not.toContain("line-1");
  expect(text).toContain("line-4");
  sink.close();
});

it("derives console categories from [tag] and tag: prefixes", () => {
  expect(parseConsoleCategory(["[Git Watch] hi"]).category).toBe("host");
  expect(parseConsoleCategory(["[push] sent", 1])).toEqual({
    category: "host.push",
    args: ["sent", 1],
  });
  expect(parseConsoleCategory(["Social: failed"]).category).toBe("host.social");
  expect(parseConsoleCategory(["Error: boom"]).category).toBe("host");
  expect(parseConsoleCategory([new Error("x")]).category).toBe("host");
});

it("bridges console calls into the logger with util.format", () => {
  const dir = tempDir();
  const sink = sinkIn(dir);
  setDefaultLogSink(sink);
  const restore = installConsoleBridge();
  try {
    console.log("[push] sent %d", 3);
    console.warn("plain");
    console.debug("hidden");
  } finally {
    restore();
  }
  sink.flushSync();
  expect(readFileSync(sink.path, "utf8")).toBe(
    "2026-11-09T10:00:00.000Z INFO  [host.push] sent 3\n2026-11-09T10:00:00.000Z WARN  [host] plain\n",
  );
  sink.close();
});

it("writes the crash marker and terminates with exit code 1", () => {
  const dir = tempDir();
  const sink = sinkIn(dir);
  setDefaultLogSink(sink);
  const exit = vi.fn();
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const error = new Error("boom");
  createFatalHandler({ logDir: dir, appVersion: "9.9.9", exit })(error);
  stderr.mockRestore();
  const marker = JSON.parse(readFileSync(crashMarkerPath(dir), "utf8"));
  expect(Object.keys(marker).sort()).toEqual(
    ["appVersion", "backtrace", "location", "message", "occurredAt", "thread"].sort(),
  );
  expect(marker).toMatchObject({
    message: "boom",
    location: null,
    thread: "host",
    appVersion: "9.9.9",
  });
  expect(marker.backtrace).toContain("boom");
  expect(new Date(marker.occurredAt).toISOString()).toBe(marker.occurredAt);
  expect(readFileSync(sink.path, "utf8")).toContain("FATAL [host.crash]");
  expect(exit).toHaveBeenCalledWith(1);
  sink.close();
});

it("bounds the crash marker fields", () => {
  const marker = buildCrashMarker(new Error("e".repeat(5_000)), "1.0.0");
  expect(marker.message.length).toBeLessThanOrEqual(2_000);
  expect(marker.backtrace.length).toBeLessThanOrEqual(20_000);
});
