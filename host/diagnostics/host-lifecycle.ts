import { monitorEventLoopDelay } from "node:perf_hooks";
import { basename, join } from "node:path";
import { createLogger, LogSink, parseLogLevel, setDefaultLogSink } from "./logger";
import { installConsoleBridge } from "./console-bridge";
import { installCrashHandlers } from "./crash";

const HEALTH_INTERVAL_MS = 15 * 60_000;

export type HostDiagnostics = {
  /** Logs `stopping` once; the caller then drains and exits. */
  stopping(reason: string): void;
};

/** Starts structured logging for a serving Host: file sink, console bridge, crash capture, lifecycle and health lines. */
export function startHostDiagnostics(options: {
  dataDir: string;
  version: string;
}): HostDiagnostics {
  const level = parseLogLevel(process.env.BYCODA_HOST_LOG_LEVEL);
  const logDir = join(options.dataDir, "logs");
  const sink = new LogSink({ dir: logDir, minLevel: level });
  setDefaultLogSink(sink);
  installConsoleBridge();
  installCrashHandlers({ logDir, appVersion: options.version });
  process.on("exit", () => sink.flushSync());

  const startedAt = Date.now();
  const lifecycle = createLogger("host.lifecycle");
  lifecycle.info("started", {
    version: options.version,
    pid: process.pid,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    dataDir: basename(options.dataDir),
    logLevel: level,
  });

  const loop = monitorEventLoopDelay({ resolution: 20 });
  loop.enable();
  const health = createLogger("host.health");
  const timer = setInterval(() => {
    const memory = process.memoryUsage();
    health.info("sample", {
      rssMb: Math.round(memory.rss / 1_048_576),
      heapUsedMb: Math.round(memory.heapUsed / 1_048_576),
      loopLagP99Ms: Math.round(loop.percentile(99) / 1e6),
      handles: process.getActiveResourcesInfo?.().length,
    });
    loop.reset();
  }, HEALTH_INTERVAL_MS);
  timer.unref();

  let stopped = false;
  return {
    stopping(reason) {
      if (stopped) return;
      stopped = true;
      lifecycle.info("stopping", {
        reason,
        uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      });
      sink.flushSync();
    },
  };
}
