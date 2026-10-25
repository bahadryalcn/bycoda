import { randomInt } from "node:crypto";

/** What `sessions.adopted` reports per session; a move in any of these is a change. */
export type AdoptedRow = {
  id: string;
  revision: number;
  updatedAt: number;
  status: string;
  desktopUpdatedAt: number;
};

/**
 * Which adopted sessions moved on the host since a client's cursor, so a desktop
 * re-reads the list when something changed instead of on a timer. The list is
 * only recomputed when the store's change version moved; the cursor is shared by
 * every client. A cursor this host never issued, or already forgot, is `reset`.
 */
export class AdoptedChanges {
  /**
   * Cursors are `boot + n` with a random `boot` per host run, so a cursor from
   * before a restart is outside `[floor, sequence]` and gets `reset`.
   */
  readonly boot: string;
  private sequence: number;
  private floor: number;
  private seenVersion: number | undefined;
  private readonly signatures = new Map<string, string>();
  private readonly changed = new Map<string, number>();
  private refreshing?: Promise<void>;
  constructor(
    private readonly rows: () => readonly AdoptedRow[] | Promise<readonly AdoptedRow[]>,
    private readonly version: () => number,
    boot: number = randomInt(1, 2 ** 20) * 2 ** 32,
  ) {
    this.sequence = this.floor = boot;
    this.boot = boot.toString(16);
  }

  async changesSince(
    since: unknown,
  ): Promise<{ seq: number; ids: string[]; boot: string; reset?: true }> {
    await this.refresh();
    if (
      !Number.isSafeInteger(since) ||
      (since as number) > this.sequence ||
      (since as number) < this.floor
    )
      return { seq: this.sequence, ids: [], boot: this.boot, reset: true };
    const ids: string[] = [];
    for (const [id, seq] of this.changed) if (seq > (since as number)) ids.push(id);
    return { seq: this.sequence, ids, boot: this.boot };
  }

  private async refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    const current = this.readRows();
    this.refreshing = current;
    try {
      await current;
    } finally {
      if (this.refreshing === current) this.refreshing = undefined;
    }
  }

  private async readRows(): Promise<void> {
    const version = this.version();
    if (version === this.seenVersion) return;
    const first = this.seenVersion === undefined;
    const rows = await this.rows();
    // A failed read never advances the cached generation.
    this.seenVersion = version;
    const live = new Set<string>();
    for (const row of rows) {
      live.add(row.id);
      const signature = `${row.revision}|${row.updatedAt}|${row.status}|${row.desktopUpdatedAt}`;
      if (this.signatures.get(row.id) === signature) continue;
      this.signatures.set(row.id, signature);
      // The first read only establishes what is already there.
      if (!first) this.note(row.id);
    }
    for (const id of [...this.signatures.keys()])
      if (!live.has(id)) {
        this.signatures.delete(id);
        this.note(id);
      }
  }

  private note(id: string): void {
    this.changed.delete(id);
    this.changed.set(id, ++this.sequence);
    while (this.changed.size > 512) {
      const oldest = this.changed.entries().next().value!;
      this.changed.delete(oldest[0]);
      this.floor = Math.max(this.floor, oldest[1]);
    }
  }
}
