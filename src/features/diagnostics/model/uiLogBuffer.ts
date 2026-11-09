import {
  formatDiagnosticLine,
  type DiagnosticLogFields,
  type DiagnosticLogLevel,
} from "@bycoda/account-contracts";
import { truncateGraphemes } from "../../../shared/lib/text/truncate";

export const UI_LOG_MAX_LINES = 1000;
export const UI_LOG_MAX_CHARS = 200_000;
const MESSAGE_MAX_GRAPHEMES = 2000;

type Entry = { key: string; text: string; count: number; size: number };

const render = (entry: Entry) =>
  entry.count > 1 ? `${entry.text} (repeated ${entry.count} times)` : entry.text;

/**
 * Bounded ring of recent UI lines in the shared diagnostic format; oldest lines go first.
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
        text: formatDiagnosticLine(now(), level, category, body, fields),
        count: 1,
        size: 0,
      };
      measure(entry);
      entries.push(entry);
      while (entries.length > limits.lines || (chars > limits.chars && entries.length > 1)) {
        chars -= (entries.shift() as Entry).size;
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

/** Adds one line to the UI log; never throws. Used by the console hook and the breadcrumbs. */
export function recordUiLog(
  level: DiagnosticLogLevel,
  category: string,
  message: string,
  fields?: DiagnosticLogFields,
): void {
  try {
    buffer.push(level, category, message, fields);
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
      guarded(() => buffer.push(level, "ui.console", args.map(describe).join(" ")));
      original(...args);
    };
  }
  window.addEventListener("error", (event) =>
    guarded(() => {
      const src = sourceLocation(event.filename, event.lineno, event.colno);
      const error = event.error;
      const stack = error instanceof Error && error.stack ? `\n${error.stack}` : "";
      buffer.push(
        "error",
        "ui.error",
        `${error instanceof Error ? error.message : event.message}${stack}`,
        { kind: "uncaught", ...(src ? { src } : {}) },
      );
    }),
  );
  window.addEventListener("unhandledrejection", (event) =>
    guarded(() => buffer.push("error", "ui.error", describe(event.reason), { kind: "rejection" })),
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
