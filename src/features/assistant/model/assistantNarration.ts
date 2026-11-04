/** A speech attempt is owned by the original Host event and voice generation. */
export type NarrationSource = {
  hostId: string;
  eventId: string;
  generation: string;
  kind: "progress" | "completed" | "question";
  text: string;
};
export type NarrationReceipt = NarrationSource & { state: "pending" | "delivered" | "unknown" };
export type NarrationGates = {
  enabled: boolean;
  connected: boolean;
  present: boolean;
  quiet: boolean;
  dnd: boolean;
  busy: boolean;
};
export type NarrationPorts = {
  /** Atomic durable insert: false for any previous receipt, including pending/unknown. */
  claim(source: NarrationSource): Promise<boolean>;
  /** Must update only the exact original receipt; never create a new attempt. */
  settle(source: NarrationSource, state: "delivered" | "unknown"): Promise<void>;
  /** Re-read authoritative source and current consent/presence after every wait. */
  current(source: NarrationSource): Promise<{ source: NarrationSource; gates: NarrationGates } | undefined>;
  /** Existing output-only speech owner; no microphone or connection startup. */
  speak(source: NarrationSource, signal: AbortSignal): Promise<void>;
};

function same(a: NarrationSource, b: NarrationSource): boolean {
  return a.hostId === b.hostId && a.eventId === b.eventId && a.generation === b.generation &&
    a.kind === b.kind && a.text === b.text;
}
function allowed(g: NarrationGates): boolean {
  return g.enabled && g.connected && g.present && !g.quiet && !g.dnd && !g.busy;
}

/** Serializes speech locally; durable claim is the cross-window/restart authority. */
export class AssistantNarration {
  private running = false;
  private abort: AbortController | undefined;
  private audioEpoch = 0;
  constructor(private readonly ports: NarrationPorts) {}

  stopAudio(): void { this.audioEpoch++; this.abort?.abort(); }

  async deliver(source: NarrationSource): Promise<void> {
    if (this.running || !source.hostId || !source.eventId || !source.generation || !source.text) return;
    this.running = true;
    const epoch = this.audioEpoch;
    let claimed = false;
    try {
      const first = await this.ports.current(source);
      if (epoch !== this.audioEpoch || !first || !same(first.source, source) || !allowed(first.gates)) return;
      claimed = await this.ports.claim(source);
      if (!claimed) return;
      const current = await this.ports.current(source);
      if (epoch !== this.audioEpoch || !current || !same(current.source, source) || !allowed(current.gates)) {
        await this.ports.settle(source, "unknown");
        return;
      }
      const abort = new AbortController();
      this.abort = abort;
      try {
        await this.ports.speak(source, abort.signal);
        await this.ports.settle(source, abort.signal.aborted ? "unknown" : "delivered");
      } catch {
        await this.ports.settle(source, "unknown");
      }
    } finally {
      this.abort = undefined;
      this.running = false;
    }
  }
}

