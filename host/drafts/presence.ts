import { join } from "node:path";
import { z } from "zod";
import { readStateFile, writeFileAtomic } from "../storage/atomic-write";

export const DRAFT_PRESENCE_METHOD = "drafts.presence.report";
export const DraftPresenceReport = z
  .object({
    clientId: z.string().min(1).max(128),
    sessionIds: z.array(z.string().min(1).max(200)).max(10_000),
    complete: z.literal(true),
  })
  .strict();
type Snapshot = { deviceId: string; clientId: string; sessionIds: string[]; reportedAt: number };
const Snapshots = z
  .array(
    DraftPresenceReport.extend({
      deviceId: z.string().min(1).max(200),
      reportedAt: z.number().finite().nonnegative(),
    }).omit({ complete: true }),
  )
  .max(4096);

const MAX_SNAPSHOTS = 4096;
/** A clean (no unsent draft) client silent this long is gone (reinstall, new clientId) and is forgotten. */
export const PRESENCE_CLEAN_TTL_MS = 7 * 86_400_000;
/** Unchanged heartbeats only move `reportedAt` in memory; the file is refreshed at this coarse cadence. */
export const PRESENCE_PERSIST_INTERVAL_MS = 10 * 60_000;

/**
 * Rows that carry draft session IDs never expire: the draft is durable on that device, so only
 * device revocation or the client's own next report may release it.
 */
function expiredClean(row: Snapshot, now: number): boolean {
  return row.sessionIds.length === 0 && now - row.reportedAt >= PRESENCE_CLEAN_TTL_MS;
}
function sameSessions(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/** Single-owner Host: all paired devices belong to its owner. No device may clear another. */
export class DraftPresenceRegistry {
  private snapshots: Snapshot[] = [];
  /** Clock of the last durable write; 0 makes the first report after a restart refresh the file. */
  private persistedAt = 0;
  private tail = Promise.resolve();
  private readonly file: string;
  private readonly ready: Promise<void>;
  constructor(
    directory: string,
    private readonly devices: () => Promise<string[]>,
    private readonly now = Date.now,
  ) {
    this.file = join(directory, "presence.json");
    this.ready = readStateFile(this.file, (text) => Snapshots.parse(JSON.parse(text)), {
      quarantine: false,
    }).then((result) => {
      if (result.status === "corrupt") throw new Error("Stored draft presence is invalid");
      this.snapshots = result.value ?? [];
    });
    // Startup failure remains sticky; callers fail closed without an unhandled rejection.
    void this.ready.catch(() => {});
  }
  async report(deviceId: string, raw: unknown): Promise<{ accepted: true }> {
    const report = DraftPresenceReport.parse(raw);
    const operation = this.tail.then(async () => {
      await this.ready;
      const devices = await this.devices();
      if (!devices.includes(deviceId)) throw new Error("Device authorization was revoked");
      const now = this.now();
      const isSelf = (row: Snapshot) =>
        row.deviceId === deviceId && row.clientId === report.clientId;
      const previous = this.snapshots.find(isSelf);
      const others = this.snapshots.filter((row) => !isSelf(row));
      const retained = others.filter(
        (row) => devices.includes(row.deviceId) && !expiredClean(row, now),
      );
      const row: Snapshot = {
        deviceId,
        clientId: report.clientId,
        sessionIds: [...new Set(report.sessionIds)].sort(),
        reportedAt: now,
      };
      const next = [...retained, row];
      if (next.length > MAX_SNAPSHOTS) throw new Error("Too many draft presence clients");
      const changed =
        !previous ||
        retained.length !== others.length ||
        !sameSessions(previous.sessionIds, row.sessionIds);
      // Changed ownership is published only after durable ACK, so a failed write never grants
      // clearance. A heartbeat that only moves `reportedAt` skips the fsync: a restart then reloads
      // an older timestamp, which is more conservative, never less.
      if (changed || now - this.persistedAt >= PRESENCE_PERSIST_INTERVAL_MS) {
        await writeFileAtomic(this.file, JSON.stringify(next), { mode: 0o600 });
        this.persistedAt = now;
      }
      this.snapshots = next;
    });
    this.tail = operation.catch(() => {});
    await operation;
    return { accepted: true };
  }
  /** Paired device ids; a batch caller reads them once and passes them to `hasUnsentDraft`. */
  listDevices(): Promise<string[]> {
    return this.devices();
  }
  async hasUnsentDraft(
    sessionId: string,
    windowMs: number,
    knownDevices?: string[],
  ): Promise<boolean | undefined> {
    try {
      await this.ready;
      await this.tail;
      const devices = knownDevices ?? (await this.devices());
      if (!devices.length || !Number.isFinite(windowMs) || windowMs <= 0) return undefined;
      const now = this.now();
      // Expired clean rows are ignored here too, so a leaked clientId cannot pin the answer to
      // "unknown" until some other client's report happens to prune it.
      const rows = this.snapshots.filter(
        (row) => devices.includes(row.deviceId) && !expiredClean(row, now),
      );
      if (rows.some((row) => row.sessionIds.includes(sessionId))) return true;
      if (
        devices.some((id) => !rows.some((row) => row.deviceId === id)) ||
        rows.some((row) => row.reportedAt > now || now - row.reportedAt >= windowMs)
      )
        return undefined;
      return false;
    } catch {
      return undefined;
    }
  }
}
