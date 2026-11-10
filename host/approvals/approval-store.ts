import { z } from "zod";
import {
  ApprovalViewSchema,
  type ApprovalView,
} from "../../src/shared/model/host-contracts/approvals";
import type { StoreDatabase } from "../store-db";

/** What the registry keeps per approval; the flags never leave the Host. */
export type StoredApproval = ApprovalView & {
  pushed: boolean;
  applied: boolean;
  endedAt?: number;
};
const RowSchema = z.object({
  view: ApprovalViewSchema,
  pushed: z.boolean(),
  applied: z.boolean(),
  endedAt: z.number().optional(),
});

/** Durable copy of the approval relay registry, so a Host restart keeps pending approvals and phone answers. */
export class ApprovalStore {
  private prepared: Promise<void> | undefined;

  constructor(private readonly db: StoreDatabase) {}

  /** Create the table on startup; a lazy create would count as a write inside a read-only call. */
  prepare(): Promise<void> {
    this.prepared ??= this.db.exec(
      `CREATE TABLE IF NOT EXISTS approval_relay (
        id TEXT PRIMARY KEY,
        entry TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    );
    return this.prepared;
  }

  async load(): Promise<StoredApproval[]> {
    await this.prepare();
    const entries: StoredApproval[] = [];
    for (const row of await this.db.prepare("SELECT entry FROM approval_relay").all()) {
      try {
        const parsed = RowSchema.parse(JSON.parse(String(row.entry)));
        entries.push({
          ...parsed.view,
          pushed: parsed.pushed,
          applied: parsed.applied,
          endedAt: parsed.endedAt,
        });
      } catch {
        // A row that no longer parses is dropped; the native dialog stays the authority.
      }
    }
    return entries;
  }

  async save(entry: StoredApproval, at: number): Promise<void> {
    await this.prepare();
    const { pushed, applied, endedAt, ...view } = entry;
    await this.db
      .prepare("INSERT OR REPLACE INTO approval_relay (id, entry, updated_at) VALUES (?, ?, ?)")
      .run(entry.id, JSON.stringify({ view, pushed, applied, endedAt }), at);
  }

  async remove(id: string): Promise<void> {
    await this.prepare();
    await this.db.prepare("DELETE FROM approval_relay WHERE id=?").run(id);
  }
}
