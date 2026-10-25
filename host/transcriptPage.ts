import type { HostSession } from "../src/features/connections/model/protocol";
import type { SessionSync } from "../src/features/connections/model/protocol";
import type { Block, ConversationRewindEntry } from "../src/features/sessions/model/session";
import { snapshotWeight } from "../src/features/connections/model/snapshotWeight";
import { blockDigest, conversationHead } from "../src/features/sync/model/conversationDigest";
export const TRANSCRIPT_BLOCK_PREVIEW_BYTES = 64 * 1024;
export const REWIND_ARCHIVE_PREVIEW_BYTES = 128 * 1024;

function truncateJsonString(value: string, maxBytes: number): string {
  if (Buffer.byteLength(JSON.stringify(value)) <= maxBytes) return value;
  let lo = 0,
    hi = value.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = value.slice(0, mid) + "…";
    if (Buffer.byteLength(JSON.stringify(candidate)) <= maxBytes) lo = mid;
    else hi = mid - 1;
  }
  let prefix = value.slice(0, lo);
  if (
    prefix.charCodeAt(prefix.length - 1) >= 0xd800 &&
    prefix.charCodeAt(prefix.length - 1) <= 0xdbff
  )
    prefix = prefix.slice(0, -1);
  return prefix + "…";
}

/** Keeps a transcript block's shape while bounding every nested string. With
 * `digests`, a shrunk block carries the digest of the full block it was made
 * from, so the receiver can compare it without the full content. */
export function previewBlock(block: Block, revision: number, digests = false): Block {
  let cached = previewCache.get(block);
  if (!cached) {
    cached = buildBlockPreview(block);
    previewCache.set(block, cached);
  }
  return cached.remote
    ? {
        ...cached.value,
        remoteContent: {
          revision,
          bytes: cached.bytes,
          ...(digests ? { digest: blockDigest(block) } : {}),
        },
      }
    : cached.value;
}

const previewCache = new WeakMap<Block, { value: Block; bytes: number; remote: boolean }>();

function buildBlockPreview(block: Block): {
  value: Block;
  bytes: number;
  remote: boolean;
} {
  const fullBytes = Buffer.byteLength(JSON.stringify(block));
  let omitted = false;
  let remaining = TRANSCRIPT_BLOCK_PREVIEW_BYTES - 96;
  const clip = (value: unknown, depth: number): unknown => {
    if (typeof value === "string") {
      const result = truncateJsonString(value, remaining);
      let size = Buffer.byteLength(JSON.stringify(result));
      if (size > remaining) {
        size = 0;
        omitted = true;
        return undefined;
      }
      if (result.length < value.length) omitted = true;
      remaining -= size;
      return result;
    }
    if (typeof value === "undefined" || typeof value === "function") {
      omitted = true;
      return undefined;
    }
    if (value === null || typeof value !== "object") {
      const size = Buffer.byteLength(JSON.stringify(value) ?? "null");
      if (size > remaining) {
        omitted = true;
        return undefined;
      }
      remaining -= size;
      return value;
    }
    if (depth >= 16) {
      omitted = true;
      return undefined;
    }
    if (Array.isArray(value)) {
      remaining -= 2;
      const result: unknown[] = [];
      for (const item of value) {
        if (remaining < 32) {
          omitted = true;
          break;
        }
        const next = clip(item, depth + 1);
        if (next !== undefined) result.push(next);
        remaining -= 2;
      }
      return result;
    }
    remaining -= 2;
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (["data", "previewUrl", "loadPreview"].includes(key)) {
        omitted = true;
        continue;
      }
      if (remaining < 64) {
        omitted = true;
        break;
      }
      const keyBytes = Buffer.byteLength(JSON.stringify(key)) + 2;
      remaining -= keyBytes;
      const next = clip(item, depth + 1);
      if (next !== undefined) result[key] = next;
      else omitted = true;
    }
    return result;
  };
  const {
    id,
    role,
    text,
    attachments,
    turnOutcome,
    turnStoppedAt,
    remoteContent: _remoteContent,
    ...rest
  } = block;
  if (_remoteContent) omitted = true;
  const attachmentPreview = attachments?.slice(0, 128);
  if (attachments && attachments.length > 128) omitted = true;
  const prepared = {
    id,
    role,
    text: truncateJsonString(text, 32 * 1024),
    ...(turnOutcome ? { turnOutcome } : {}),
    ...(turnStoppedAt !== undefined ? { turnStoppedAt } : {}),
    ...(attachmentPreview
      ? {
          attachments: attachmentPreview.map(
            ({
              data: _data,
              path: _path,
              previewUrl: _preview,
              loadPreview: _load,
              ...metadata
            }) => {
              if (
                _data !== undefined ||
                _path !== undefined ||
                _preview !== undefined ||
                _load !== undefined
              )
                omitted = true;
              return metadata;
            },
          ),
        }
      : {}),
    ...rest,
  };
  if (prepared.text.length < block.text.length) omitted = true;
  const preview = clip(prepared, 0) as Block | undefined;
  let marker = fullBytes > TRANSCRIPT_BLOCK_PREVIEW_BYTES || omitted;
  if (
    block.tool?.output &&
    (preview?.tool?.output?.length ?? 0) < block.tool.output.length &&
    preview?.tool
  )
    preview.tool.outputTruncated = true;
  let result = {
    ...(preview ?? { id: block.id, role: block.role, text: prepared.text }),
    id: block.id,
    role: block.role,
    text: typeof preview?.text === "string" ? preview.text : prepared.text,
    ...(marker ? { remoteContent: { revision: 0, bytes: fullBytes } } : {}),
  } as Block;
  if (Buffer.byteLength(JSON.stringify(result)) > TRANSCRIPT_BLOCK_PREVIEW_BYTES) {
    marker = true;
    result = {
      id: block.id,
      role: block.role,
      text: truncateJsonString(block.text, 32 * 1024),
      remoteContent: { revision: 0, bytes: fullBytes },
    } as Block;
  }
  return { value: result, bytes: fullBytes, remote: marker };
}

export function previewSession(value: HostSession, digests = false): HostSession {
  return {
    ...value,
    // A page already carries the head of the whole transcript it was cut from.
    ...(digests && !value.head ? withHead(value) : {}),
    session: {
      ...value.session,
      blocks: value.session.blocks.map((block) => previewBlock(block, value.revision, digests)),
      ...previewRewindHistory(value.session),
    },
  };
}

/** The head of the whole transcript. Always from the full blocks: a client holding
 * only part of it, or only shrunk blocks, still learns where the conversation is. */
export function withHead(value: HostSession): Pick<HostSession, "head"> {
  const head = conversationHead(value.session.blocks);
  return head ? { head } : {};
}

/** Projects the archive for transport only; the stored host transcript is unchanged. */
export function previewRewindHistory(
  session: Pick<HostSession["session"], "rewindHistory" | "rewindHistoryTruncated">,
): Pick<HostSession["session"], "rewindHistory" | "rewindHistoryTruncated"> {
  const history = session.rewindHistory;
  if (!history?.length) return { rewindHistory: history, rewindHistoryTruncated: undefined };
  let truncated = false;
  const projected: ConversationRewindEntry[] = [];
  const projectBlock = (block: Block): Block => {
    const text = truncateJsonString(block.text, 8 * 1024);
    const attachments = block.attachments?.slice(0, 12).map(({ name }) => {
      const previewName = truncateJsonString(name, 512);
      if (previewName.length < name.length) truncated = true;
      return { name: previewName };
    });
    if (
      text.length < block.text.length ||
      (block.attachments?.length ?? 0) > 12 ||
      block.attachments?.some((attachment) =>
        Object.keys(attachment).some((key) => key !== "name"),
      ) ||
      Object.keys(block).some(
        (key) => !["id", "role", "text", "attachments", "internal", "draft"].includes(key),
      )
    )
      truncated = true;
    return {
      id: truncateJsonString(block.id, 256),
      role: block.role,
      text,
      ...(block.internal ? { internal: true } : {}),
      ...(block.draft ? { draft: true } : {}),
      ...(attachments?.length ? { attachments } : {}),
    } as Block;
  };

  // Preserve chronology in the wire shape; RewoundHistoryDisclosure presents
  // entries newest-first. Select newest entries/blocks first under the budget.
  for (let entryIndex = history.length - 1; entryIndex >= 0; entryIndex--) {
    const entry = history[entryIndex]!;
    if (entry.id.length > 256 || entry.fromBlockId.length > 256) truncated = true;
    const boundedEntry: ConversationRewindEntry = {
      id: truncateJsonString(entry.id, 256),
      createdAt: entry.createdAt,
      fromBlockId: truncateJsonString(entry.fromBlockId, 256),
      blocks: [],
    };
    if (entry.blocks.length > 100) truncated = true;
    for (const block of entry.blocks.slice(-100).reverse()) {
      const projectedBlock = projectBlock(block);
      const trial = [
        ...projected,
        { ...boundedEntry, blocks: [...boundedEntry.blocks, projectedBlock] },
      ];
      if (Buffer.byteLength(JSON.stringify(trial)) > REWIND_ARCHIVE_PREVIEW_BYTES) {
        truncated = true;
        break;
      }
      boundedEntry.blocks.unshift(projectedBlock);
    }
    if (
      Buffer.byteLength(JSON.stringify([...projected, boundedEntry])) > REWIND_ARCHIVE_PREVIEW_BYTES
    ) {
      truncated = true;
      break;
    }
    projected.unshift(boundedEntry);
    if (entryIndex > 0 && projected.length >= 100) {
      truncated = true;
      break;
    }
  }
  if (projected.length < history.length) truncated = true;
  return {
    rewindHistory: projected,
    ...(truncated ? { rewindHistoryTruncated: true } : {}),
  };
}

/** Returns a partial delta for the contiguous window starting at its earliest
 * surviving loaded block, or undefined when the caller must send a tail page. */
export function partialSessionSync(
  sync: SessionSync,
  current: HostSession,
  loadedBlockIds: string[],
  digests = false,
): SessionSync | undefined {
  if (sync.kind === "unchanged") return sync;
  if (sync.kind !== "delta") return undefined;
  const loaded = new Set(loadedBlockIds);
  const first = current.session.blocks.findIndex((block) => loaded.has(block.id));
  if (first < 0) return undefined;
  const blocks = current.session.blocks.slice(first);
  const ids = new Set(blocks.map((block) => block.id));
  const { session, ...metadata } = sync.value;
  return {
    ...sync,
    partial: true,
    value: {
      ...metadata,
      ...(digests ? withHead(current) : {}),
      history: {
        before: first > 0 ? first : undefined,
        revision: current.revision,
        totalBlocks: current.session.blocks.length,
      },
      session: { ...session, ...previewRewindHistory(session) },
    },
    blockIds: blocks.map((block) => block.id),
    blocks: sync.blocks
      .filter((block) => ids.has(block.id))
      .map((block) => previewBlock(block, current.revision, digests)),
  };
}
export class TranscriptPages {
  private snapshots = new Map<string, { value: HostSession; expires: number; bytes: number }>();
  async page(
    read: () => HostSession | Promise<HostSession>,
    id: string,
    before?: number,
    revision?: number,
    preview = true,
    digests = false,
  ) {
    const key = `${id}:${revision}`;
    const captured = revision === undefined ? undefined : this.snapshots.get(key);
    const value = captured && captured.expires > Date.now() ? captured.value : await read();
    const page = transcriptPage(value, before, revision, preview, digests);
    const captureKey = `${id}:${value.revision}`;
    this.snapshots.delete(captureKey);
    this.snapshots.set(captureKey, {
      value,
      expires: Date.now() + 120_000,
      bytes: snapshotWeight(value),
    });
    let bytes = [...this.snapshots.values()].reduce((sum, entry) => sum + entry.bytes, 0);
    for (const [entryKey, entry] of this.snapshots) {
      if (entry.expires < Date.now() || this.snapshots.size > 8 || bytes > 128 * 1024 * 1024) {
        this.snapshots.delete(entryKey);
        bytes -= entry.bytes;
      }
    }
    return page;
  }
}
export function transcriptPage(
  value: HostSession,
  before?: number,
  revision?: number,
  preview = true,
  digests = false,
) {
  if (revision !== undefined && revision !== value.revision)
    throw new Error("Transcript changed; reload history");
  const end = before ?? value.session.blocks.length;
  if (!Number.isSafeInteger(end) || end < 0 || end > value.session.blocks.length)
    throw new Error("Invalid transcript cursor");
  let start = end;
  let bytes = 0;
  const { blockRevisions: _revisions, ...metadata } = value;
  const boundedSession = preview
    ? { ...value.session, ...previewRewindHistory(value.session) }
    : value.session;
  const emptyPage = {
    ...metadata,
    session: { ...boundedSession, blocks: [] },
    history: {
      before: 0,
      revision: value.revision,
      totalBlocks: value.session.blocks.length,
    },
  };
  const pageOverhead = preview ? Buffer.byteLength(JSON.stringify(emptyPage)) + 128 : 0;
  if (preview && pageOverhead >= 1024 * 1024)
    throw new Error("Transcript metadata exceeds the page transfer budget");
  const blockBudget = preview ? 1024 * 1024 - pageOverhead : 1024 * 1024;
  while (start > 0 && end - start < 100) {
    const block = value.session.blocks[start - 1]!;
    const bounded = preview ? previewBlock(block, value.revision, digests) : block;
    const size = Buffer.byteLength(JSON.stringify(bounded));
    if (preview && start === end && size > blockBudget)
      throw new Error("Transcript metadata leaves no room for a bounded page");
    if (bytes + size > blockBudget && start < end) break;
    bytes += size;
    start--;
  }
  const beforeCursor = start > 0 ? start : undefined;
  return {
    value: {
      ...metadata,
      ...(digests ? withHead(value) : {}),
      session: {
        ...boundedSession,
        blocks: value.session.blocks
          .slice(start, end)
          .map((block) => (preview ? previewBlock(block, value.revision, digests) : block)),
      },
      history: {
        before: beforeCursor,
        revision: value.revision,
        totalBlocks: value.session.blocks.length,
      },
    },
    before: beforeCursor,
    totalBlocks: value.session.blocks.length,
    revision: value.revision,
  };
}
