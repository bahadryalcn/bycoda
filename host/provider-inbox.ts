import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  inboxOperationWrites,
  REMOTE_INBOX_VERSION,
  safeInboxError,
  type DesktopInboxJob,
  type DesktopInboxPayload,
  type RemoteInboxAvailability,
  type RemoteInboxOperation,
  type RemoteInboxReceipt,
  type RemoteInboxTarget,
} from "../src/features/inbox/model/remoteInbox";

const CLIENT_STALE_MS = 20_000;
const START_DEADLINE_MS = 60_000;
const RUN_DEADLINE_MS = 120_000;
const MAX_RESULT_BYTES = 4 * 1024 * 1024;
type JobRow = {
  id: string;
  owner_hash: string;
  request_id: string;
  signature: string;
  operation_json: string;
  writes: number;
  state: RemoteInboxReceipt["state"];
  client_key: string | null;
  result_json: string | null;
  error: string | null;
  deadline: number;
  expires: number;
};

/** Durable receipts with short dispatch leases. Credentials never enter this table.
 * A dispatched write is never replayed, even across a host/desktop restart. */
export class ProviderInboxBridge {
  private readonly clients = new Map<string, number>();
  constructor(
    private readonly db: DatabaseSync,
    private readonly now = Date.now,
  ) {
    db.exec(`CREATE TABLE IF NOT EXISTS remote_inbox_jobs (
      id TEXT PRIMARY KEY, owner_hash TEXT NOT NULL, request_id TEXT NOT NULL,
      signature TEXT NOT NULL, operation_json TEXT NOT NULL, writes INTEGER NOT NULL,
      state TEXT NOT NULL, client_key TEXT, result_json TEXT, error TEXT,
      deadline INTEGER NOT NULL, expires INTEGER NOT NULL,
      UNIQUE(owner_hash, request_id)
    );`);
    db.prepare(
      "UPDATE remote_inbox_jobs SET state=CASE WHEN writes=1 THEN 'uncertain' ELSE 'failed' END, error=? WHERE state='running'",
    ).run(
      "The host restarted before the desktop reported the result. Refresh the provider before retrying.",
    );
    this.prune();
  }

  availability(): RemoteInboxAvailability {
    this.prune();
    return [...this.clients.values()].some((time) => this.now() - time <= CLIENT_STALE_MS)
      ? { available: true }
      : {
          available: false,
          reason:
            "Open the updated bycoda desktop app on this computer to manage its connected inbox providers.",
        };
  }

  request(
    ownerHash: string,
    requestId: unknown,
    operation: RemoteInboxOperation,
  ): RemoteInboxReceipt {
    this.prune();
    const receipt = this.existingRequest(ownerHash, requestId, operation);
    if (receipt) return receipt;
    if (typeof requestId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(requestId))
      throw new Error("Invalid inbox request ID.");
    const encoded = JSON.stringify(operation);
    const signature = createHash("sha256").update(encoded).digest("hex");
    const available = this.availability();
    if (!available.available) throw new Error(available.reason);
    const count = this.db
      .prepare(
        "SELECT count(*) AS total FROM remote_inbox_jobs WHERE state IN ('queued','running')",
      )
      .get() as { total: number };
    if (count.total >= 64)
      throw new Error("Too many inbox requests are waiting for the desktop. Try again shortly.");
    const ownerCount = this.db
      .prepare("SELECT count(*) AS total FROM remote_inbox_jobs WHERE owner_hash=?")
      .get(ownerHash) as { total: number };
    if (ownerCount.total >= 2000)
      throw new Error(
        "This device’s inbox request budget is full. Retry after older receipts expire.",
      );
    const id = randomUUID();
    const writes = inboxOperationWrites(operation);
    this.db
      .prepare(
        "INSERT INTO remote_inbox_jobs (id,owner_hash,request_id,signature,operation_json,writes,state,deadline,expires) VALUES (?,?,?,?,?,?,'queued',?,?)",
      )
      .run(
        id,
        ownerHash,
        requestId,
        signature,
        encoded,
        writes ? 1 : 0,
        this.now() + START_DEADLINE_MS,
        this.now() + (writes ? 24 * 60 * 60_000 : 15 * 60_000),
      );
    return { id, state: "queued" };
  }

  result(ownerHash: string, requestId: unknown): RemoteInboxReceipt {
    this.prune();
    if (typeof requestId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(requestId))
      throw new Error("Invalid inbox request ID.");
    const row = this.db
      .prepare("SELECT * FROM remote_inbox_jobs WHERE owner_hash=? AND request_id=?")
      .get(ownerHash, requestId) as JobRow | undefined;
    if (!row)
      throw new Error(
        "Inbox receipt not found or expired. Refresh the provider before retrying a send.",
      );
    return this.receipt(row);
  }

  /** Check a durable receipt before asking the owner again; mismatched payloads never reuse consent. */
  existingRequest(
    ownerHash: string,
    requestId: unknown,
    operation: RemoteInboxOperation,
  ): RemoteInboxReceipt | null {
    this.prune();
    if (typeof requestId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(requestId))
      throw new Error("Invalid inbox request ID.");
    const row = this.db
      .prepare("SELECT * FROM remote_inbox_jobs WHERE owner_hash=? AND request_id=?")
      .get(ownerHash, requestId) as JobRow | undefined;
    if (!row) return null;
    if (row.signature !== createHash("sha256").update(JSON.stringify(operation)).digest("hex"))
      throw new Error("This inbox request ID already belongs to another operation.");
    return this.receipt(row);
  }

  /** Agent targets must come from a completed, scoped provider discovery receipt. */
  assertListedTarget(ownerHash: string, item: RemoteInboxTarget, cwd: string): void {
    this.prune();
    const rows = this.db
      .prepare(
        "SELECT result_json FROM remote_inbox_jobs WHERE owner_hash=? AND state='completed' AND json_extract(operation_json,'$.action')='list' ORDER BY rowid DESC LIMIT 10",
      )
      .all(ownerHash);
    const path = (value: string) => {
      const normalized = value.replace(/\\/g, "/").replace(/\/$/, "");
      return /^[a-z]:\//i.test(normalized) || normalized.startsWith("//")
        ? normalized.toLowerCase()
        : normalized;
    };
    for (const row of rows) {
      const result = JSON.parse(String(row.result_json ?? "null")) as {
        items?: RemoteInboxTarget[];
      } | null;
      if (
        Array.isArray(result?.items) &&
        result.items.some(
          (target) =>
            target &&
            (!target.projectPath || path(target.projectPath) === path(cwd)) &&
            ["provider", "kind", "number", "repo", "id", "identifier"].every(
              (key) =>
                (target as Record<string, unknown>)[key] ===
                  (item as Record<string, unknown>)[key] ||
                (key === "repo" && !target.repo && !item.repo),
            ),
        )
      )
        return;
    }
    throw new Error(
      "Discover this project's Inbox items with inbox.providers.list and wait for its result before selecting a target.",
    );
  }

  beat(
    ownerHash: string,
    clientId: unknown,
    payload: unknown,
  ): { jobs: DesktopInboxJob[]; acked: string[] } {
    this.prune();
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
      return { jobs: [], acked: [] };
    const input = payload as DesktopInboxPayload;
    if (
      input.version !== REMOTE_INBOX_VERSION ||
      typeof clientId !== "string" ||
      !/^[A-Za-z0-9_-]{1,200}$/.test(clientId)
    )
      return { jobs: [], acked: [] };
    const clientKey = `${ownerHash}:${clientId}`;
    if (!this.clients.has(clientKey) && this.clients.size >= 16)
      throw new Error("Too many desktop inbox clients.");
    this.clients.set(clientKey, this.now());
    const acked: string[] = [];
    for (const reply of Array.isArray(input.replies) ? input.replies.slice(0, 16) : []) {
      if (!reply || typeof reply.id !== "string") continue;
      const row = this.db
        .prepare("SELECT * FROM remote_inbox_jobs WHERE id=? AND client_key=?")
        .get(reply.id, clientKey) as JobRow | undefined;
      if (!row) continue;
      // The same authenticated desktop still owns a dispatched write after its
      // lease expires. Persist its late reply before acknowledging delivery;
      // uncertain writes are never put back in the dispatch queue.
      if (row.state === "running" || (row.state === "uncertain" && row.result_json === null)) {
        if (typeof reply.error === "string") {
          this.db
            .prepare("UPDATE remote_inbox_jobs SET state=?,error=? WHERE id=?")
            .run(row.writes ? "uncertain" : "failed", safeInboxError(reply.error), row.id);
        } else {
          const result = JSON.stringify(reply.result ?? null);
          if (Buffer.byteLength(result, "utf8") > MAX_RESULT_BYTES) {
            this.db
              .prepare("UPDATE remote_inbox_jobs SET state=?,error=? WHERE id=?")
              .run(
                row.writes ? "uncertain" : "failed",
                "The provider response is too large. Use a narrower inbox filter.",
                row.id,
              );
          } else
            this.db
              .prepare(
                "UPDATE remote_inbox_jobs SET state='completed',result_json=?,error=NULL WHERE id=?",
              )
              .run(result, row.id);
        }
      }
      acked.push(row.id);
    }
    const executing = this.db
      .prepare(
        "SELECT count(*) AS total FROM remote_inbox_jobs WHERE state='running' AND client_key=?",
      )
      .get(clientKey) as { total: number };
    const pending = this.db
      .prepare("SELECT * FROM remote_inbox_jobs WHERE state='queued' ORDER BY rowid LIMIT ?")
      .all(Math.max(0, 2 - executing.total)) as JobRow[];
    const jobs: DesktopInboxJob[] = [];
    for (const row of pending) {
      const deadline = this.now() + RUN_DEADLINE_MS;
      this.db
        .prepare(
          "UPDATE remote_inbox_jobs SET state='running',client_key=?,deadline=? WHERE id=? AND state='queued'",
        )
        .run(clientKey, deadline, row.id);
      jobs.push({ id: row.id, operation: JSON.parse(row.operation_json) as RemoteInboxOperation, deadline });
    }
    return { jobs, acked };
  }

  private receipt(row: JobRow): RemoteInboxReceipt {
    return {
      id: row.id,
      state: row.state,
      ...(row.result_json === null ? {} : { result: JSON.parse(row.result_json) as unknown }),
      ...(row.error ? { error: row.error } : {}),
    };
  }
  private prune(): void {
    const now = this.now();
    this.db
      .prepare(
        "UPDATE remote_inbox_jobs SET state='failed',error=? WHERE state='queued' AND deadline<?",
      )
      .run("The desktop did not start this request in time. Open the app and retry.", now);
    this.db
      .prepare(
        "UPDATE remote_inbox_jobs SET state=CASE WHEN writes=1 THEN 'uncertain' ELSE 'failed' END,error=? WHERE state='running' AND deadline<?",
      )
      .run("The desktop did not report the result. Refresh the provider before retrying.", now);
    this.db.prepare("DELETE FROM remote_inbox_jobs WHERE expires<?").run(now);
    for (const [key, time] of this.clients) {
      if (now - time <= CLIENT_STALE_MS) continue;
      this.clients.delete(key);
      this.db
        .prepare(
          "UPDATE remote_inbox_jobs SET state=CASE WHEN writes=1 THEN 'uncertain' ELSE 'failed' END,error=? WHERE state='running' AND client_key=?",
        )
        .run(
          "The desktop disconnected before reporting the result. Refresh the provider before retrying.",
          key,
        );
    }
  }
}
