import { randomUUID } from "node:crypto";
import type {
  SessionSync,
  SessionSyncChunk,
  SessionSyncResponse,
} from "../../src/features/connections/model/protocol";

// The desktop rejects host responses over 16 MiB. Syncs above the inline limit
// are served as pieces of one serialized revision, each well under that cap
// after JSON string escaping, so neither a long transcript nor a single huge
// block can produce an oversized response.
export const INLINE_SYNC_BYTES = 4 * 1024 * 1024;
export const SYNC_CHUNK_BYTES = 4 * 1024 * 1024;
const TRANSFER_TTL_MS = 2 * 60_000;
/** After the last piece is served, only that piece stays readable so a lost response can be retried. */
const LAST_CHUNK_GRACE_MS = 15_000;
const MAX_TRANSFERS = 8;
/** A transfer that served a piece this recently is still being downloaded and is never evicted. */
const DOWNLOAD_PIN_MS = 30_000;
export const MAX_SYNC_TRANSFER_UNITS = 32 * 1024 * 1024;
export const MAX_TRANSFER_CACHE_BYTES = 128 * 1024 * 1024;

// Inline responses were already serialized to be measured; the server reuses
// that text for the response envelope instead of stringifying the value again.
const serialized = new WeakMap<object, string>();

/** JSON text of a value returned inline by `respond`, if it is still known. */
export function serializedResponse(value: unknown): string | undefined {
  return value && typeof value === "object" ? serialized.get(value) : undefined;
}

const encodedBytes = (value: string) => Buffer.byteLength(JSON.stringify(value));

export class SyncTransfers {
  private transfers = new Map<
    string,
    {
      sessionId: string;
      text: string;
      expires: number;
      lastOffset?: number;
      /** Last time a piece was served; a recent, unfinished transfer is mid-download. */
      lastServed?: number;
      /** The final piece was served; only its short grace window remains. */
      finished?: boolean;
    }
  >();

  constructor(
    private readonly limits: {
      inline: number;
      chunk: number;
      maxUnits?: number;
      cacheBytes?: number;
    } = {
      inline: INLINE_SYNC_BYTES,
      chunk: SYNC_CHUNK_BYTES,
    },
  ) {}

  respond(sessionId: string, sync: SessionSync): SessionSyncResponse {
    // UTF-8 uses at most 3 bytes per UTF-16 unit; skip measuring small syncs.
    if (sync.kind === "unchanged") return sync;
    const text = JSON.stringify(sync);
    if (
      text.length > (this.limits.maxUnits ?? MAX_SYNC_TRANSFER_UNITS) ||
      text.length * 2 > (this.limits.cacheBytes ?? MAX_TRANSFER_CACHE_BYTES)
    )
      throw new Error(
        "Session content exceeds the transfer budget; use bounded history pages or read the source file.",
      );
    if (text.length * 3 <= this.limits.inline || Buffer.byteLength(text) <= this.limits.inline) {
      serialized.set(sync, text);
      return sync;
    }
    const now = Date.now();
    this.prune(now);
    const budget = this.limits.cacheBytes ?? MAX_TRANSFER_CACHE_BYTES;
    let retained = [...this.transfers.values()].reduce(
      (bytes, entry) => bytes + entry.text.length * 2,
      0,
    );
    // Evict only idle transfers, oldest first. A transfer still being downloaded
    // is never evicted for another device's admission; if the slot or byte budget
    // cannot be freed without it, the caller gets a retryable busy error.
    for (const [id, entry] of this.transfers) {
      if (this.transfers.size < MAX_TRANSFERS && retained + text.length * 2 <= budget) break;
      if (this.downloading(entry, now)) continue;
      retained -= entry.text.length * 2;
      this.transfers.delete(id);
    }
    if (this.transfers.size >= MAX_TRANSFERS || retained + text.length * 2 > budget)
      throw new Error("Session transfers are busy; retry shortly.");
    const transfer = randomUUID();
    this.transfers.set(transfer, {
      sessionId,
      text,
      expires: Date.now() + TRANSFER_TTL_MS,
    });
    return {
      kind: "chunked",
      transfer,
      length: text.length,
      ...(sync.value.sourceEpoch ? { sourceEpoch: sync.value.sourceEpoch } : {}),
    };
  }

  chunk(sessionId: string, transfer: string, offset: number): SessionSyncChunk {
    const entry = this.transfers.get(transfer);
    if (!entry || entry.sessionId !== sessionId || entry.expires < Date.now())
      throw new Error("Session transfer expired; reload the session");
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > entry.text.length)
      throw new Error("Invalid session transfer offset");
    if (entry.lastOffset !== undefined && offset !== entry.lastOffset) {
      this.transfers.delete(transfer);
      throw new Error("Session transfer expired; reload the session");
    }
    // Transcript JSON usually encodes near one byte per UTF-16 unit; shrink
    // the piece when escaping or non-ASCII text makes it larger.
    let end = Math.min(
      entry.text.length,
      offset + Math.max(1, Math.floor((this.limits.chunk * 2) / 3)),
    );
    while (end - offset > 1 && encodedBytes(entry.text.slice(offset, end)) > this.limits.chunk)
      end = offset + Math.ceil((end - offset) / 2);
    // Never split a surrogate pair: a lone surrogate is not valid JSON text
    // for the desktop's native parser.
    const code = entry.text.charCodeAt(end - 1);
    if (end < entry.text.length && end - offset > 1 && code >= 0xd800 && code <= 0xdbff) end--;
    const data = entry.text.slice(offset, end);
    const now = Date.now();
    entry.lastServed = now;
    if (end === entry.text.length) {
      entry.finished = true;
      entry.lastOffset = offset;
      entry.expires = now + LAST_CHUNK_GRACE_MS;
    } else entry.expires = now + TRANSFER_TTL_MS;
    return { data };
  }

  forget(sessionId: string): void {
    for (const [id, entry] of this.transfers)
      if (entry.sessionId === sessionId) this.transfers.delete(id);
  }

  private downloading(entry: { lastServed?: number; finished?: boolean }, now: number): boolean {
    return (
      !entry.finished && entry.lastServed !== undefined && now - entry.lastServed < DOWNLOAD_PIN_MS
    );
  }

  private prune(now = Date.now()) {
    for (const [id, entry] of this.transfers) if (entry.expires < now) this.transfers.delete(id);
  }
}
