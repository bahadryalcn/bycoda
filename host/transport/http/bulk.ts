import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  BulkDescriptorSchema,
  WS_LIMITS,
  type BulkDescriptor,
  type JsonValue,
} from "../../../src/shared/model/host-contracts";

export type BulkLease = Readonly<{ principalId: string; resource: string }>;
type Entry = {
  descriptor: BulkDescriptor;
  principalId: string;
  resource: string;
  bytes: Buffer;
  touched: number;
};
export class HostBulkError extends Error {
  constructor(
    readonly status: 404 | 409 | 413 | 429,
    message: string,
  ) {
    super(message);
  }
}

/** Immutable principal/resource-scoped JSON transfers; URLs never carry credentials. */
export class HostBulkTransfers {
  private readonly entries = new Map<string, Entry>();
  private readonly leases = new Set<BulkLease>();
  private bytes = 0;
  private stopped = false;
  private readonly now: () => number;
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly limits;

  constructor(
    private readonly options: {
      environmentId: string;
      now?: () => number;
      limits?: Partial<{
        maxTransfers: number;
        maxBytes: number;
        maxSnapshotBytes: number;
        maxLeases: number;
        ttlMs: number;
        chunkBytes: number;
      }>;
    },
  ) {
    this.now = options.now ?? Date.now;
    this.limits = {
      maxTransfers: 8,
      maxBytes: 128 * 1024 * 1024,
      maxSnapshotBytes: 32 * 1024 * 1024,
      maxLeases: WS_LIMITS.maxReadJobs + WS_LIMITS.maxControlJobs,
      ttlMs: 120_000,
      chunkBytes: WS_LIMITS.streamChunkBytes,
      ...options.limits,
    };
    for (const value of Object.values(this.limits))
      if (!Number.isSafeInteger(value) || value < 1)
        throw new Error("Invalid bulk transfer resource limit.");
    if (this.limits.chunkBytes > WS_LIMITS.streamChunkBytes)
      throw new Error("Bulk chunk exceeds wire limit.");
    this.timer = setInterval(() => this.prune(), Math.min(this.limits.ttlMs, 30_000));
    this.timer.unref();
  }

  begin(principalId: string, resource: string): BulkLease {
    this.prune();
    if (this.stopped || !principalId || !resource)
      throw new HostBulkError(409, "Transfer context is unavailable.");
    if (this.leases.size >= this.limits.maxLeases)
      throw new HostBulkError(429, "Transfer admission is busy.");
    const lease = Object.freeze({ principalId, resource });
    this.leases.add(lease);
    return lease;
  }

  release(lease: BulkLease): void {
    this.leases.delete(lease);
  }

  /** Validate the domain result before encoding. A stale/delete-invalidated lease cannot retain content. */
  encode(lease: BulkLease, value: JsonValue, inlineBytes: number): JsonValue {
    if (!this.leases.has(lease) || this.stopped)
      throw new HostBulkError(409, "Transfer context changed; refresh the resource.");
    if (!Number.isSafeInteger(inlineBytes) || inlineBytes < 1)
      throw new Error("Invalid inline bulk budget.");
    const text = JSON.stringify(value);
    const bytes = Buffer.from(text, "utf8");
    if (bytes.length <= inlineBytes) return value;
    if (bytes.length > this.limits.maxSnapshotBytes || bytes.length > this.limits.maxBytes)
      throw new HostBulkError(
        413,
        "Content exceeds the transfer budget; use bounded history pages.",
      );
    this.prune();
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    for (const entry of this.entries.values())
      if (
        entry.principalId === lease.principalId &&
        entry.resource === lease.resource &&
        entry.descriptor.sha256 === sha256
      ) {
        entry.touched = this.now();
        return { $bulk: entry.descriptor };
      }
    while (
      this.entries.size >= this.limits.maxTransfers ||
      this.bytes + bytes.length > this.limits.maxBytes
    ) {
      let oldest: Entry | undefined;
      for (const entry of this.entries.values())
        if (!oldest || entry.touched < oldest.touched) oldest = entry;
      if (!oldest) throw new HostBulkError(429, "Transfer capacity is busy.");
      this.remove(oldest.descriptor.transferId);
    }
    const descriptor = BulkDescriptorSchema.parse({
      kind: "bulk",
      transferId: randomUUID(),
      environmentId: this.options.environmentId,
      totalBytes: bytes.length,
      chunkBytes: this.limits.chunkBytes,
      sha256,
      expiresAt: this.now() + this.limits.ttlMs,
    });
    this.entries.set(descriptor.transferId, {
      descriptor,
      principalId: lease.principalId,
      resource: lease.resource,
      bytes,
      touched: this.now(),
    });
    this.bytes += bytes.length;
    return { $bulk: descriptor };
  }

  chunk(principalId: string, transferId: string, offset: number): Buffer {
    this.prune();
    const entry = this.entries.get(transferId);
    if (!entry || entry.principalId !== principalId || this.stopped)
      throw new HostBulkError(404, "Transfer is unavailable; refresh the resource.");
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset >= entry.bytes.length ||
      offset % entry.descriptor.chunkBytes !== 0
    )
      throw new HostBulkError(409, "Transfer offset is outside the chunk boundary.");
    entry.touched = this.now();
    // Never expose the retained backing buffer to callers.
    return Buffer.from(entry.bytes.subarray(offset, offset + entry.descriptor.chunkBytes));
  }

  invalidate(resource: string): void {
    for (const lease of this.leases) if (lease.resource === resource) this.leases.delete(lease);
    for (const [id, entry] of this.entries) if (entry.resource === resource) this.remove(id);
  }

  close(): void {
    this.stopped = true;
    clearInterval(this.timer);
    this.entries.clear();
    this.leases.clear();
    this.bytes = 0;
  }
  private remove(id: string): void {
    const entry = this.entries.get(id);
    if (entry) this.bytes -= entry.bytes.length;
    this.entries.delete(id);
  }
  private prune(): void {
    for (const [id, entry] of this.entries)
      if (entry.descriptor.expiresAt <= this.now()) this.remove(id);
  }
}

export function createHostBulkHandler(options: {
  transfers: HostBulkTransfers;
  authenticate: (token: string) => Promise<string | null>;
}) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    if (!request.url?.startsWith("/ws-bulk/")) return false;
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    const token = request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    if (request.method !== "GET" || request.headers.origin !== undefined || !token) {
      response.writeHead(token ? 403 : 401).end();
      return true;
    }
    try {
      const url = new URL(request.url, "http://localhost");
      const match = url.pathname.match(/^\/ws-bulk\/([A-Za-z0-9_-]{1,200})$/);
      const rawOffset = url.searchParams.get("offset");
      if (
        !match ||
        !/^(0|[1-9][0-9]{0,15})$/.test(rawOffset ?? "") ||
        [...url.searchParams.keys()].some((key) => key !== "offset") ||
        url.searchParams.getAll("offset").length !== 1
      ) {
        response.writeHead(400).end();
        return true;
      }
      const principal = await options.authenticate(token);
      if (!principal) {
        response.writeHead(401).end();
        return true;
      }
      const current = await options.authenticate(token);
      if (current !== principal) {
        response.writeHead(401).end();
        return true;
      }
      // No await after the last authorization and lookup: deletion also purges the pool.
      const chunk = options.transfers.chunk(principal, match[1], Number(rawOffset));
      response
        .writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Length": chunk.length,
        })
        .end(chunk);
    } catch (error) {
      if (!response.destroyed)
        response.writeHead(error instanceof HostBulkError ? error.status : 503).end();
    }
    return true;
  };
}
