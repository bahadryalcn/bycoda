import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { truncateGraphemes } from "../../src/shared/lib/text/truncate";
import { createLogger, getDefaultLogSink, type Logger } from "./logger";

/** Same shape the desktop crash marker uses, so one uploader reads both. */
export type CrashMarker = {
  message: string;
  location: null;
  thread: "host";
  backtrace: string;
  occurredAt: string;
  appVersion: string;
};

export function crashMarkerPath(logDir: string): string {
  return join(logDir, "last-crash.json");
}

export function buildCrashMarker(error: unknown, appVersion: string, at = new Date()): CrashMarker {
  const stack =
    error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : String(error);
  return {
    message: truncateGraphemes(error instanceof Error ? error.message : String(error), 2_000),
    location: null,
    thread: "host",
    backtrace: truncateGraphemes(stack, 20_000),
    occurredAt: at.toISOString(),
    appVersion,
  };
}

/** Synchronous temp+rename write: the fatal path cannot await. */
export function writeCrashMarkerSync(logDir: string, marker: CrashMarker): void {
  const target = crashMarkerPath(logDir);
  const temp = join(logDir, `.last-crash-${randomBytes(4).toString("hex")}.tmp`);
  try {
    mkdirSync(logDir, { recursive: true, mode: 0o700 });
    const fd = openSync(temp, "w", 0o600);
    try {
      writeSync(fd, JSON.stringify(marker));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, target);
  } catch {
    try {
      unlinkSync(temp);
    } catch {
      // Nothing to clean.
    }
  }
}

export type CrashHandlerOptions = {
  logDir: string;
  appVersion: string;
  logger?: Logger;
  /** Defaults to `process.exit`; tests inject a recorder. */
  exit?: (code: number) => void;
};

/** Logs the crash, persists the marker and terminates like Node's default (exit code 1). */
export function createFatalHandler(options: CrashHandlerOptions) {
  const logger = options.logger ?? createLogger("host.crash");
  return (error: unknown): void => {
    const marker = buildCrashMarker(error, options.appVersion);
    logger.fatal(`uncaught exception: ${marker.backtrace}`);
    getDefaultLogSink()?.flushSync();
    writeCrashMarkerSync(options.logDir, marker);
    try {
      // Node's default handler prints the stack to stderr, which is the legacy host.log.
      process.stderr.write(`${marker.backtrace}\n`);
    } catch {
      // stderr may be closed.
    }
    (options.exit ?? process.exit)(1);
  };
}

export function installCrashHandlers(options: CrashHandlerOptions): () => void {
  const handler = createFatalHandler(options);
  process.on("uncaughtException", handler);
  return () => {
    process.off("uncaughtException", handler);
  };
}
