import { lstat, opendir } from "node:fs/promises";
import type { Dir } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { NativeBufferDirectory, NativeBufferDirectoryEntry } from "./native-buffer-catalog";
import type { NativeBufferPersistence } from "./ports/native-buffer-persistence";

const PAGE_SIZE = 32;
const component = /^[A-Za-z0-9._-]+$/;
const invalid = () =>
  new Error("Native buffer directory metadata is invalid or outside retained storage");

function cursorRowid(value: string): number {
  if (typeof value !== "string" || value.length > 32 || !/^directory-rowid:[1-9]\d*$/.test(value))
    throw invalid();
  const rowid = Number(value.slice("directory-rowid:".length));
  if (!Number.isSafeInteger(rowid) || rowid < 1 || value !== `directory-rowid:${rowid}`)
    throw invalid();
  return rowid;
}

function entry(name: string, isDirectory: boolean, ignored?: true): NativeBufferDirectoryEntry {
  return {
    name,
    ...(ignored ? { ignored } : {}),
    isFile: () => !ignored && !isDirectory,
    isDirectory: () => !ignored && isDirectory,
  };
}

/** SQL metadata takes precedence; filesystem-only legacy entries stay visible.
 * Each read performs at most one legacy scan/membership query. No seen-name set
 * grows with the archive, and neither backend's artifact body is read here. */
export function createNativeBufferDirectories(deps: {
  root: string;
  persistence: NativeBufferPersistence;
}) {
  const root = resolve(deps.root);
  function key(path: string): string {
    if (!isAbsolute(path) || path.includes("\0")) throw invalid();
    const value = relative(root, resolve(path)).split(sep).join("/");
    if (
      value.length > 1024 ||
      value
        .split("/")
        .some((part) => !part || part === "." || part === ".." || !component.test(part)) ||
      !(
        value === "native-activity/buffers" ||
        value.startsWith("native-activity/buffers/") ||
        value === "native-activity/buffer-history" ||
        value.startsWith("native-activity/buffer-history/")
      ) ||
      value === "native-activity/buffer-history/clocks" ||
      value.startsWith("native-activity/buffer-history/clocks/")
    )
      throw invalid();
    return value;
  }
  async function legacy(directoryKey: string): Promise<Dir | null> {
    let path = root;
    try {
      // The configured root is trusted. No child namespace component may turn
      // into an alias for another directory, including Windows junctions.
      for (const part of directoryKey.split("/")) {
        path = join(path, part);
        const stat = await lstat(path);
        if (stat.isSymbolicLink() || !stat.isDirectory()) return null;
      }
      return await opendir(path, { bufferSize: 16 });
    } catch (error) {
      if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return null;
      throw error;
    }
  }
  async function open(path: string): Promise<NativeBufferDirectory | null> {
    const directoryKey = key(path);
    // Freeze name membership for both backends. A legacy artifact imported
    // after SQL iteration must not then be hidden from this cursor's FS phase.
    const view = await deps.persistence.directoryView();
    if (!Number.isSafeInteger(view) || view < 0) throw invalid();
    let after: string | null = null;
    let buffered: { name: string; isDirectory: boolean }[] = [];
    let offset = 0;
    let sqlDone = false;
    let closed = false;
    let busy = false;
    let filesystem: Dir | null = null;
    async function page() {
      const value = await deps.persistence.entries(directoryKey, after, PAGE_SIZE, view);
      if (!value || !Array.isArray(value.entries) || value.entries.length > PAGE_SIZE)
        throw invalid();
      const names = new Set<string>();
      for (const item of value.entries) {
        if (
          !item ||
          typeof item.name !== "string" ||
          !component.test(item.name) ||
          item.name === "." ||
          item.name === ".." ||
          item.name.length > 1024 ||
          typeof item.isDirectory !== "boolean" ||
          names.has(item.name)
        )
          throw invalid();
        names.add(item.name);
      }
      if (value.entries.length > 0 && view === 0) throw invalid();
      if (value.nextAfter !== null) {
        const next = cursorRowid(value.nextAfter);
        if (
          value.entries.length === 0 ||
          next <= (after === null ? 0 : cursorRowid(after)) ||
          next > view
        )
          throw invalid();
      }
      buffered = value.entries;
      offset = 0;
      after = value.nextAfter;
      sqlDone = after === null;
    }
    await page();
    filesystem = await legacy(directoryKey);
    if (buffered.length === 0 && !filesystem) return null;
    async function finish() {
      if (closed) return;
      closed = true;
      buffered = [];
      const accepted = filesystem;
      filesystem = null;
      await accepted?.close();
    }
    return {
      async read() {
        if (closed) return null;
        if (busy) throw new Error("Native buffer directory already has an accepted read");
        busy = true;
        try {
          if (offset < buffered.length) {
            const value = buffered[offset++];
            return entry(value.name, value.isDirectory);
          }
          if (!sqlDone) {
            await page();
            if (offset < buffered.length) {
              const value = buffered[offset++];
              return entry(value.name, value.isDirectory);
            }
          }
          const value = await filesystem?.read();
          if (!value) {
            await finish();
            return null;
          }
          // An ignored entry still consumes one read so catalog scan/deadline
          // budgets also bound long runs of duplicate filesystem names.
          if (
            !(directoryKey === "native-activity/buffer-history" && value.name === "clocks") &&
            component.test(value.name) &&
            value.name !== "." &&
            value.name !== ".." &&
            value.name.length <= 1024 &&
            (await deps.persistence.hasEntry(directoryKey, value.name, view))
          )
            return entry(value.name, false, true);
          return value;
        } catch (error) {
          await finish().catch(() => {});
          throw error;
        } finally {
          busy = false;
        }
      },
      async close() {
        if (busy) throw new Error("Native buffer directory still has an accepted read");
        await finish();
      },
    };
  }
  return {
    open,
    /** Compatibility helper for existing non-cursor scans, which already own
     * their full result list. Catalog callers must use open() instead. */
    async names(path: string): Promise<string[]> {
      const reader = await open(path);
      if (!reader) return [];
      const names: string[] = [];
      try {
        for (let value = await reader.read(); value; value = await reader.read()) {
          if (!value.ignored) names.push(value.name);
        }
      } finally {
        await reader.close();
      }
      return names.sort();
    },
  };
}
