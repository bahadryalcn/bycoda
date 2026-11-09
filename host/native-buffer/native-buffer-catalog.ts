import { randomUUID } from "node:crypto";
import { opendir } from "node:fs/promises";
import { join } from "node:path";

export interface NativeBufferDirectoryEntry {
  name: string;
  /** A bounded metadata scan that produces no catalog entry (for example a duplicate). */
  ignored?: true;
  isFile(): boolean;
  isDirectory(): boolean;
}
/** Read-only directory cursor; implementations must not eagerly load all names. */
export interface NativeBufferDirectory {
  read(): Promise<NativeBufferDirectoryEntry | null>;
  close(): Promise<void>;
}

export type NativeBufferRecoveryCursor = { version: 1; cursorId: string; page: number };
type Page<Row> = {
  version: 1;
  qualified: false;
  records: Row[];
  next: NativeBufferRecoveryCursor | null;
  incomplete: boolean;
  duplicatesPossible: boolean;
};
type Entry =
  | { kind: "active"; reportId: string }
  | { kind: "history"; reportId: string; name: string };
type Loaded<Row> =
  | { bytes: number; records: Row[] }
  | { bytes: number; length: number; at(index: number): Row };
type Context<Row> = {
  id: string;
  device: string;
  page: number;
  deadline: number;
  busy: boolean;
  phase: "active" | "history" | "done";
  active: NativeBufferDirectory | null;
  roots: NativeBufferDirectory | null;
  leaf: NativeBufferDirectory | null;
  leafId: string | null;
  pending: Entry | null;
  reader: { length: number; at(index: number): Row } | null;
  readerKind: Entry["kind"] | null;
  offset: number;
  incomplete: boolean;
  duplicatesPossible: boolean;
  currentKeys: Set<string>;
  currentKeyBytes: number;
  cached?: { page: number; limit: number; value: Page<Row> };
  timer?: ReturnType<typeof setTimeout>;
  expired?: boolean;
};
const MAX_CONTEXTS = 4;
const MAX_ENTRIES = 32;
const MAX_BYTES = 128 * 1024 * 1024;
const MAX_ROW_BYTES = 64 * 1024;
const MAX_KEYS_BYTES = 8 * 1024 * 1024;
const DEADLINE_MS = 60_000;
const hex = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const cursorError = () =>
  new Error("Native buffer recovery cursor expired or changed; refresh the catalog");
async function directory(path: string) {
  try {
    return await opendir(path, { bufferSize: 16 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
async function close<Row>(context: Context<Row>) {
  await Promise.all(
    [context.active, context.roots, context.leaf].map(async (dir) => {
      if (dir) await dir.close().catch(() => {});
    }),
  );
  context.active = null;
  context.roots = null;
  context.leaf = null;
  context.leafId = null;
  context.reader = null;
}

/** Bounded metadata discovery. Cursors hold read-only iteration state, require
 * fresh authentication on EVERY page, and are never operation/actor grants.
 * Caller owns the shared serial/auth boundary before and after each page. */
export function createNativeBufferCatalog<Row>(deps: {
  activeDirectory: string;
  historyDirectory: string;
  openDirectory?(path: string): Promise<NativeBufferDirectory | null>;
  now?(): number;
  activeReadBound: number;
  historyReadBound: number;
  key(row: Row): string;
  active(reportId: string, device: string): Promise<Loaded<Row>>;
  history(reportId: string, name: string, device: string): Promise<Loaded<Row>>;
  finalize?(row: Row, device: string): Promise<Row>;
}) {
  const contexts = new Map<string, Context<Row>>(),
    now = deps.now ?? Date.now,
    openDirectory = deps.openDirectory ?? directory;
  async function retire(context: Context<Row>) {
    clearTimeout(context.timer);
    await close(context);
    contexts.delete(context.id);
  }
  return {
    async close() {
      for (const context of contexts.values()) {
        if (context.busy) throw new Error("Native buffer catalog still has accepted work");
        await retire(context);
      }
    },
    async page(
      input: { after?: NativeBufferRecoveryCursor | null; limit?: number },
      device: string,
    ): Promise<Page<Row>> {
      const limit = input.limit ?? 50;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
        throw new Error("Invalid native buffer recovery page");
      for (const context of contexts.values())
        if (!context.busy && now() >= context.deadline) await retire(context);
      let context: Context<Row>;
      const requestPage = input.after?.page ?? 0;
      if (input.after) {
        const cursor = input.after;
        if (
          !cursor ||
          typeof cursor !== "object" ||
          Object.keys(cursor).length !== 3 ||
          cursor.version !== 1 ||
          !uuid.test(cursor.cursorId) ||
          !Number.isSafeInteger(cursor.page) ||
          cursor.page < 0
        )
          throw cursorError();
        const found = contexts.get(cursor.cursorId);
        if (!found || found.device !== device || found.busy || now() >= found.deadline)
          throw cursorError();
        context = found;
        if (context.cached?.page === requestPage) {
          if (context.cached.limit !== limit) throw cursorError();
          return structuredClone(context.cached.value);
        }
        if (context.page !== requestPage || context.phase === "done") throw cursorError();
      } else {
        for (const candidate of contexts.values()) {
          if (contexts.size < MAX_CONTEXTS) break;
          if (!candidate.busy && candidate.phase === "done") await retire(candidate);
        }
        if (contexts.size >= MAX_CONTEXTS)
          throw new Error(
            "Native buffer recovery catalog capacity reached; finish or refresh an existing page",
          );
        context = {
          id: randomUUID(),
          device,
          page: 0,
          deadline: now() + DEADLINE_MS,
          busy: false,
          phase: "active",
          active: await openDirectory(deps.activeDirectory),
          roots: null,
          leaf: null,
          leafId: null,
          pending: null,
          reader: null,
          readerKind: null,
          offset: 0,
          incomplete: false,
          duplicatesPossible: false,
          currentKeys: new Set(),
          currentKeyBytes: 0,
        };
        contexts.set(context.id, context);
        const owned = context;
        owned.timer = setTimeout(() => {
          owned.expired = true;
          if (!owned.busy) void retire(owned);
        }, DEADLINE_MS);
        owned.timer.unref();
      }
      context.busy = true;
      const records: Row[] = [];
      let entries = 0,
        bytes = 0;
      try {
        while (
          records.length < limit &&
          entries < MAX_ENTRIES &&
          bytes < MAX_BYTES &&
          !context.expired &&
          now() < context.deadline
        ) {
          if (context.reader && context.offset < context.reader.length) {
            const row = context.reader.at(context.offset++),
              key = deps.key(row);
            if (Buffer.byteLength(JSON.stringify(row)) > MAX_ROW_BYTES)
              throw new Error("Native buffer catalog row budget exceeded");
            if (context.readerKind === "history" && context.currentKeys.has(key)) continue;
            if (context.readerKind === "active") {
              const charge = Buffer.byteLength(key);
              if (context.currentKeyBytes + charge <= MAX_KEYS_BYTES) {
                context.currentKeys.add(key);
                context.currentKeyBytes += charge;
              } else context.duplicatesPossible = true;
            }
            records.push(deps.finalize ? await deps.finalize(row, device) : row);
            continue;
          }
          context.reader = null;
          context.readerKind = null;
          context.offset = 0;
          let entry = context.pending;
          context.pending = null;
          if (!entry && context.phase === "active") {
            const name = await context.active?.read();
            entries++;
            if (!name) {
              await context.active?.close();
              context.active = null;
              context.phase = "history";
              context.roots = await openDirectory(deps.historyDirectory);
              continue;
            }
            if (name.ignored || !name.isFile() || !/^[a-f0-9]{64}\.json$/.test(name.name)) continue;
            entry = { kind: "active", reportId: name.name.slice(0, -5) };
          }
          if (!entry && context.phase === "history") {
            if (!context.leaf) {
              const root = await context.roots?.read();
              entries++;
              if (!root) {
                context.phase = "done";
                await close(context);
                break;
              }
              if (root.ignored || !root.isDirectory() || !hex.test(root.name)) continue;
              context.leafId = root.name;
              context.leaf = await openDirectory(join(deps.historyDirectory, root.name));
              continue;
            }
            const name = await context.leaf.read();
            entries++;
            if (!name) {
              await context.leaf.close();
              context.leaf = null;
              context.leafId = null;
              continue;
            }
            if (name.ignored || !name.isFile() || !/^\d{16}-[a-f0-9]{64}\.json$/.test(name.name))
              continue;
            entry = { kind: "history", reportId: context.leafId!, name: name.name };
          }
          if (!entry) {
            if (context.phase === "done") break;
            continue;
          }
          const bound = entry.kind === "active" ? deps.activeReadBound : deps.historyReadBound;
          if (bytes + bound > MAX_BYTES) {
            context.pending = entry;
            break;
          }
          try {
            const loaded =
              entry.kind === "active"
                ? await deps.active(entry.reportId, device)
                : await deps.history(entry.reportId, entry.name, device);
            const reader =
              "records" in loaded
                ? { length: loaded.records.length, at: (index: number) => loaded.records[index] }
                : loaded;
            if (
              !Number.isSafeInteger(loaded.bytes) ||
              loaded.bytes < 0 ||
              loaded.bytes > bound ||
              !Number.isSafeInteger(reader.length) ||
              reader.length < 0 ||
              reader.length > 20_000
            )
              throw new Error("Native buffer catalog metadata budget exceeded");
            bytes += loaded.bytes;
            context.reader = reader;
            context.readerKind = entry.kind;
          } catch {
            bytes += bound;
            // A bad/missing compatibility record never hides valid immutable
            // history. Discovery is explicitly incomplete; probes stay strict.
            context.incomplete = true;
          }
        }
        if (context.expired || now() >= context.deadline) {
          await retire(context);
          throw cursorError();
        }
        context.page++;
        const done =
          context.phase === "done" && (!context.reader || context.offset >= context.reader.length);
        if (done) {
          context.reader = null;
          context.readerKind = null;
          context.offset = 0;
          context.currentKeys.clear();
          context.currentKeyBytes = 0;
        }
        const value: Page<Row> = {
          version: 1,
          qualified: false,
          records,
          next: done ? null : { version: 1, cursorId: context.id, page: context.page },
          incomplete: context.incomplete,
          duplicatesPossible: context.duplicatesPossible,
        };
        context.cached = { page: requestPage, limit, value: structuredClone(value) };
        return value;
      } catch (error) {
        await retire(context);
        throw error;
      } finally {
        context.busy = false;
      }
    },
  };
}
