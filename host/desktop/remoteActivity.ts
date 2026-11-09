/**
 * Things another device did through this Host that change what the desktop
 * shows, without the desktop running them itself (for example an archive of a
 * Host-held conversation, a worktree change or a project setting). The desktop
 * reads them on its heartbeat and tells the person at that screen.
 */
export type RemoteActivityEvent = {
  kind: "archived" | "worktreeChanged" | "settingsChanged";
  /** The project path the change belongs to. */
  cwd: string;
  /** Name of the requesting device, when known. */
  requestedBy?: string;
};

export type RemoteActivityChanges = { seq: number; events: RemoteActivityEvent[]; reset?: true };

const MAX_EVENTS = 200;

export class RemoteActivityFeed {
  private seq = 0;
  private events: { seq: number; event: RemoteActivityEvent }[] = [];

  record(event: RemoteActivityEvent): void {
    const requestedBy = event.requestedBy?.trim().slice(0, 160);
    this.events.push({
      seq: ++this.seq,
      event: { kind: event.kind, cwd: event.cwd, ...(requestedBy ? { requestedBy } : {}) },
    });
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
  }

  /**
   * Events after `since`. A desktop that has not read the feed yet (or whose
   * position is older than what is kept) gets only the current position, so a
   * restart never replays old notices.
   */
  since(since: unknown): RemoteActivityChanges {
    const known = typeof since === "number" && Number.isSafeInteger(since) ? since : undefined;
    if (known === undefined || known > this.seq) return { seq: this.seq, events: [], reset: true };
    const oldest = this.events[0]?.seq ?? this.seq + 1;
    if (known < oldest - 1) return { seq: this.seq, events: [], reset: true };
    return {
      seq: this.seq,
      events: this.events.filter((entry) => entry.seq > known).map((entry) => entry.event),
    };
  }
}

/** The requesting device's name for a bearer token, or undefined. */
export async function requestingDeviceName(
  store: {
    pairedDevices(token: string): Promise<{ devices: { name: string; isCurrent: boolean }[] }>;
  },
  token: string,
): Promise<string | undefined> {
  return store
    .pairedDevices(token)
    .then(({ devices }) => devices.find((device) => device.isCurrent)?.name)
    .catch(() => undefined);
}
