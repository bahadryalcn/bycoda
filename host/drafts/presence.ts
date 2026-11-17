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

/** Single-owner Host: all paired devices belong to its owner. No device may clear another. */
export class DraftPresenceRegistry {
  private snapshots: Snapshot[] = [];
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
      const next = this.snapshots.filter(
        (row) =>
          devices.includes(row.deviceId) &&
          !(row.deviceId === deviceId && row.clientId === report.clientId),
      );
      next.push({
        deviceId,
        clientId: report.clientId,
        sessionIds: [...new Set(report.sessionIds)].sort(),
        reportedAt: this.now(),
      });
      if (next.length > 4096) throw new Error("Too many draft presence clients");
      // Publish memory only after durable ACK. Failed writes never grant clearance.
      await writeFileAtomic(this.file, JSON.stringify(next), { mode: 0o600 });
      this.snapshots = next;
    });
    this.tail = operation.catch(() => {});
    await operation;
    return { accepted: true };
  }
  async hasUnsentDraft(sessionId: string, windowMs: number): Promise<boolean | undefined> {
    try {
      await this.ready;
      await this.tail;
      const devices = await this.devices();
      if (!devices.length || !Number.isFinite(windowMs) || windowMs <= 0) return undefined;
      const rows = this.snapshots.filter((row) => devices.includes(row.deviceId));
      if (rows.some((row) => row.sessionIds.includes(sessionId))) return true;
      const now = this.now();
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
