import { z } from "zod";

export const SNAPSHOT_PAGE_DEFAULT_CHARS = 30000;
export const SNAPSHOT_PAGE_MAX_CHARS = 40000;
const MAX_TREE_DEPTH = 100;

/** One node per line (indented by depth) so a page never splits a ref. Also collects refs. */
export function renderSnapshotTree(
  tree: unknown,
  snapshotId: string,
): { text: string; refs: Set<string> } {
  const refs = new Set<string>();
  const lines: string[] = [];
  const walk = (node: unknown, depth: number) => {
    if (depth > MAX_TREE_DEPTH) throw new Error("Desktop tree exceeded its depth limit.");
    if (!node || typeof node !== "object") return;
    const { children, ...rest } = node as { ref_id?: unknown; children?: unknown };
    if (typeof rest.ref_id === "string") {
      if (!rest.ref_id.startsWith(`@${snapshotId}:`))
        throw new Error("Snapshot contained a foreign ref.");
      refs.add(rest.ref_id);
    }
    lines.push(`${" ".repeat(depth)}${JSON.stringify(rest)}`);
    if (Array.isArray(children)) for (const child of children) walk(child, depth + 1);
  };
  walk(tree, 0);
  return { text: lines.join("\n"), refs };
}

/** Cursor = "<offset>:<snapshotId>"; the snapshot id is re-checked against the stored owner. */
export function parseSnapshotCursor(cursor: string): { offset: number; snapshotId: string } {
  const split = cursor.indexOf(":");
  const offset = Number(cursor.slice(0, split));
  const snapshotId = cursor.slice(split + 1);
  if (split < 1 || !Number.isInteger(offset) || offset < 0 || !snapshotId)
    throw new Error("The desktop snapshot cursor is invalid.");
  return { offset, snapshotId };
}

/** Pages end on a line boundary; a single oversized line is kept whole. */
export function pageSnapshotText(
  text: string,
  snapshotId: string,
  offset: number,
  maxChars: number,
): { page: string; nextCursor: string | null; totalChars: number } {
  if (offset > text.length) throw new Error("The desktop snapshot cursor is invalid.");
  let end = Math.min(text.length, offset + maxChars);
  if (end < text.length) {
    const lineStart = text.lastIndexOf("\n", end);
    if (lineStart > offset) end = lineStart;
    else {
      const lineEnd = text.indexOf("\n", end);
      end = lineEnd < 0 ? text.length : lineEnd;
    }
  }
  const next = end >= text.length ? null : `${end + 1}:${snapshotId}`;
  return { page: text.slice(offset, end), nextCursor: next, totalChars: text.length };
}

export const observedSnapshotSchema = z.object({
  app: z.string(),
  window: z.object({ id: z.string() }),
  snapshot_id: z.string().max(100),
  complete: z.boolean(),
  tree: z.unknown(),
});
export const findResultSchema = z.object({
  snapshot_id: z.string().min(1).max(100).optional(),
  matches: z
    .array(
      z.object({
        ref_id: z.string().max(200).nullable(),
        role: z.string().max(200),
        name: z.string().max(4000).optional(),
        value: z.string().max(16000).nullable(),
        states: z.array(z.string().max(200)).max(100),
        interactive: z.boolean(),
      }),
    )
    .max(50),
  truncated: z.boolean(),
});

export const findFilterArgs = (query: Record<string, unknown>) =>
  Object.entries(query).flatMap(([key, value]) =>
    key === "exact"
      ? value
        ? ["--exact"]
        : []
      : typeof value === "string"
        ? [`--${key}=${value}`]
        : [],
  );

export function parseScreenshotImage(data: unknown) {
  const image = z
    .object({
      data: z.string().max(6 * 1024 * 1024),
      format: z.literal("png"),
      width: z.number().int().positive().max(16384),
      height: z.number().int().positive().max(16384),
    })
    .parse(data);
  if (image.width * image.height > 64_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data))
    throw new Error("The desktop screenshot is invalid or oversized.");
  const bytes = Buffer.from(image.data, "base64");
  if (
    bytes.length < 33 ||
    bytes.length > 4 * 1024 * 1024 ||
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    bytes.readUInt32BE(8) !== 13 ||
    bytes.toString("ascii", 12, 16) !== "IHDR" ||
    bytes.readUInt32BE(16) !== image.width ||
    bytes.readUInt32BE(20) !== image.height ||
    bytes.toString("base64") !== image.data
  )
    throw new Error("The desktop screenshot is not a bounded PNG.");
  return image;
}
