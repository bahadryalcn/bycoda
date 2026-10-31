import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  JsonValueSchema,
  SafeCounterSchema,
  SubscriptionOpenParamsSchema,
  WS_LIMITS,
  type JsonValue,
  type StreamCursor,
  type SubscriptionEvent,
} from "../../../src/shared/model/host-contracts";

type Open = z.infer<typeof SubscriptionOpenParamsSchema>;
export type HostStreamTarget = Open["target"];
export type HostStreamSnapshot =
  | { kind?: "snapshot" | "delta"; revision?: number; baseRevision?: number; data: JsonValue }
  | { kind: "unchanged"; revision: number };
export type HostStreamLoadContext = {
  revision?: number;
  forceSnapshot: boolean;
  authorized: () => Promise<boolean>;
};
export type HostStreamConsumer = {
  connectionId: string;
  principalId: string;
  authorized: () => Promise<boolean>;
  executionAuthorized?: () => Promise<boolean>;
  send: (event: SubscriptionEvent) => boolean;
};
type Event = Omit<SubscriptionEvent["params"], "subscriptionId">;
type Retained = { event: Event; bytes: number; at: number };
type Consumer = {
  owner: HostStreamConsumer;
  id: string;
  active: boolean;
  needsSnapshot: boolean;
  sent: number;
  ack: number;
  pending: Map<number, number>;
  bytes: number;
};
type Stream = {
  key: string;
  id: string;
  epoch: string;
  principalId: string;
  target: HostStreamTarget;
  sequence: number;
  generation: number;
  fingerprint?: string;
  revision?: number;
  forceSnapshot: boolean;
  events: Retained[];
  bytes: number;
  touched: number;
  dirty: boolean;
  deleted: boolean;
  reading?: AbortController;
  readingBaseline?: boolean;
  refreshAt?: number;
  consumers: Map<string, Consumer>;
};

export class HostStreamError extends Error {
  constructor(
    readonly code: "limit" | "identity" | "cursor",
    message: string,
  ) {
    super(message);
  }
}

/** Principal-scoped snapshot streams. Acknowledgement means application commit, not receipt. */
export class HostSubscriptionHub {
  private readonly streams = new Map<string, Stream>();
  private readonly subscriptions = new Map<string, { stream: Stream; consumer: Consumer }>();
  private readonly limits;
  private readonly now: () => number;
  private bytes = 0;
  private reads = 0;
  private queued = false;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private readonly pruning: ReturnType<typeof setInterval>;

  constructor(
    private readonly options: {
      environmentId: string;
      load: (
        target: HostStreamTarget,
        principalId: string,
        signal: AbortSignal,
        context: HostStreamLoadContext,
      ) => Promise<HostStreamSnapshot | null>;
      now?: () => number;
      limits?: Partial<
        Pick<
          typeof WS_LIMITS,
          | "maxSubscriptionsPerSocket"
          | "maxSubscriptionsPerHost"
          | "maxUnacknowledgedEvents"
          | "maxSubscriptionWindowBytes"
          | "maxReplayEvents"
          | "maxReplayBytes"
          | "maxReplayAgeMs"
          | "maxHostReplayBytes"
          | "streamChunkBytes"
        >
      >;
      maxConcurrentReads?: number;
    },
  ) {
    this.limits = { ...WS_LIMITS, ...options.limits };
    this.now = options.now ?? Date.now;
    for (const value of [...Object.values(this.limits), options.maxConcurrentReads ?? 8])
      if (!Number.isSafeInteger(value) || value < 1)
        throw new Error("Invalid stream resource limit.");
    this.pruning = setInterval(() => this.prune(), Math.min(30_000, this.limits.maxReplayAgeMs));
    this.pruning.unref();
  }

  open(owner: HostStreamConsumer, raw: Open) {
    const input = SubscriptionOpenParamsSchema.parse(raw);
    if (this.stopped || !owner.connectionId || !owner.principalId)
      throw new HostStreamError("identity", "Stream connection is unavailable.");
    const identity = JSON.stringify([owner.connectionId, input.subscriptionId]);
    if (this.subscriptions.has(identity))
      throw new HostStreamError("identity", "Subscription identity is already in use.");
    this.prune();
    let socketCount = 0;
    for (const entry of this.subscriptions.values())
      if (entry.consumer.owner.connectionId === owner.connectionId) socketCount++;
    if (
      socketCount >= this.limits.maxSubscriptionsPerSocket ||
      this.subscriptions.size >= this.limits.maxSubscriptionsPerHost
    )
      throw new HostStreamError("limit", "Subscription capacity is busy.");
    const key = JSON.stringify([this.options.environmentId, owner.principalId, input.target]);
    let stream = this.streams.get(key);
    if (!stream) {
      // Retained disconnected streams also count against the host budget.
      if (this.streams.size >= this.limits.maxSubscriptionsPerHost) {
        const retired = [...this.streams.values()].find(
          (value) => !value.consumers.size && !value.reading,
        );
        if (retired) this.drop(retired);
      }
      if (this.streams.size >= this.limits.maxSubscriptionsPerHost)
        throw new HostStreamError("limit", "Stream capacity is busy.");
      stream = {
        key,
        id: randomUUID(),
        epoch: randomUUID(),
        principalId: owner.principalId,
        target: input.target,
        sequence: 0,
        generation: 0,
        events: [],
        bytes: 0,
        touched: this.now(),
        dirty: true,
        deleted: false,
        forceSnapshot: true,
        consumers: new Map(),
      };
      this.streams.set(key, stream);
    }
    const consumer: Consumer = {
      owner,
      id: input.subscriptionId,
      active: false,
      needsSnapshot: true,
      sent: 0,
      ack: 0,
      pending: new Map(),
      bytes: 0,
    };
    stream.touched = this.now();
    stream.consumers.set(identity, consumer);
    this.subscriptions.set(identity, { stream, consumer });
    const selected = stream;
    return {
      result: { subscriptionId: input.subscriptionId, streamId: stream.id },
      // The transport sends the open response before activating event delivery.
      activate: () => {
        if (this.stopped || !this.subscriptions.has(identity) || consumer.active) return;
        consumer.active = true;
        void this.activate(selected, consumer, input.cursor).catch(() => this.remove(identity));
      },
    };
  }

  acknowledge(connectionId: string, subscriptionId: string, cursor: StreamCursor): boolean {
    const entry = this.subscriptions.get(JSON.stringify([connectionId, subscriptionId]));
    if (!entry) return false;
    const { stream, consumer } = entry;
    if (
      cursor.epoch !== stream.epoch ||
      !Number.isSafeInteger(cursor.sequence) ||
      cursor.sequence < consumer.ack ||
      cursor.sequence > consumer.sent
    )
      throw new HostStreamError("cursor", "Acknowledgement is outside the sent stream window.");
    consumer.ack = cursor.sequence;
    for (const [sequence, bytes] of consumer.pending)
      if (sequence <= cursor.sequence) {
        consumer.pending.delete(sequence);
        consumer.bytes -= bytes;
      }
    stream.touched = this.now();
    return true;
  }

  closeSubscription(connectionId: string, subscriptionId: string): boolean {
    return this.remove(JSON.stringify([connectionId, subscriptionId]));
  }

  detach(connectionId: string): void {
    for (const [key, entry] of this.subscriptions)
      if (entry.consumer.owner.connectionId === connectionId) this.remove(key);
  }

  targets(): HostStreamTarget[] {
    return [...this.streams.values()].filter((stream) => !stream.deleted).map((stream) => stream.target);
  }

  invalidate(target?: HostStreamTarget): void {
    for (const stream of this.streams.values())
      if (!target || JSON.stringify(stream.target) === JSON.stringify(target)) {
        // Ordinary commits only wake a new read. Discarding every in-flight read
        // under unrelated token traffic would starve otherwise healthy streams.
        if (!stream.deleted) stream.dirty = true;
      }
    this.schedule();
  }

  /** Call only after a committed deletion/privacy invalidation; late loads cannot republish. */
  forget(target: HostStreamTarget): void {
    for (const stream of this.streams.values())
      if (JSON.stringify(stream.target) === JSON.stringify(target)) this.tombstone(stream);
  }

  /** Privacy/deletion within a collection invalidates its replay without deleting the collection. */
  resnapshot(target: HostStreamTarget): void {
    for (const stream of this.streams.values()) {
      if (stream.deleted || JSON.stringify(stream.target) !== JSON.stringify(target)) continue;
      stream.generation++;
      stream.reading?.abort();
      this.bytes -= stream.bytes;
      stream.bytes = 0;
      stream.events = [];
      stream.fingerprint = undefined;
      stream.revision = undefined;
      stream.epoch = randomUUID();
      stream.sequence = 0;
      stream.forceSnapshot = true;
      stream.dirty = true;
      stream.touched = this.now();
      for (const consumer of stream.consumers.values()) {
        this.deliver(stream, consumer, this.event(stream, "resync-required"));
        consumer.active = false;
        consumer.needsSnapshot = true;
        consumer.pending.clear();
        consumer.bytes = 0;
      }
    }
    this.schedule();
  }

  close(): void {
    if (this.stopped) return;
    this.stopped = true;
    clearInterval(this.pruning);
    clearTimeout(this.refreshTimer);
    for (const stream of this.streams.values()) stream.reading?.abort();
    this.subscriptions.clear();
    this.streams.clear();
    this.bytes = 0;
  }

  private async activate(stream: Stream, consumer: Consumer, cursor?: StreamCursor): Promise<void> {
    if (!(await consumer.owner.authorized()) || !consumer.active || this.stopped) {
      this.detach(consumer.owner.connectionId);
      return;
    }
    if (stream.deleted) {
      this.deliver(stream, consumer, this.event(stream, "closed", { reason: "deleted" }));
      this.remove(JSON.stringify([consumer.owner.connectionId, consumer.id]));
      return;
    }
    const first = stream.events[0]?.event.cursor.sequence ?? stream.sequence + 1;
    if (
      cursor &&
      cursor.epoch === stream.epoch &&
      cursor.sequence >= first - 1 &&
      cursor.sequence <= stream.sequence
    ) {
      consumer.ack = consumer.sent = cursor.sequence;
      consumer.needsSnapshot = false;
      for (const retained of stream.events)
        if (retained.event.cursor.sequence > cursor.sequence)
          this.deliver(stream, consumer, retained.event);
    } else {
      if (cursor) this.deliver(stream, consumer, this.event(stream, "resync-required"));
      const last = stream.events.at(-1);
      if (last?.event.kind === "snapshot" && !stream.dirty && !stream.reading)
        this.deliver(stream, consumer, last.event);
      else {
        stream.forceSnapshot = true;
        stream.dirty = true;
      }
    }
    this.schedule();
  }

  private event(stream: Stream, kind: Event["kind"], data?: JsonValue, revision?: number): Event {
    return {
      streamId: stream.id,
      cursor: { epoch: stream.epoch, sequence: stream.sequence },
      kind,
      ...(data === undefined ? {} : { data }),
      ...(revision === undefined ? {} : { revision }),
    };
  }

  private deliver(stream: Stream, consumer: Consumer, event: Event): void {
    if (!consumer.active || this.stopped) return;
    const message: SubscriptionEvent = {
      jsonrpc: "2.0",
      method: "subscription.event",
      params: { ...event, subscriptionId: consumer.id },
    };
    const bytes = Buffer.byteLength(JSON.stringify(message));
    if (event.kind === "snapshot" || event.kind === "delta") {
      if (event.kind === "delta" && consumer.needsSnapshot) return;
      if (event.cursor.sequence <= consumer.sent) return;
      if (
        consumer.pending.size >= this.limits.maxUnacknowledgedEvents ||
        consumer.bytes + bytes > this.limits.maxSubscriptionWindowBytes
      ) {
        this.send(consumer, {
          jsonrpc: "2.0",
          method: "subscription.event",
          params: {
            subscriptionId: consumer.id,
            streamId: stream.id,
            cursor: { epoch: stream.epoch, sequence: consumer.sent },
            kind: "resync-required",
          },
        });
        consumer.active = false;
        consumer.pending.clear();
        consumer.bytes = 0;
        return;
      }
      consumer.pending.set(event.cursor.sequence, bytes);
      consumer.bytes += bytes;
      consumer.sent = event.cursor.sequence;
      if (event.kind === "snapshot") consumer.needsSnapshot = false;
    }
    if (!this.send(consumer, message)) consumer.active = false;
  }

  private send(consumer: Consumer, message: SubscriptionEvent): boolean {
    try {
      return consumer.owner.send(message);
    } catch {
      return false;
    }
  }

  private schedule(): void {
    if (this.queued || this.stopped) return;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      if (this.stopped) return;
      for (const stream of this.streams.values()) {
        if (this.reads >= (this.options.maxConcurrentReads ?? 8)) break;
        if (
          !stream.dirty ||
          stream.reading ||
          stream.deleted ||
          ![...stream.consumers.values()].some((consumer) => consumer.active)
        )
          continue;
        const delay = (stream.refreshAt ?? 0) - Date.now();
        if (delay > 0) {
          if (!this.refreshTimer) {
            this.refreshTimer = setTimeout(() => {
              this.refreshTimer = undefined;
              this.schedule();
            }, delay);
            this.refreshTimer.unref();
          }
          continue;
        }
        stream.refreshAt = Date.now() + 250;
        this.reads++;
        stream.dirty = false;
        const controller = new AbortController();
        stream.reading = controller;
        const generation = stream.generation;
        const deadline = setTimeout(() => {
          controller.abort();
          if (this.stopped || stream.deleted || generation !== stream.generation) return;
          for (const consumer of stream.consumers.values()) {
            this.deliver(stream, consumer, this.event(stream, "resync-required"));
            consumer.active = false;
          }
        }, this.limits.defaultResponseTimeoutMs);
        deadline.unref();
        void this.refresh(stream, generation, controller).finally(() => {
          clearTimeout(deadline);
          this.reads--;
          stream.reading = undefined;
          stream.readingBaseline = undefined;
          this.schedule();
        });
      }
    });
  }

  private async refresh(
    stream: Stream,
    generation: number,
    controller: AbortController,
  ): Promise<void> {
    try {
      const live = [...stream.consumers.values()].filter((consumer) => consumer.active);
      if (!stream.consumers.size || this.stopped || controller.signal.aborted) return;
      const forceSnapshot =
        stream.forceSnapshot ||
        stream.sequence === 0 ||
        [...stream.consumers.values()].some(
          (consumer) => consumer.active && consumer.needsSnapshot,
        );
      stream.forceSnapshot = false;
      stream.readingBaseline = forceSnapshot;
      const owner = live[0]?.owner;
      if (!owner) return;
      const snapshot = await this.options.load(
        stream.target,
        stream.principalId,
        controller.signal,
        {
          forceSnapshot,
          revision: forceSnapshot ? undefined : stream.revision,
          authorized: owner.executionAuthorized ?? owner.authorized,
        },
      );
      if (
        this.stopped ||
        stream.deleted ||
        generation !== stream.generation ||
        controller.signal.aborted
      )
        return;
      // Check each consumer once, after the asynchronous load. This also checks
      // unchanged refreshes and rejects revocation during a protected read.
      const authorized = new Set<Consumer>();
      for (const consumer of live) {
        if (await consumer.owner.authorized()) authorized.add(consumer);
        else this.detach(consumer.owner.connectionId);
      }
      if (!stream.consumers.size) return;
      if (!snapshot) {
        this.tombstone(stream);
        return;
      }
      if (snapshot.kind === "unchanged") {
        if (forceSnapshot || snapshot.revision !== stream.revision)
          throw new Error("A fresh stream baseline is required.");
        return;
      }
      if (snapshot.kind === "delta" && (forceSnapshot || snapshot.baseRevision !== stream.revision))
        throw new Error("Stream delta does not follow its committed baseline.");
      const text = JSON.stringify(JsonValueSchema.parse(snapshot.data));
      if (Buffer.byteLength(text) + 1024 > this.limits.streamChunkBytes)
        throw new Error("Stream snapshot requires a bounded bulk descriptor.");
      const fingerprint = createHash("sha256").update(text).digest("hex");
      if (!forceSnapshot && fingerprint === stream.fingerprint && stream.events.length) return;
      stream.sequence++;
      if (!Number.isSafeInteger(stream.sequence)) throw new Error("Stream cursor exhausted.");
      const revision =
        snapshot.revision === undefined ? undefined : SafeCounterSchema.parse(snapshot.revision);
      const event = {
        ...this.event(stream, snapshot.kind ?? "snapshot", JSON.parse(text), revision),
        ...(snapshot.baseRevision === undefined
          ? {}
          : { baseRevision: SafeCounterSchema.parse(snapshot.baseRevision) }),
      };
      const retained = { event, bytes: Buffer.byteLength(JSON.stringify(event)), at: this.now() };
      stream.events.push(retained);
      stream.bytes += retained.bytes;
      this.bytes += retained.bytes;
      stream.fingerprint = fingerprint;
      stream.revision = revision;
      stream.touched = this.now();
      this.prune();
      for (const consumer of stream.consumers.values()) {
        if (!authorized.has(consumer)) continue;
        if (this.stopped || stream.deleted || generation !== stream.generation) return;
        this.deliver(stream, consumer, event);
      }
    } catch {
      if (!this.stopped && !stream.deleted && generation === stream.generation) {
        stream.forceSnapshot = true;
        stream.dirty = true;
        for (const consumer of stream.consumers.values()) {
          this.deliver(stream, consumer, this.event(stream, "resync-required"));
          consumer.active = false;
        }
      }
    }
  }

  private tombstone(stream: Stream): void {
    stream.generation++;
    stream.deleted = true;
    stream.dirty = false;
    stream.reading?.abort();
    this.bytes -= stream.bytes;
    stream.bytes = 0;
    stream.events = [];
    stream.fingerprint = undefined;
    stream.revision = undefined;
    stream.epoch = randomUUID();
    stream.sequence = 0;
    stream.touched = this.now();
    for (const [identity, consumer] of stream.consumers) {
      this.deliver(stream, consumer, this.event(stream, "closed", { reason: "deleted" }));
      consumer.active = false;
      consumer.pending.clear();
      consumer.bytes = 0;
      this.remove(identity);
    }
  }

  private remove(identity: string): boolean {
    const entry = this.subscriptions.get(identity);
    if (!entry) return false;
    entry.consumer.active = false;
    entry.stream.consumers.delete(identity);
    entry.stream.touched = this.now();
    this.subscriptions.delete(identity);
    return true;
  }

  private shift(stream: Stream): void {
    const event = stream.events.shift();
    if (event) {
      stream.bytes -= event.bytes;
      this.bytes -= event.bytes;
    }
  }

  private drop(stream: Stream): void {
    this.bytes -= stream.bytes;
    this.streams.delete(stream.key);
  }

  private prune(): void {
    const now = this.now();
    for (const stream of this.streams.values()) {
      while (
        stream.events.length &&
        (stream.events.length > this.limits.maxReplayEvents ||
          stream.bytes > this.limits.maxReplayBytes ||
          now - stream.events[0].at > this.limits.maxReplayAgeMs)
      )
        this.shift(stream);
      if (
        !stream.consumers.size &&
        !stream.reading &&
        now - stream.touched > this.limits.maxReplayAgeMs
      )
        this.drop(stream);
    }
    while (this.bytes > this.limits.maxHostReplayBytes) {
      let oldest: Stream | undefined;
      for (const stream of this.streams.values())
        if (stream.events.length && (!oldest || stream.events[0].at < oldest.events[0].at))
          oldest = stream;
      if (!oldest) break;
      this.shift(oldest);
    }
  }
}
