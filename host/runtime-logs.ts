import { randomUUID } from "node:crypto";
import type {
  RuntimeLogEntry,
  RuntimeLogQuery,
  RuntimeLogSnapshot,
  RuntimeLogSource,
} from "../src/features/host-tools/runtimeLogTypes";

const MAX_TEXT = 8192;

/** Redact before retention, export or agent access. This is a best-effort scrubber,
 * not a reason to log credentials; arbitrary application secrets cannot be inferred. */
export function scrubRuntimeLogText(input: string, maxLength = MAX_TEXT) {
  const text = input
    .replace(
      /(["'])(authorization|proxy-authorization|cookie|set-cookie|credentials)\1\s*:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/gi,
      (_match, quote, key) => `${quote}${key}${quote}: "[REDACTED]"`,
    )
    .replace(
      /-----BEGIN [^-]*(?:PRIVATE KEY|CERTIFICATE)-----[\s\S]*?(?:-----END [^-]+-----|$)/g,
      "[REDACTED]",
    )
    .replace(/(\b(?:Bearer|Basic)\s+)[A-Za-z0-9+/_=.-]+/gi, "$1[REDACTED]")
    .replace(
      /\b(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key)\s*:\s*[^\r\n]+/gi,
      (match) => `${match.split(":", 1)[0]}: [REDACTED]`,
    )
    .replace(
      /((?:[?&]|["']?\b)(?:password|passwd|secret|client[_-]?secret|(?:access|refresh|id)[_-]?token|token|api[_-]?key)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;&}\]\r\n]+)/gi,
      "$1[REDACTED]",
    )
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]{16,}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,})\b/g,
      "[REDACTED]",
    )
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[REDACTED]@");
  return text.length > maxLength ? `${text.slice(0, maxLength)}… [truncated]` : text;
}

/** One instance per ordered output stream; never reset this state at packet gaps. */
export class RuntimeLogLineRedactor {
  private pem = false;
  private overflowTail = "";

  observeOverflow(text: string, retainedPrefix = "") {
    const raw = (this.overflowTail || retainedPrefix.slice(-128)) + text;
    if (/-----BEGIN [^-]*(?:PRIVATE KEY|CERTIFICATE)-----/.test(raw)) this.pem = true;
    this.overflowTail = raw.slice(-128);
  }

  interrupt(partialLine: string) {
    // A lost packet can complete a PEM opener. Stay closed until an END marker.
    if (partialLine.includes("-----")) this.pem = true;
  }

  redact(line: string) {
    this.overflowTail = "";
    if (!line) return "";
    const begin = /-----BEGIN [^-]*(?:PRIVATE KEY|CERTIFICATE)-----/.exec(line);
    if (!this.pem && !begin) return line;
    this.pem = true;
    const end = /-----END [^-]*(?:PRIVATE KEY|CERTIFICATE)-----/.exec(line);
    if (end && (!begin || end.index > begin.index)) {
      this.pem = false;
      return `${begin ? line.slice(0, begin.index) : ""}[REDACTED]${line.slice(end.index + end[0].length)}`;
    }
    return `${begin ? line.slice(0, begin.index) : ""}[REDACTED]`;
  }
}

/** Self-contained: also executed in Chromium before values cross the protocol.
 * Unknown objects use fixed descriptor probes, never enumerate arbitrary keys.
 * Custom fields can be logged as explicit [field, value] arrays instead. */
export function runtimeLogPreview(input: unknown): unknown {
  let budget = 8192;
  const fields = [
    "name",
    "message",
    "code",
    "status",
    "statusCode",
    "type",
    "event",
    "route",
    "method",
    "url",
    "path",
    "file",
    "line",
    "column",
    "reason",
    "cause",
    "error",
    "details",
    "data",
    "stream",
    "streamId",
    "captureGap",
    "expectedSequence",
    "receivedSequence",
    "interrupted",
    "sequence",
    "source",
    "level",
    "timestamp",
    "duration",
    "count",
    "exitCode",
    "signal",
    "authorization",
    "cookie",
    "credentials",
    "password",
    "secret",
    "token",
    "apiKey",
    "accessToken",
    "refreshToken",
  ];
  const secret =
    /^(?:authorization|proxy-authorization|cookie|set-cookie|password|passwd|secret|client[_-]?secret|(?:access|refresh|id)[_-]?token|token|api[_-]?key|x-api-key|credentials)$/i;
  const seen = new WeakSet<object>();
  const visit = (value: unknown, depth: number): unknown => {
    if (budget <= 0) return "[truncated]";
    budget -= 16;
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
    if (typeof value === "string") {
      const result = value.slice(0, Math.max(0, Math.min(2048, budget)));
      budget -= result.length;
      return result;
    }
    if (typeof value === "bigint") return `${value}n`;
    if (value === undefined) return "[undefined]";
    if (typeof value !== "object") return `[${typeof value}]`;
    if (seen.has(value)) return "[circular]";
    if (depth >= 4) return "[max depth]";
    seen.add(value);
    try {
      if (Array.isArray(value)) {
        const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
        const out: unknown[] = [];
        const label = Object.getOwnPropertyDescriptor(value, "0");
        const secretPair =
          length === 2 &&
          label &&
          "value" in label &&
          typeof label.value === "string" &&
          secret.test(label.value);
        for (let i = 0; i < Math.min(30, length); i++) {
          if (budget <= 0) {
            out.push("[truncated]");
            break;
          }
          budget -= 16;
          const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
          out.push(
            secretPair && i === 1
              ? "[REDACTED]"
              : !descriptor
                ? "[empty]"
                : "value" in descriptor
                  ? visit(descriptor.value, depth + 1)
                  : "[getter]",
          );
        }
        if (length > 30) out.push("[more entries omitted]");
        return out;
      }
      const result: Record<string, unknown> = {
        $capture:
          "Fixed diagnostic fields only; other properties omitted. Use [field, value] arrays for custom fields.",
      };
      budget -= 128;
      let count = 0;
      for (const key of fields) {
        if (budget <= 0 || count >= 30) break;
        let descriptor = Object.getOwnPropertyDescriptor(value, key);
        // Native errors usually inherit their name. Inspect a small prototype
        // prefix without invoking name/stack getters or enumerating prototypes.
        if (!descriptor && key === "name") {
          let prototype = Object.getPrototypeOf(value);
          for (let i = 0; prototype && i < 3 && !descriptor; i++) {
            descriptor = Object.getOwnPropertyDescriptor(prototype, key);
            prototype = Object.getPrototypeOf(prototype);
          }
        }
        if (!descriptor) continue;
        count++;
        budget -= key.length;
        result[key] = secret.test(key)
          ? "[REDACTED]"
          : "value" in descriptor
            ? visit(descriptor.value, depth + 1)
            : "[getter]";
      }
      return result;
    } catch {
      return "[unavailable]";
    }
  };
  return visit(input, 0);
}

/** Redact the bounded owned preview, never enumerate the original input. */
export function runtimeLogDetails(input: unknown): unknown {
  const redact = (value: unknown): unknown => {
    if (typeof value === "string") return scrubRuntimeLogText(value);
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === "object")
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item)]));
    return value;
  };
  return redact(runtimeLogPreview(input));
}

export type RuntimeLogsOptions = { maxEntries?: number; maxSources?: number; maxBytes?: number };

type StoredEntry = { entry: RuntimeLogEntry; bytes: number };

/** Host-local, ephemeral store shared by server and browser capture. No disk history. */
export class RuntimeLogsService {
  private readonly streamId = randomUUID();
  private entries: StoredEntry[] = [];
  private readonly registered = new Map<string, RuntimeLogSource>();
  private cursor = 0;
  private dropped = 0;
  private bytes = 0;
  private readonly maxEntries: number;
  private readonly maxSources: number;
  private readonly maxBytes: number;

  constructor(options: RuntimeLogsOptions = {}) {
    this.maxEntries = Math.max(1, Math.min(10_000, options.maxEntries ?? 2000));
    this.maxSources = Math.max(1, Math.min(1024, options.maxSources ?? 128));
    this.maxBytes = Math.max(1024, Math.min(32 * 1024 * 1024, options.maxBytes ?? 4 * 1024 * 1024));
  }

  setSource(source: RuntimeLogSource) {
    const id = source.id.slice(0, 256);
    const safe: RuntimeLogSource = {
      id,
      kind: source.kind,
      label: scrubRuntimeLogText(source.label, 512),
      available: source.available,
      ...(source.projectId ? { projectId: source.projectId.slice(0, 256) } : {}),
      ...(source.sessionId ? { sessionId: source.sessionId.slice(0, 256) } : {}),
      ...(source.url ? { url: scrubRuntimeLogText(source.url, 2048) } : {}),
      ...(source.reason ? { reason: scrubRuntimeLogText(source.reason, 512) } : {}),
    };
    this.registered.delete(id);
    this.registered.set(id, safe);
    while (this.registered.size > this.maxSources) {
      const oldest =
        [...this.registered.values()].find((item) => !item.available) ??
        this.registered.values().next().value!;
      this.registered.delete(oldest.id);
      this.remove((entry) => entry.sourceId === oldest.id, true);
    }
    return { ...safe };
  }

  add(
    source: RuntimeLogSource,
    input: Omit<RuntimeLogEntry, "id" | "cursor" | "sourceId" | "source">,
  ) {
    const safeSource = this.setSource(source);
    const cursor = ++this.cursor;
    const entry: RuntimeLogEntry = {
      id: `log:${this.streamId}:${cursor}`,
      cursor,
      timestamp: Number.isFinite(input.timestamp) ? input.timestamp : Date.now(),
      sourceId: safeSource.id,
      source: safeSource.kind,
      level: input.level,
      message: scrubRuntimeLogText(input.message),
      ...(input.details !== undefined ? { details: runtimeLogDetails(input.details) } : {}),
      ...(input.stack ? { stack: scrubRuntimeLogText(input.stack) } : {}),
      ...(input.location
        ? {
            location: {
              file: scrubRuntimeLogText(input.location.file, 2048),
              ...(input.location.line !== undefined ? { line: input.location.line } : {}),
              ...(input.location.column !== undefined ? { column: input.location.column } : {}),
            },
          }
        : {}),
      // The capture source is the authority. Input cannot retag a host-wide event.
      ...(safeSource.projectId ? { projectId: safeSource.projectId } : {}),
      ...(safeSource.sessionId ? { sessionId: safeSource.sessionId } : {}),
    };
    const bytes = Buffer.byteLength(JSON.stringify(entry), "utf8");
    this.entries.push({ entry, bytes });
    this.bytes += bytes;
    while (this.entries.length > this.maxEntries || this.bytes > this.maxBytes) {
      const removed = this.entries.shift()!;
      this.bytes -= removed.bytes;
      this.dropped++;
    }
    return structuredClone(entry);
  }

  sources(query: RuntimeLogQuery = {}): RuntimeLogSource[] {
    return [...this.registered.values()]
      .filter(
        (source) =>
          this.matchesScope(source, query) &&
          (!query.source || source.kind === query.source) &&
          (!query.sourceId || source.id === query.sourceId),
      )
      .map((source) => ({ ...source }));
  }

  read(query: RuntimeLogQuery = {}): RuntimeLogSnapshot {
    const limit = Math.max(
      1,
      Math.min(1000, Math.floor(Number.isFinite(query.limit) ? query.limit! : 200)),
    );
    const after =
      query.streamId && query.streamId !== this.streamId
        ? undefined
        : Number.isFinite(query.after)
          ? Math.max(0, query.after!)
          : undefined;
    const matching = this.entries.filter(
      ({ entry }) => (after === undefined || entry.cursor > after) && this.matches(entry, query),
    );
    const selected = after === undefined ? matching.slice(-limit) : matching.slice(0, limit);
    return {
      streamId: this.streamId,
      entries: selected.map(({ entry }) => structuredClone(entry)),
      sources: this.sources(query),
      // Incremental pagination must not skip matching entries when a poll hits its limit.
      cursor:
        after !== undefined && matching.length > limit
          ? selected.at(-1)!.entry.cursor
          : this.cursor,
      dropped: this.dropped,
    };
  }

  clear(query: RuntimeLogQuery = {}) {
    this.remove((entry) => this.matches(entry, query), false);
    return this.read(query);
  }

  private matchesScope(
    item: { projectId?: string; sessionId?: string; kind?: string; source?: string },
    query: RuntimeLogQuery,
  ) {
    return (
      (!query.projectId || item.projectId === query.projectId) &&
      (!query.sessionId ||
        item.sessionId === query.sessionId ||
        (!item.sessionId && (item.kind ?? item.source) === "server"))
    );
  }

  private matches(entry: RuntimeLogEntry, query: RuntimeLogQuery) {
    return (
      this.matchesScope(entry, query) &&
      (!query.sourceId || entry.sourceId === query.sourceId) &&
      (!query.source || entry.source === query.source) &&
      (!query.levels?.length || query.levels.includes(entry.level)) &&
      (!query.search ||
        `${entry.message}\n${entry.stack ?? ""}\n${JSON.stringify(entry.details) ?? ""}`
          .toLowerCase()
          .includes(query.search.toLowerCase().slice(0, 512)))
    );
  }

  private remove(predicate: (entry: RuntimeLogEntry) => boolean, dropped: boolean) {
    this.entries = this.entries.filter((stored) => {
      if (!predicate(stored.entry)) return true;
      this.bytes -= stored.bytes;
      if (dropped) this.dropped++;
      return false;
    });
  }
}
