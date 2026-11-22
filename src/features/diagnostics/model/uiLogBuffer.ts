import {
  formatDiagnosticLine,
  type DiagnosticLogFields,
  type DiagnosticLogLevel,
} from "@bycoda/account-contracts";
import { truncateGraphemes } from "../../../shared/lib/text/truncate";

export const UI_LOG_MAX_LINES = 1000;
export const UI_LOG_MAX_CHARS = 200_000;
const MESSAGE_MAX_GRAPHEMES = 2000;

type Entry = { key: string; level: DiagnosticLogLevel; text: string; count: number; size: number };

const render = (entry: Entry) =>
  entry.count > 1 ? `${entry.text} (repeated ${entry.count} times)` : entry.text;

/** Warnings and errors are what a crash report needs; routine breadcrumbs go first. */
const isProtected = (level: DiagnosticLogLevel) => level === "warn" || level === "error";

/**
 * Bounded ring of recent UI lines in the shared diagnostic format. When the ring is full the
 * oldest routine line goes first; warnings and errors are evicted only when no routine line is left.
 * An identical consecutive line (same level, category, message and fields) is folded into the
 * previous one with a "repeated N times" suffix instead of taking a new slot.
 */
export function createLogBuffer(limits = { lines: UI_LOG_MAX_LINES, chars: UI_LOG_MAX_CHARS }) {
  const entries: Entry[] = [];
  let chars = 0;
  const measure = (entry: Entry) => {
    const next = render(entry).length + 1;
    chars += next - entry.size;
    entry.size = next;
  };
  const evictOne = () => {
    const routine = entries.findIndex((entry) => !isProtected(entry.level));
    const [removed] = entries.splice(routine === -1 ? 0 : routine, 1);
    chars -= (removed as Entry).size;
  };
  return {
    push(
      level: DiagnosticLogLevel,
      category: string,
      message: string,
      fields: DiagnosticLogFields = {},
      now: () => Date = () => new Date(),
    ): void {
      const body = truncateGraphemes(message, MESSAGE_MAX_GRAPHEMES);
      const key = formatDiagnosticLine(new Date(0), level, category, body, fields);
      const last = entries[entries.length - 1];
      if (last && last.key === key) {
        last.count += 1;
        measure(last);
        return;
      }
      const entry: Entry = {
        key,
        level,
        text: formatDiagnosticLine(now(), level, category, body, fields),
        count: 1,
        size: 0,
      };
      measure(entry);
      entries.push(entry);
      while (entries.length > limits.lines || (chars > limits.chars && entries.length > 1)) {
        evictOne();
      }
    },
    snapshot: (): string => entries.map(render).join("\n"),
    clear(): void {
      entries.length = 0;
      chars = 0;
    },
  };
}

const buffer = createLogBuffer();
export const uiLogSnapshot = (): string => buffer.snapshot();
export const clearUiLog = (): void => buffer.clear();

export type UiLogSink = (level: "warn" | "error", category: string, message: string) => void;
let sink: UiLogSink | undefined;

/** Also hands every warning and error to a durable sink (the native log file). */
export function setUiLogSink(next: UiLogSink | undefined): void {
  sink = next;
}

function keep(
  level: DiagnosticLogLevel,
  category: string,
  message: string,
  fields?: DiagnosticLogFields,
): void {
  buffer.push(level, category, message, fields);
  if (level !== "warn" && level !== "error") return;
  // The file line keeps the fields (method, code, ms…): without them a failure in bycoda.log
  // cannot be attributed. Fields are already limited to safe values; the sink still redacts.
  const detail = Object.entries(fields ?? {})
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
  sink?.(level, category, detail ? `${message} ${detail}` : message);
}

/** Adds one line to the UI log; never throws. Used by the console hook and the breadcrumbs. */
export function recordUiLog(
  level: DiagnosticLogLevel,
  category: string,
  message: string,
  fields?: DiagnosticLogFields,
): void {
  try {
    keep(level, category, message, fields);
  } catch {
    // -- logging must never break the caller.
  }
}

function describe(value: unknown): string {
  if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** `file.js:12:3` from a script URL; never the directory. */
export function sourceLocation(file: string | undefined, line?: number, column?: number): string {
  const name = (file ?? "").split(/[?#]/)[0]?.split(/[\\/]/).pop() ?? "";
  if (!name) return "";
  return `${name}${line ? `:${line}` : ""}${line && column ? `:${column}` : ""}`;
}

/** The browser's harmless "layout settled over two frames" notice; not a defect worth a log line. */
export function isBenignResizeObserverError(message: string | undefined): boolean {
  return (
    message === "ResizeObserver loop completed with undelivered notifications." ||
    message === "ResizeObserver loop completed with undelivered notifications" ||
    message === "ResizeObserver loop limit exceeded"
  );
}

let installed = false;

/**
 * Wraps console.warn/error, listens for uncaught errors and unhandled rejections, and records
 * window focus and network breadcrumbs. Once per window; the console originals still run.
 */
export function installUiLogBuffer(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  let inside = false;
  const guarded = (work: () => void) => {
    if (inside) return;
    inside = true;
    try {
      work();
    } catch {
      // -- logging must never break the caller.
    } finally {
      inside = false;
    }
  };
  for (const level of ["warn", "error"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      guarded(() => keep(level, "ui.console", args.map(describe).join(" ")));
      original(...args);
    };
  }
  window.addEventListener("error", (event) =>
    guarded(() => {
      if (isBenignResizeObserverError(event.message)) return;
      const src = sourceLocation(event.filename, event.lineno, event.colno);
      const error = event.error;
      const stack = error instanceof Error && error.stack ? `\n${error.stack}` : "";
      keep(
        "error",
        "ui.error",
        `${error instanceof Error ? error.message : event.message}${stack}`,
        { kind: "uncaught", ...(src ? { src } : {}) },
      );
    }),
  );
  window.addEventListener("unhandledrejection", (event) =>
    guarded(() => keep("error", "ui.error", describe(event.reason), { kind: "rejection" })),
  );
  const state = (category: string, message: string, fields?: DiagnosticLogFields) =>
    guarded(() => buffer.push("info", category, message, fields));
  window.addEventListener("focus", () => state("ui.window", "focus"));
  window.addEventListener("blur", () => state("ui.window", "blur"));
  document.addEventListener("visibilitychange", () =>
    state("ui.window", "visibility", { state: document.visibilityState }),
  );
  window.addEventListener("online", () => state("ui.network", "online"));
  window.addEventListener("offline", () => recordUiLog("warn", "ui.network", "offline"));
}
