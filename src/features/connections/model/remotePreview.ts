import type { Block } from "../../sessions/model/session";

/**
 * The wire form of a transcript block (`host/transcriptPage.ts previewBlock`).
 * Another computer, or this desktop reading its own host, sees a block that
 * carries a file attachment, a preview image or a large payload in a shrunk
 * form: attachment `path`/`data`/`previewUrl`/`loadPreview` and top-level
 * `data`/`previewUrl`/`loadPreview` are dropped, strings are clipped with a
 * trailing "…", entries that do not fit the byte budget are omitted,
 * `tool.outputTruncated` is added, and the block gains `remoteContent`.
 *
 * None of that is an edit. A shrunk block is the same message as its full
 * version, and the full version must never be replaced by the shrunk one.
 */

const ELLIPSIS = "…";
/** Keys the projection adds rather than removes. */
const ADDED_BY_PREVIEW = new Set(["outputTruncated"]);
/** Fields the projection drops from a block or an attachment, and a desktop can
 * restore locally. Nothing else vanishing from a block is a shrunk form. */
const DROPPED_BY_PREVIEW = new Set(["path", "data", "previewUrl", "loadPreview", "copyFromPath"]);
/** Attachment fields the projection drops and a desktop can restore locally. */
const LOCAL_ONLY_ATTACHMENT_KEYS = ["path", "data", "previewUrl", "loadPreview", "copyFromPath"];
/** Beyond this size the projection also omits whatever did not fit its budget
 * (`host/transcriptPage.ts`: 64 KiB per block, with a margin). A smaller block
 * loses nothing but the fields above and clipped strings. */
const BUDGET_BYTES = 60 * 1024;
/** Attachments past this count are cut off the end. */
const ATTACHMENT_LIMIT = 128;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

type Shrink = {
  /** The wire block was too large for the budget: entries may be omitted. */
  oversize: boolean;
  top: boolean;
};

/** Whether `wire` is `full`, or the shrunk form the projection makes of it. It
 * is strict about what is missing: a key the wire block lacks must be one the
 * projection drops (or the block was too large for its budget), so a block
 * that really lost a flag (a delivered draft) is a different block. */
function shrunkFrom(full: unknown, wire: unknown, ctx: Shrink): boolean {
  if (wire === undefined || Object.is(full, wire)) return true;
  const inner = { ...ctx, top: false };
  if (typeof wire === "string") {
    if (typeof full !== "string" || !wire.endsWith(ELLIPSIS)) return false;
    const prefix = wire.slice(0, -ELLIPSIS.length);
    // A clipped string is cut from a longer one; the same length is an edit.
    return full.length > prefix.length && full.startsWith(prefix);
  }
  if (Array.isArray(wire)) {
    if (!Array.isArray(full)) return false;
    // Items that did not fit the budget are cut off the end; the rest line up.
    if (wire.length < full.length && !ctx.oversize && full.length <= ATTACHMENT_LIMIT) return false;
    return wire.length <= full.length && wire.every((item, i) => shrunkFrom(full[i], item, inner));
  }
  if (isRecord(wire)) {
    if (!isRecord(full)) return false;
    for (const [key, value] of Object.entries(wire)) {
      if (ctx.top && key === "remoteContent") continue;
      if (ADDED_BY_PREVIEW.has(key) && !(key in full)) continue;
      if (!(key in full) || !shrunkFrom(full[key], value, inner)) return false;
    }
    for (const key of Object.keys(full)) {
      if (key in wire || full[key] === undefined) continue;
      if (ctx.top && key === "remoteContent") continue;
      if (!DROPPED_BY_PREVIEW.has(key) && !ctx.oversize) return false;
    }
    return true;
  }
  return false;
}

/** `full` is the block `wire` was projected from, or looks like it. */
const projectedFrom = (full: Block, wire: Block): boolean =>
  !!wire.remoteContent &&
  shrunkFrom(full, wire, { oversize: wire.remoteContent.bytes > BUDGET_BYTES, top: true });

/** Either block is the projection's shrunk form of the other (same id and role). */
export function sameRemoteBlock(a: Block, b: Block): boolean {
  if (a.id !== b.id || a.role !== b.role) return false;
  if (!a.remoteContent && !b.remoteContent) return false;
  return projectedFrom(a, b) || projectedFrom(b, a);
}

/** The host's block with the files this desktop already holds for the same
 * attachments: the host never sends a path, a preview or the file's bytes. */
export function restoreLocalFiles(local: Block, host: Block): Block {
  if (!local.attachments?.length || !host.attachments?.length) return host;
  const files = local.attachments;
  let restored = false;
  const attachments = host.attachments.map((file) => {
    const mine = files.find((candidate) => candidate.id === file.id);
    if (!mine) return file;
    const missing = LOCAL_ONLY_ATTACHMENT_KEYS.filter(
      (key) => !(key in file) && key in mine,
    ) as Array<keyof typeof mine>;
    if (missing.length === 0) return file;
    restored = true;
    return { ...file, ...Object.fromEntries(missing.map((key) => [key, mine[key]])) };
  });
  return restored ? { ...host, attachments } : host;
}

/**
 * The host's block for a merged transcript, keeping this desktop's full
 * content wherever the host sent only its shrunk form. A host block that
 * really changed is taken, but keeps the files the local block already had.
 */
export function keepFullContent(local: Block, host: Block): Block {
  if (!host.remoteContent || local.remoteContent) return host;
  if (projectedFrom(local, host)) return local;
  return restoreLocalFiles(local, host);
}

/** `host` blocks with this desktop's full content kept; `host` itself when
 * nothing was shrunk or nothing differs. */
export function keepFullTranscript(local: readonly Block[], host: Block[]): Block[] {
  if (!host.some((block) => block.remoteContent)) return host;
  const byId = new Map(local.map((block) => [block.id, block]));
  let changed = false;
  const blocks = host.map((block) => {
    const mine = block.remoteContent ? byId.get(block.id) : undefined;
    const kept = mine && mine.role === block.role ? keepFullContent(mine, block) : block;
    if (kept !== block) changed = true;
    return kept;
  });
  return changed ? blocks : host;
}
