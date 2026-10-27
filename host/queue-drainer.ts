import type { QueuedMessage } from "../src/features/sessions/model/session";
import { sameQueuedModelTarget } from "../src/features/sessions/model/messageQueue";
import { isClearSessionCommand } from "../src/features/sessions/model/newSessionCommand";
import { isLeaseHeld } from "../src/features/sync/model/runLease";
import { QUEUE_STALL_MS, type SessionQueues } from "./session-queue";

/** How a host turn ended, as far as its queue is concerned. */
export type SettleOutcome = {
  /** The user stopped the turn. */
  cancelled?: boolean;
  /** The provider (or the turn) failed with this message. */
  error?: string;
  /** The host restarted, is stopping or its storage failed: the turn was cut short. */
  interrupted?: boolean;
  /** Why an interrupted turn ended, shown with the held queue. */
  reason?: string;
};

/** A refusal that only says the conversation is busy right now: nothing was decided. */
const TRANSIENT =
  /already running|host is stopping|in progress|branch switch|wait for running|wait for the (current|running)|current turn|still pending|being sent|being rewound/i;
export const isTransientDrainError = (error: unknown): boolean => {
  const text = error instanceof Error ? error.message : String(error ?? "");
  return isLeaseHeld(text) || TRANSIENT.test(text);
};

/** How long a holder's "cannot send" report is believed without another beat. */
const BLOCK_MARK_MS = 90_000;

/** What the host needs to know and do to send a queued message itself. */
export type QueueDrainHost = {
  /** The conversation is free: no turn runs here or in the desktop app. */
  ready(sessionId: string): boolean | Promise<boolean>;
  /** Sends the row as a turn, throwing if the host refuses it. */
  send(sessionId: string, row: QueuedMessage): void | Promise<void>;
  transaction<T>(action: () => T | Promise<T>, sessionId?: string): T | Promise<T>;
  outsideScope?<T>(action: () => T): T;
  /** When a desktop's hold on a conversation (its run lease) ends if not renewed. */
  wakeAt?(): number | undefined;
  /** Forgets the holds that ended; the drainer then looks again. */
  expired?(): void | Promise<void>;
  /** Whether a failed send only means the conversation is busy right now. */
  transient?(error: unknown): boolean;
};

/**
 * The home host is the drainer of last resort. A queue with a live drain lease
 * belongs to its holder (the desktop app); a queue without one is sent by the
 * host itself. Nothing polls: the host looks at a queue when it changes, when a
 * turn settles or the desktop reports a change, and once when the earliest live
 * lease runs out (the only timer, re-armed from the lease table).
 */
export class QueueDrainer {
  private readonly pending = new Set<string>();
  /** Queues with rows that could not be sent yet, looked at again when the host's state moves. */
  private readonly waiting = new Set<string>();
  /** Since when a queue has been free to send without its holder doing so. */
  private readonly freeSince = new Map<string, number>();
  /** Queues whose holder reports it cannot send right now (a sync conflict), until when. */
  private readonly blocked = new Map<string, { holder: string; until: number }>();
  private scheduled = false;
  private flushing?: Promise<void>;
  private waking?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private closed = false;
  private started = false;
  private armGeneration = 0;
  readonly ready: Promise<void>;
  constructor(
    private readonly queues: SessionQueues,
    private readonly host: QueueDrainHost,
    private readonly now: () => number = Date.now,
    autoStart = true,
  ) {
    queues.onChange = (id) => this.kick(id);
    this.ready = Promise.resolve(queues.ready).then(async () => {
      if (this.closed) return;
      if (autoStart) await this.activate();
    });
    void this.ready.catch(() => {});
  }
  async start(): Promise<void> {
    await this.ready;
    await this.activate();
  }
  private async activate(): Promise<void> {
    if (this.closed || this.started) return;
    this.started = true;
    await this.kickAll();
    this.arm();
  }
  /** Look at every queue that has something to send. */
  async kickAll(): Promise<void> {
    if (this.closed || !this.started) return;
    for (const id of await this.queues.pending()) this.kick(id);
  }
  /** Look again at queues that were waiting (a desktop turn ended, a lease went away). */
  kickWaiting(): void {
    for (const id of this.waiting) this.kick(id);
  }
  /**
   * A host turn ended. Only a turn that ended well lets the queue go on: after
   * a Stop, a failure or a turn cut short (the host restarted or stopped, its
   * storage failed) the owner decides, so the queue is held with the reason.
   */
  async settled(id: string, outcome: SettleOutcome = {}): Promise<void> {
    const failure = outcome.interrupted
      ? (outcome.reason ?? outcome.error ?? "This turn was interrupted.")
      : outcome.cancelled
        ? "Stopped by you."
        : outcome.error;
    if (failure === undefined) {
      if (!this.closed) this.kick(id);
      return;
    }
    try {
      const queue = await this.queues.get(id);
      if (queue.messages.length && queue.status === "active")
        await this.queues.hold(id, !outcome.interrupted && outcome.cancelled ? "stopped" : failure);
    } catch (error) {
      console.warn("Host queue hold failed", error);
    }
  }
  /**
   * Whether the holder of the drain lease makes no progress: the queue could be
   * sent right now and has been for a while (a conversation that is busy, or a
   * row being sent or edited, does not count). The holder's lease is then not
   * renewed, so it ends and the host sends the row itself.
   */
  async holderStalled(id: string): Promise<boolean> {
    try {
      if (this.isBlocked(id) || !(await this.queues.sendable(id)) || !(await this.host.ready(id))) {
        this.freeSince.delete(id);
        return false;
      }
      const since = this.freeSince.get(id) ?? this.now();
      this.freeSince.set(id, since);
      while (this.freeSince.size > 256) this.freeSince.delete(this.freeSince.keys().next().value!);
      return this.now() - since >= QUEUE_STALL_MS;
    } catch {
      return false;
    }
  }
  /**
   * The holder of a queue's lease says whether it cannot send right now for a
   * reason of its own (its copy of the conversation is in sync conflict). Such a
   * holder is not stalled, and the host does not send on its own copy either:
   * the mark ends with the next beat that does not report it, or when beats stop.
   */
  noteBlocked(id: string, holder: string, blocked: boolean): void {
    const known = this.blocked.get(id);
    if (!blocked) {
      if (known?.holder === holder) {
        this.blocked.delete(id);
        this.kick(id);
      }
      return;
    }
    if (known && known.holder !== holder && known.until > this.now()) return;
    this.blocked.set(id, { holder, until: this.now() + BLOCK_MARK_MS });
    while (this.blocked.size > 256) this.blocked.delete(this.blocked.keys().next().value!);
    this.freeSince.delete(id);
    this.arm();
  }
  private isBlocked(id: string): boolean {
    const known = this.blocked.get(id);
    if (!known) return false;
    if (known.until > this.now()) return true;
    this.blocked.delete(id);
    return false;
  }
  /** Look at one queue after the current call stack, outside any open transaction. */
  kick(id: string): void {
    if (this.closed) return;
    this.pending.add(id);
    if (!this.started) return;
    if (this.scheduled) return;
    this.scheduled = true;
    const schedule = () =>
      queueMicrotask(() => {
        const current = this.flush();
        this.flushing = current;
        void current
          .finally(() => {
            if (this.flushing === current) this.flushing = undefined;
          })
          .catch((error) => console.warn("Host queue flush failed", error));
      });
    if (this.host.outsideScope) this.host.outsideScope(schedule);
    else schedule();
  }
  private async flush(): Promise<void> {
    try {
      while (!this.closed && this.pending.size) {
        const ids = [...this.pending];
        this.pending.clear();
        for (const id of ids) await this.drain(id);
      }
      await this.arm();
    } finally {
      this.scheduled = false;
      if (!this.closed && this.pending.size) this.kick(this.pending.values().next().value!);
    }
  }
  async idle(): Promise<void> {
    await this.ready;
    while (this.scheduled || this.flushing || this.waking) {
      await Promise.resolve();
      await this.waking;
      await this.flushing;
    }
  }
  async close(): Promise<void> {
    this.closed = true;
    this.armGeneration++;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.queues.onChange = undefined;
    await this.ready.catch(() => {});
    await this.waking?.catch(() => {});
    await this.flushing?.catch(() => {});
  }
  /** One timer at the earliest live lease (drain or run). It looks again when it fires. */
  private arm(): void {
    if (this.closed || !this.started) return;
    const generation = ++this.armGeneration;
    clearTimeout(this.timer);
    this.timer = undefined;
    let blockEnds: number | undefined;
    for (const { until } of this.blocked.values())
      if (until > this.now()) blockEnds = Math.min(blockEnds ?? until, until);
    const times = [this.queues.nextLeaseExpiry(), this.host.wakeAt?.(), blockEnds].filter(
      (time): time is number => time !== undefined,
    );
    const at = times.length ? Math.min(...times) : undefined;
    if (this.closed || generation !== this.armGeneration || at === undefined) return;
    const schedule = () =>
      setTimeout(
        () => {
          const current = (async () => {
            this.timer = undefined;
            for (const [id, { until }] of [...this.blocked])
              if (until <= this.now()) this.blocked.delete(id);
            for (const id of await this.queues.takeExpired()) this.kick(id);
            // A desktop that stopped renewing no longer holds the conversation.
            await this.host.expired?.();
            this.kickWaiting();
            await this.arm();
          })();
          this.waking = current;
          void current
            .finally(() => {
              if (this.waking === current) this.waking = undefined;
            })
            .catch((error) => console.warn("Host queue expiry failed", error));
        },
        Math.max(0, at - this.now()) + 1,
      );
    this.timer = this.host.outsideScope ? this.host.outsideScope(schedule) : schedule();
    this.timer.unref?.();
  }
  private async drain(id: string): Promise<void> {
    if (this.closed) return;
    try {
      let queue = await this.queues.get(id);
      // The sender of a claimed row is gone: its delivery is unconfirmed. A
      // claim is looked at whatever the queue's state, or it would block every
      // send to the conversation for good.
      if (queue.claim) queue = await this.queues.reapStale(id);
      if (!queue.messages.length || queue.status !== "active") {
        this.waiting.delete(id);
        return;
      }
      this.waiting.add(id);
      if (queue.claim || queue.editingId) return;
      if (this.queues.live(queue)) return; // the holder drains
      const row = queue.messages[0];
      if (row.deliveryUnknown || this.isBlocked(id) || !(await this.host.ready(id)) || this.closed)
        return;
      try {
        await this.host.transaction(async () => {
          if (this.closed) return;
          const current = await this.queues.get(id);
          const head = current.messages[0];
          if (
            !head ||
            head.id !== row.id ||
            current.status !== "active" ||
            current.claim ||
            current.editingId ||
            this.queues.live(current) ||
            head.deliveryUnknown ||
            this.isBlocked(id) ||
            !(await this.host.ready(id))
          )
            return;
          await this.host.send(id, head);
          await this.queues.consumed(id, head.id);
        }, id);
      } catch (error) {
        // A conversation that is busy right now (a turn that started meanwhile,
        // the host stopping, a rewind or branch switch) says nothing about the
        // message: it stays queued and is looked at again when that ends. Only a
        // refusal the owner has to decide on holds the queue.
        console.warn("Host could not send the queued message", error);
        const transient = this.host.transient ?? isTransientDrainError;
        if (!transient(error) && (await this.host.ready(id)))
          await this.queues.hold(id, error instanceof Error ? error.message : String(error));
      }
    } catch (error) {
      console.warn("Host queue drain failed", error);
    }
  }
}

/** The commands that deliver a queued row: settings first when it was queued for other ones. */
export function queueRowCommands(
  sessionId: string,
  row: QueuedMessage,
  session: {
    harness: string;
    model: string;
    modelSettings?: Record<string, unknown>;
    runtimeMode: string;
  },
): Record<string, unknown>[] {
  const commandId = `queue-drain:${sessionId}:${row.id}`;
  const commands: Record<string, unknown>[] = [];
  if (
    row.modelTarget &&
    !sameQueuedModelTarget(row.modelTarget, {
      harness: session.harness as never,
      model: session.model,
      modelSettings: session.modelSettings as never,
    })
  )
    commands.push({
      type: "configure",
      commandId: `${commandId}:configure`,
      sessionId,
      harness: row.modelTarget.harness,
      model: row.modelTarget.model,
      modelSettings: row.modelTarget.modelSettings,
      runtimeMode: session.runtimeMode,
    });
  const text = row.text.trim().toLowerCase();
  if (text === "/compact") commands.push({ type: "compact", commandId, sessionId });
  else {
    if (
      isClearSessionCommand(row.text) ||
      row.noteCard ||
      row.handoffCard ||
      (row.intent && !["default", "plan", "build"].includes(row.intent))
    )
      throw new Error("The host cannot send this queued message. Send it from the desktop.");
    commands.push({
      type: "send",
      commandId,
      sessionId,
      text: row.text,
      attachments: row.attachments,
      ...(row.intent === "plan" || row.intent === "build" ? { intent: row.intent } : {}),
    });
  }
  return commands;
}
