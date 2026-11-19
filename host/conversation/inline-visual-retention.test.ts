import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import {
  INLINE_VISUAL_RECLAIM_GRACE_MS,
  inlineVisualIds,
  reclaimDeletedInlineVisuals,
  retireDeletedSessionVisuals,
} from "./inline-visual-retention";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

const id = (text: string) => createHash("sha256").update(text).digest("hex");
const ref = (text: string) => ({ inlineVisual: { version: 2, id: id(text), title: "t", height: 200 } });

/** Writes a visual file and backdates it past the grace window unless `fresh`. */
function store(files: string[], fresh = false) {
  const dataDir = mkdtempSync(join(tmpdir(), "bycoda-visual-retention-"));
  roots.push(dataDir);
  mkdirSync(join(dataDir, "inline-visuals"));
  const now = Date.now();
  for (const text of files) {
    const path = join(dataDir, "inline-visuals", `${id(text)}.json`);
    writeFileSync(path, JSON.stringify({ version: 1, html: text }));
    const old = new Date(now - INLINE_VISUAL_RECLAIM_GRACE_MS - 60_000);
    if (!fresh) utimesSync(path, old, old);
  }
  return dataDir;
}
const exists = (dataDir: string, text: string) =>
  existsSync(join(dataDir, "inline-visuals", `${id(text)}.json`));

it("collects only store-backed v2 visual ids, ignoring legacy snapshots and malformed ids", () => {
  const legacy = { inlineVisual: { version: 1, title: "t", html: "<b>x</b>", height: 90 } };
  const broken = { inlineVisual: { version: 2, id: "not-a-hash", title: "t", height: 90 } };
  expect(inlineVisualIds({ blocks: [ref("a"), ref("a"), legacy, broken, {}] })).toEqual([id("a")]);
});

it("removes a deleted session's unreferenced, aged visual file", async () => {
  const dataDir = store(["only-deleted"]);
  const result = await reclaimDeletedInlineVisuals({
    dataDir,
    deletedIds: [id("only-deleted")],
    remaining: [{ blocks: [ref("other")] }],
  });
  expect(result.removed).toEqual([id("only-deleted")]);
  expect(exists(dataDir, "only-deleted")).toBe(false);
});

it("preserves a file that a remaining session references, including an archived one", async () => {
  const dataDir = store(["shared"]);
  const archived = { archived: true, blocks: [ref("shared")] };
  const result = await reclaimDeletedInlineVisuals({
    dataDir,
    deletedIds: [id("shared")],
    remaining: [archived],
  });
  expect(result.retained).toEqual([id("shared")]);
  expect(exists(dataDir, "shared")).toBe(true);
});

it("keeps a file still inside the grace window", async () => {
  const dataDir = store(["just-written"], true);
  const result = await reclaimDeletedInlineVisuals({
    dataDir,
    deletedIds: [id("just-written")],
    remaining: [],
  });
  expect(result.retained).toEqual([id("just-written")]);
  expect(exists(dataDir, "just-written")).toBe(true);
});

it("tolerates an id whose file is already gone", async () => {
  const dataDir = store([]);
  const result = await reclaimDeletedInlineVisuals({
    dataDir,
    deletedIds: [id("missing")],
    remaining: [],
  });
  expect(result).toEqual({ removed: [], retained: [] });
});

it("removes nothing when the remaining-session scan fails, so ownership stays unproven", async () => {
  const dataDir = store(["unproven"]);
  await expect(
    retireDeletedSessionVisuals(
      { sessions: () => Promise.reject(new Error("store unavailable")) },
      dataDir,
      [id("unproven")],
    ),
  ).rejects.toThrow("store unavailable");
  expect(exists(dataDir, "unproven")).toBe(true);
});

it("skips the remaining-session scan entirely when the deleted session had no visuals", async () => {
  const dataDir = store(["untouched"]);
  const result = await retireDeletedSessionVisuals(
    {
      sessions: () => {
        throw new Error("must not scan");
      },
    },
    dataDir,
    [],
  );
  expect(result).toEqual({ removed: [], retained: [] });
  expect(exists(dataDir, "untouched")).toBe(true);
});
