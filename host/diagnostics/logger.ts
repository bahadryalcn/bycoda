import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import {
  formatDiagnosticLine,
  type DiagnosticLogFields,
  type DiagnosticLogLevel,
} from "@bycoda/account-contracts";
import { truncateGraphemes } from "../../src/shared/lib/text/truncate";

/**
 * Structured Host log: `<hostDataDir>/logs/host.log` (rotated to host.1.log .. host.N.log) in
 * the shared diagnostic line format. The legacy `<hostDataDir>/host.log` is raw stdout/stderr
 * and keeps boot errors. Lines are not redacted here; redaction happens when logs are uploaded.
 */
export type Logger = {
  debug(message: string, fields?: DiagnosticLogFields): void;
  info(message: string, fields?: DiagnosticLogFields): void;
  warn(message: string, fields?: DiagnosticLogFields): void;
  error(message: string, fields?: DiagnosticLogFields): void;
  fatal(message: string, fields?: DiagnosticLogFields): void;
  child(subcategory: string): Logger;
};

export const LOG_LEVEL_ORDER: readonly DiagnosticLogLevel[] = [
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
];
const MAX_MESSAGE_CHARS = 8_000;
const MAX_FIELD_CHARS = 2_000;

export function parseLogLevel(value: string | undefined): DiagnosticLogLevel {
  const level = value?.trim().toLowerCase();
  return LOG_LEVEL_ORDER.find((candidate) => candidate === level) ?? "info";
}

export type LogSinkOptions = {
  /** Directory that holds host.log; created on first write. */
  dir: string;
  minLevel?: DiagnosticLogLevel;
  maxBytes?: number;
  /** Rotated files kept besides the active one. */
  keep?: number;
  maxQueuedLines?: number;
  flushIntervalMs?: number;
  /** Mirror lines to the terminal. Defaults to whether stdout is a TTY. */
  mirror?: boolean;
  now?: () => Date;
};

export class LogSink {
  readonly path: string;
  readonly minLevel: DiagnosticLogLevel;
  private readonly maxBytes: number;
  private readonly keep: number;
  private readonly maxQueued: number;
  private readonly mirror: boolean;
  private readonly now: () => Date;
  private queue: string[] = [];
  private dropped = 0;
  private size: number | undefined;
  private writing: Promise<void> = Promise.resolve();
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly options: LogSinkOptions) {
    this.path = join(options.dir, "host.log");
    this.minLevel = options.minLevel ?? "info";
    this.maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
    this.keep = options.keep ?? 3;
    this.maxQueued = options.maxQueuedLines ?? 5_000;
    this.mirror = options.mirror ?? Boolean(process.stdout.isTTY);
    this.now = options.now ?? (() => new Date());
    this.timer = setInterval(() => {
      this.flush().catch(() => undefined);
    }, options.flushIntervalMs ?? 1_000);
    this.timer.unref();
  }

  enabled(level: DiagnosticLogLevel): boolean {
    return LOG_LEVEL_ORDER.indexOf(level) >= LOG_LEVEL_ORDER.indexOf(this.minLevel);
  }

  write(
    level: DiagnosticLogLevel,
    category: string,
    message: string,
    fields?: DiagnosticLogFields,
  ): void {
    if (!this.enabled(level)) return;
    const safeFields =
      fields &&
      Object.fromEntries(
        Object.entries(fields).map(([key, value]) => [
          key,
          typeof value === "string" ? truncateGraphemes(value, MAX_FIELD_CHARS) : value,
        ]),
      );
    const line = formatDiagnosticLine(
      this.now(),
      level,
      category,
      truncateGraphemes(message, MAX_MESSAGE_CHARS),
      safeFields,
    );
    if (this.mirror) {
      (level === "warn" || level === "error" || level === "fatal"
        ? process.stderr
        : process.stdout
      ).write(`${line}\n`);
    }
    if (this.queue.length >= this.maxQueued) {
      this.queue.shift();
      this.dropped++;
    }
    this.queue.push(line);
  }

  private take(): string {
    const lines = this.queue;
    this.queue = [];
    if (this.dropped) {
      lines.unshift(
        formatDiagnosticLine(this.now(), "warn", "host.logger", `dropped ${this.dropped} lines`),
      );
      this.dropped = 0;
    }
    return lines.length ? `${lines.join("\n")}\n` : "";
  }

  /** Nothing holds the file open between writes, so rotation can rename it on Windows too. */
  private rotateIfNeeded(incoming: number): void {
    try {
      this.size ??= statSync(this.path).size;
    } catch {
      this.size = 0;
    }
    if (this.size === 0 || this.size + incoming <= this.maxBytes) return;
    const numbered = (n: number) => join(this.options.dir, `host.${n}.log`);
    try {
      rmSync(numbered(this.keep), { force: true });
      for (let n = this.keep - 1; n >= 1; n--) {
        try {
          renameSync(numbered(n), numbered(n + 1));
        } catch {
          // Missing link in the chain.
        }
      }
      renameSync(this.path, numbered(1));
      this.size = 0;
    } catch {
      // In use by a reader: keep appending to the current file.
    }
  }

  /** Appends queued lines asynchronously; calls are serialised. */
  flush(): Promise<void> {
    this.writing = this.writing.then(async () => {
      const text = this.take();
      if (!text) return;
      try {
        mkdirSync(this.options.dir, { recursive: true, mode: 0o700 });
        this.rotateIfNeeded(Buffer.byteLength(text));
        await appendFile(this.path, text, { mode: 0o600 });
        this.size = (this.size ?? 0) + Buffer.byteLength(text);
      } catch {
        // Logging must never take the Host down; the batch is lost.
      }
    });
    return this.writing;
  }

  /** Writes everything queued synchronously. For fatal paths and process exit. */
  flushSync(): void {
    const text = this.take();
    if (!text) return;
    try {
      mkdirSync(this.options.dir, { recursive: true, mode: 0o700 });
      this.rotateIfNeeded(Buffer.byteLength(text));
      appendFileSync(this.path, text, { mode: 0o600 });
      this.size = (this.size ?? 0) + Buffer.byteLength(text);
    } catch {
      // See flush().
    }
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.flushSync();
  }
}

let defaultSink: LogSink | undefined;

/** Installs the process-wide sink that `createLogger` writes to. */
export function setDefaultLogSink(sink: LogSink | undefined): void {
  defaultSink = sink;
}

export function getDefaultLogSink(): LogSink | undefined {
  return defaultSink;
}

/** Before a sink exists (tests, CLI helpers) warnings and above go to stderr in the same format. */
function writeUnsinked(
  level: DiagnosticLogLevel,
  category: string,
  message: string,
  fields?: DiagnosticLogFields,
): void {
  if (LOG_LEVEL_ORDER.indexOf(level) < LOG_LEVEL_ORDER.indexOf("warn")) return;
  process.stderr.write(`${formatDiagnosticLine(new Date(), level, category, message, fields)}\n`);
}

export function createLogger(category: string, sink?: LogSink): Logger {
  const emit = (level: DiagnosticLogLevel) => (message: string, fields?: DiagnosticLogFields) => {
    const target = sink ?? defaultSink;
    if (target) target.write(level, category, message, fields);
    else writeUnsinked(level, category, message, fields);
  };
  return {
    debug: emit("debug"),
    info: emit("info"),
    warn: emit("warn"),
    error: emit("error"),
    fatal: emit("fatal"),
    child: (subcategory) => createLogger(`${category}.${subcategory}`, sink),
  };
}
