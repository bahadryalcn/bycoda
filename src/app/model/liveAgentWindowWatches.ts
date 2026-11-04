import type { WindowLiveAgents } from "./windowLiveAgents";

export type LiveAgentWindowPeer = {
  label: string;
  listenDestroyed: (handler: () => void) => Promise<() => void>;
};
type Watch = {
  record: WindowLiveAgents;
  stop?: () => void;
  listening: boolean;
  suspect: boolean;
  audit: boolean;
  retryPresence: boolean;
};
const RETRY_DELAYS = [1000, 5000, 30_000];

/** Display-summary lifecycle only. Tauri window targets are labels, not incarnation grants.
 * A captured destroy/GONE is checked against both original record and fresh native existence. */
export class LiveAgentWindowWatches {
  private watches = new Map<string, Watch>();
  private disposed = false;
  private queued = false;
  private checking = false;
  private rerun = false;
  private retry = 0;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    private ports: {
      listWindows: () => Promise<readonly LiveAgentWindowPeer[]>;
      current: (label: string) => WindowLiveAgents | undefined;
      missing: (record: WindowLiveAgents) => void;
      visible: () => boolean;
    },
  ) {}
  observe(record: WindowLiveAgents): void {
    if (this.disposed) return;
    const label = record.ownerWindowLabel;
    const prior = this.watches.get(label);
    if (prior && prior.record.sourceId && prior.record.sourceId === record.sourceId) {
      prior.record = record;
      if (prior.suspect || (!prior.stop && !prior.listening)) this.queue();
      return;
    }
    this.release(prior);
    this.watches.set(label, {
      record,
      listening: false,
      suspect: false,
      audit: false,
      retryPresence: false,
    });
    this.retry = 0;
    this.queue();
  }
  gone(label: string, sourceId?: string): void {
    const entry = this.watches.get(label);
    if (!entry || (sourceId && sourceId !== entry.record.sourceId)) return;
    entry.suspect = true;
    this.queue();
  }
  visible(): void {
    if (this.disposed || !this.ports.visible()) return;
    this.retry = 0;
    clearTimeout(this.timer);
    this.timer = undefined;
    for (const entry of this.watches.values()) entry.audit = true;
    this.queue();
  }
  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    for (const entry of this.watches.values()) this.release(entry);
    this.watches.clear();
  }
  private release(entry: Watch | undefined): void {
    try {
      entry?.stop?.();
    } catch {
      /* Detached observation is not owner retirement. */
    }
    if (entry) entry.stop = undefined;
  }
  private selected(entry: Watch): boolean {
    return (
      !this.disposed &&
      this.watches.get(entry.record.ownerWindowLabel) === entry &&
      this.ports.current(entry.record.ownerWindowLabel) === entry.record
    );
  }
  private needs(entry: Watch): boolean {
    return entry.suspect || entry.audit || entry.retryPresence || (!entry.stop && !entry.listening);
  }
  private queue(): void {
    if (
      this.disposed ||
      this.queued ||
      ![...this.watches.values()].some((entry) => this.needs(entry))
    )
      return;
    if (this.checking) {
      this.rerun = true;
      return;
    }
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      if (!this.disposed) void this.check();
    });
  }
  private retryMissing(): void {
    if (this.disposed || this.timer || !this.ports.visible() || this.retry >= RETRY_DELAYS.length)
      return;
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        if (this.ports.visible()) this.queue();
      },
      RETRY_DELAYS[this.retry++],
    );
  }
  private async check(): Promise<void> {
    if (this.checking || this.disposed) return;
    const entries = [...this.watches.values()].filter(
      (entry) => this.needs(entry) && this.selected(entry),
    );
    if (!entries.length) return;
    // Snapshot exact accepted records before IPC; replacement messages cannot inherit this proof.
    const captured = entries.map((entry) => ({ entry, record: entry.record }));
    this.checking = true;
    let failed = false;
    try {
      const windows = await this.ports.listWindows();
      if (this.disposed) return;
      const peers = new Map(windows.map((peer) => [peer.label, peer]));
      for (const { entry, record } of captured) {
        if (!this.selected(entry) || entry.record !== record) {
          if (this.selected(entry)) this.rerun = true;
          continue;
        }
        const peer = peers.get(record.ownerWindowLabel);
        if (!peer) {
          this.watches.delete(record.ownerWindowLabel);
          this.release(entry);
          this.ports.missing(record);
          continue;
        }
        entry.retryPresence = entry.suspect || entry.retryPresence;
        entry.suspect = false;
        entry.audit = false;
        if (entry.stop || entry.listening) continue;
        entry.listening = true;
        // Capture this selected native object; delayed registration cleanup uses its original unlisten.
        void Promise.resolve()
          .then(() =>
            peer.listenDestroyed(() => {
              if (!this.selected(entry)) return;
              entry.suspect = true;
              this.queue();
            }),
          )
          .then((stop) => {
            entry.listening = false;
            if (!this.selected(entry)) {
              stop();
              return;
            }
            entry.stop = stop;
            if (entry.suspect) this.queue();
          })
          .catch(() => {
            entry.listening = false;
            if (this.selected(entry)) this.retryMissing();
          });
      }
    } catch {
      failed = true;
    } finally {
      this.checking = false;
      if (this.disposed) return;
      if (failed || [...this.watches.values()].some((entry) => entry.retryPresence))
        this.retryMissing();
      if (this.rerun) {
        this.rerun = false;
        this.queue();
      }
    }
  }
}
