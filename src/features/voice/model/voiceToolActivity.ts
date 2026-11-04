import { elapsedSince, monotonicNow } from "../../../shared/lib/time/timestamps";

export type VoiceToolActivityEntry = {
  id: string;
  name: string;
  target: string;
  projectPath: string;
  requestId?: string;
  startedAt: number;
  elapsedMs?: number;
  state: "running" | "waiting-owner" | "returned" | "uncertain" | "failed";
  outcome?: string;
};

/** Observation only. Cancellation never claims to reverse an already dispatched effect. */
export class VoiceToolActivity {
  private entries: VoiceToolActivityEntry[] = [];
  private cancellations = new Map<string, () => void>();
  constructor(private changed: (entries: readonly VoiceToolActivityEntry[]) => void) {}
  private publish() {
    // This is a bounded UI history. Original receipts stay with the caller/Host;
    // evicting an old observation never authorizes retry or forgets its effect.
    const recentUnknown = new Set(
      this.entries.filter((entry) => entry.state === "uncertain").slice(-20),
    );
    const recentFinished = new Set(
      this.entries
        .filter((entry) => entry.state === "returned" || entry.state === "failed")
        .slice(-5),
    );
    this.entries = this.entries.filter(
      (entry) =>
        entry.state === "running" ||
        entry.state === "waiting-owner" ||
        recentUnknown.has(entry) ||
        recentFinished.has(entry),
    );
    this.changed([...this.entries]);
  }
  stopWaiting(id: string) {
    this.cancellations.get(id)?.();
  }
  async run<T>(
    metadata: Pick<VoiceToolActivityEntry, "name" | "target" | "projectPath" | "requestId">,
    execute: (observing: () => boolean, waitForOwner: () => void) => Promise<T>,
  ): Promise<
    T | { status: "uncertain"; requestId?: string; observationId: string; error: string }
  > {
    const entry: VoiceToolActivityEntry = {
      ...metadata,
      id: crypto.randomUUID(),
      startedAt: monotonicNow(),
      state: "running",
    };
    this.entries.push(entry);
    let observing = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cancelled = new Promise<{
      status: "uncertain";
      requestId?: string;
      observationId: string;
      error: string;
    }>((resolve) => {
      this.cancellations.set(entry.id, () => {
        if (!observing) return;
        observing = false;
        clearTimeout(timer);
        this.cancellations.delete(entry.id);
        Object.assign(entry, { state: "uncertain", elapsedMs: elapsedSince(entry.startedAt) });
        this.publish();
        resolve({
          status: "uncertain",
          requestId: entry.requestId,
          observationId: entry.id,
          error:
            "Observation stopped. The operation may still finish. Check its result before retrying.",
        });
      });
    });
    this.publish();
    timer = setTimeout(() => this.stopWaiting(entry.id), 35_000);
    const work = (async () =>
      execute(
        () => observing,
        () => {
          if (!observing) return;
          clearTimeout(timer);
          entry.state = "waiting-owner";
          this.publish();
        },
      ))()
      .then(
        (result) => {
          const value =
            result && typeof result === "object" ? (result as Record<string, unknown>) : {};
          const receiptState = typeof value.state === "string" ? value.state : value.status;
          const uncertain = ["uncertain", "unknown", "pending"].includes(String(receiptState));
          Object.assign(entry, {
            state: uncertain
              ? "uncertain"
              : value.error || receiptState === "failed"
                ? "failed"
                : "returned",
            elapsedMs: elapsedSince(entry.startedAt),
            outcome: typeof receiptState === "string" ? receiptState : undefined,
          });
          this.publish();
          return result;
        },
        (cause: unknown) => {
          // A transport failure cannot prove whether a mutation was applied.
          Object.assign(entry, { state: "uncertain", elapsedMs: elapsedSince(entry.startedAt) });
          this.publish();
          throw cause;
        },
      )
      .finally(() => {
        clearTimeout(timer);
        this.cancellations.delete(entry.id);
      });
    return Promise.race([work, cancelled]);
  }
}
