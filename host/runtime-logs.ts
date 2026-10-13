import type {
  RuntimeLogEntry,
  RuntimeLogQuery,
  RuntimeLogSnapshot,
  RuntimeLogSource,
} from "../src/features/host-tools/runtimeLogTypes";

const MAX_TEXT = 8192;
const SECRET_KEY =
  /^(?:authorization|proxy-authorization|cookie|set-cookie|password|passwd|secret|client[_-]?secret|(?:access|refresh|id)[_-]?token|token|api[_-]?key|x-api-key|credentials)$/i;

/** Redact before retention, export or agent access. This is a best-effort scrubber,
 * not a reason to log credentials; arbitrary application secrets cannot be inferred. */
export function scrubRuntimeLogText(input: string, maxLength = MAX_TEXT) {
  const text = input
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

/** Produce only small JSON values, even for cycles, errors and hostile getters. */
export function runtimeLogDetails(input: unknown): unknown {
  let budget = MAX_TEXT;
  const seen = new WeakSet<object>();
  const visit = (value: unknown, depth: number): unknown => {
    if (budget <= 0) return "[truncated]";
    budget -= 16;
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
    if (typeof value === "string") {
      const result = scrubRuntimeLogText(value, Math.max(0, Math.min(2048, budget)));
      budget -= result.length;
      return result;
    }
    if (typeof value === "bigint") return `${value}n`;
    if (value === undefined) return "[undefined]";
    if (typeof value !== "object") return `[${typeof value}]`;
    if (seen.has(value)) return "[circular]";
    if (depth >= 4) return "[max depth]";
    seen.add(value);
    if (value instanceof Error)
      return visit({ name: value.name, message: value.message, stack: value.stack }, depth + 1);
    if (Array.isArray(value)) return value.slice(0, 30).map((item) => visit(item, depth + 1));
    const result: Record<string, unknown> = {};
    let properties: ReturnType<typeof Object.getOwnPropertyDescriptors>;
    try {
      properties = Object.getOwnPropertyDescriptors(value);
    } catch {
      return "[unavailable]";
    }
    for (const [key, descriptor] of Object.entries(properties).slice(0, 30)) {
      if (budget <= 0) break;
      const safeKey = scrubRuntimeLogText(key, 128);
      budget -= safeKey.length;
      Object.defineProperty(result, safeKey, {
        value: SECRET_KEY.test(key)
          ? "[REDACTED]"
          : "value" in descriptor
            ? visit(descriptor.value, depth + 1)
            : "[getter]",
        enumerable: true,
      });
    }
    return result;
  };
  return visit(input, 0);
}

export type RuntimeLogsOptions = { maxEntries?: number; maxSources?: number; maxBytes?: number };

type StoredEntry = { entry: RuntimeLogEntry; bytes: number };

/** Host-local, ephemeral store shared by server and browser capture. No disk history. */
export class RuntimeLogsService {
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
      id: `log:${cursor}`,
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
    const after = Number.isFinite(query.after) ? Math.max(0, query.after!) : undefined;
    const matching = this.entries.filter(
      ({ entry }) => (after === undefined || entry.cursor > after) && this.matches(entry, query),
    );
    const selected = after === undefined ? matching.slice(-limit) : matching.slice(0, limit);
    return {
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
