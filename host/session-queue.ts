import { randomInt, randomUUID } from "node:crypto";
import type { StoreDatabase } from "./store-db";
import type { RemoteQueue } from "../src/features/connections/model/remoteQueue";
import {
  mergeQueueChange,
  QUEUE_LEASE_TTL_MS,
  sameQueueValue,
  type DrainLease,
  type SharedQueue,
} from "../src/features/connections/model/sharedQueue";
import { restoreQueuedMessages } from "../src/features/sessions/model/queuePersistence";
/** The drain lease belongs to someone else, ended, or the epoch moved on. Nothing was sent. */
export class QueueLeaseError extends Error {
  constructor(message = "The queue drain lease changed. Refresh it before sending.") {
    super(message);
    this.name = "QueueLeaseError";
  }
}
/** What the asker of a send can prove. Older clients know no leases or epochs. */
export type SendAuthority = {
  epoch?: number;
  legacy?: boolean;
};
/**
 * A send in flight is never given up on at once: its sender may simply have no
 * lease (a steer, an older client) or have just lost it to a takeover. Past the
 * grace, a claim whose sender no longer holds the lease is reaped as unconfirmed.
 * A sender that does hold the lease is believed only up to the maximum, so a
 * hung window that keeps renewing cannot hold the queue (and every send from
 * another computer) forever.
 */
export const CLAIM_GRACE_MS = 15000;
/** Older clients renew their lease only by calling in, and sends can be slow. */
export const CLAIM_LEGACY_GRACE_MS = 60000;
export const CLAIM_MAX_MS = 120000;
/**
 * A lease holder whose queue the host could have sent for this long (the
 * conversation is free, the head is not being sent or edited), without the
 * holder claiming anything, is not making progress (a hung or hidden window):
 * the host stops renewing its lease and sends the row itself. A hidden window
 * answers within a minute, so this is longer than one beat.
 */
export const QUEUE_STALL_MS = 60000;
/**
 * A live lease is written again once this much of it is used. Short enough that
 * the slowest documented cadence (a throttled window, ~60 s) always renews with
 * time to spare; long enough that a fast heartbeat does not write per beat.
 */
export const QUEUE_RENEW_AFTER_MS = 15000;
/** Fields the host keeps beyond the shared shape; clients that do not know them ignore them. */
type StoredClaim = NonNullable<SharedQueue["claim"]> & {
  at?: number;
  legacy?: true;
};
type StoredLease = DrainLease & {
  legacy?: true;
};
type StoredSettled = NonNullable<SharedQueue["settled"]> & {
  prior?: "active";
};
type StoredQueue = SharedQueue & {
  holdReason?: string;
};
/** Separate durable state: provider snapshots and desktop refreshes cannot erase it. */
export class SessionQueues {
  /** Called after a queue was stored or deleted (not for lease renewals). */
  onChange?: (id: string) => void;
  /** When the host must look at a queue again (a lease ends, a claim becomes reapable), for its one timer. */
  private readonly leases = new Map<string, number>();
  /**
   * Cursors are `boot + n`: this run's `boot` is random, so the cursor of a
   * client that last spoke to another run (the host restarted) is outside
   * `[floor, sequence]` and gets `reset`, however few changes both runs saw.
   */
  readonly boot: string;
  private sequence: number;
  private floor: number;
  readonly ready: Promise<void>;
  constructor(
    private readonly db: StoreDatabase,
    private readonly now: () => number = Date.now,
    boot: number = randomInt(1, 2 ** 20) * 2 ** 32,
  ) {
    this.sequence = this.floor = boot;
    this.boot = boot.toString(16);
    this.ready = this.db.scope(async () => await this.initialize(this.db));
    void this.ready.catch(() => undefined);
  }
  private async initialize(db: StoreDatabase): Promise<void> {
    await db.exec(
      "CREATE TABLE IF NOT EXISTS session_queues (session_id TEXT PRIMARY KEY, payload TEXT NOT NULL)",
    );
    await db.exec(
      "CREATE TABLE IF NOT EXISTS session_queue_removed (session_id TEXT NOT NULL, message_id TEXT NOT NULL, PRIMARY KEY(session_id, message_id))",
    );
    await this.migrate();
    for (const row of await this.db.prepare("SELECT session_id, payload FROM session_queues").all())
      this.schedule(String(row.session_id), JSON.parse(String(row.payload)) as SharedQueue);
  }
  /**
   * Rows written before leases carry a permanent `consumer` that died with its
   * process. They become unleased. A queue that was waiting on such an owner is
   * held for the owner's Resume instead of being sent without anyone asking:
   * `restored` is no longer a stored state either.
   */
  private async migrate(): Promise<void> {
    for (const row of await this.db
      .prepare("SELECT session_id, payload FROM session_queues")
      .all()) {
      const queue = JSON.parse(String(row.payload)) as SharedQueue;
      const owned = "consumer" in queue;
      if (!owned && queue.status !== "restored") continue;
      delete queue.consumer;
      if (!queue.messages.length) queue.status = undefined;
      else if (["active", "resuming", "restored"].includes(String(queue.status)))
        queue.status = "paused";
      await this.db
        .prepare("UPDATE session_queues SET payload=? WHERE session_id=?")
        .run(JSON.stringify({ ...queue, revision: queue.revision + 1 }), row.session_id);
    }
  }
  /** Queues the host may have to look at: rows waiting that nobody has paused, or a send in flight. */
  async pending(): Promise<string[]> {
    return this.db.scope(async () => {
      await this.ready;
      const ids: string[] = [];
      for (const row of await this.db
        .prepare("SELECT session_id, payload FROM session_queues")
        .all()) {
        const queue = JSON.parse(String(row.payload)) as SharedQueue;
        if (queue.claim || (queue.messages.length && queue.status === "active"))
          ids.push(String(row.session_id));
      }
      return ids;
    });
  }
  /** Whether the lease is live: only then does its holder, not the host, drain. */
  live(queue: SharedQueue): boolean {
    return !!queue.drain && queue.drain.expiresAt > this.now();
  }
  /** Earliest expiry of a live lease, for the host's single timer. */
  nextLeaseExpiry(): number | undefined {
    let earliest: number | undefined;
    for (const at of this.leases.values()) earliest = Math.min(earliest ?? at, at);
    return earliest;
  }
  /** Queues whose lease ended or whose claim became reapable; the next such moment is armed again. */
  async takeExpired(): Promise<string[]> {
    return this.db.scope(async () => {
      await this.ready;
      const ids: string[] = [];
      for (const [id, at] of [...this.leases])
        if (at <= this.now()) {
          ids.push(id);
          this.leases.delete(id);
        }
      for (const id of ids) this.schedule(id, await this.get(id));
      return ids;
    });
  }
  /** The next moment after now that `queue` needs a look: its lease ends or its claim is reapable. */
  private schedule(id: string, queue: SharedQueue): void {
    const times: number[] = [];
    if (this.live(queue) && queue.messages.length) times.push(queue.drain!.expiresAt);
    const deadline = this.claimDeadline(queue);
    if (deadline !== undefined && Number.isFinite(deadline)) times.push(deadline);
    const next = Math.min(...times.filter((at) => at > this.now()));
    if (Number.isFinite(next)) this.leases.set(id, next);
    else this.leases.delete(id);
  }
  /** Whether the claim's sender holds the lease it claimed under. */
  private holds(queue: SharedQueue, claim: StoredClaim): boolean {
    return (
      this.live(queue) &&
      queue.drain!.holder === claim.clientId &&
      (claim.epoch === undefined || queue.drain!.epoch === claim.epoch)
    );
  }
  /** From when a claim may be given up on (`Infinity`: while its sender holds the lease). */
  private claimDeadline(queue: SharedQueue): number | undefined {
    const claim = queue.claim as StoredClaim | undefined;
    if (!claim) return undefined;
    const held = this.holds(queue, claim);
    // Claims stored before they carried a time are believed while their sender holds the lease.
    if (claim.at === undefined) return held ? Infinity : 0;
    return claim.at + (held ? CLAIM_MAX_MS : claim.legacy ? CLAIM_LEGACY_GRACE_MS : CLAIM_GRACE_MS);
  }
  /** What a client is told. A client that says it is `leaseAware` gets the lease;
   * an older one sees the live holder as its `consumer`, as it always did. */
  view(queue: SharedQueue, aware: boolean): SharedQueue {
    if (aware) return { ...queue, leased: true, hostTime: this.now() };
    return this.live(queue) ? { ...queue, consumer: queue.drain!.holder } : queue;
  }
  /**
   * One queue call as the host serves it, after the caller checked who may ask.
   * Clients that say `leaseAware` get the lease. An older client is served as it
   * always was: it sees the live holder as `consumer`, owns the queue by asking
   * (a takeover), and every call it makes keeps its lease alive.
   */
  async serve(
    action: "get" | "change" | "claim" | "finish" | "lease" | "release",
    id: string,
    clientId: string,
    params: Record<string, unknown>,
    change?: {
      before: unknown;
      after: unknown;
    },
  ): Promise<SharedQueue> {
    return this.db.scope(async () => {
      await this.ready;
      const aware = params.leaseAware === true;
      const epoch = Number.isSafeInteger(params.epoch) ? Number(params.epoch) : undefined;
      if (!aware) await this.renew(id, clientId);
      let queue: SharedQueue;
      if (action === "get") queue = await this.get(id);
      else if (action === "lease") {
        if (!aware || !clientId.startsWith("desktop:"))
          throw new Error("Only a desktop that knows drain leases can hold one.");
        queue = await this.acquire(id, clientId, params.takeover === true);
      } else if (action === "release") {
        // A closing window gives its lease back so nobody waits for it to run out.
        if (!aware || !clientId.startsWith("desktop:"))
          throw new Error("Only a desktop that knows drain leases can hold one.");
        await this.release(id, clientId, epoch);
        queue = await this.get(id);
      } else if (action === "change") {
        queue = await this.change(
          id,
          change?.before,
          change?.after,
          // Only older clients ask for ownership while changing; the others take
          // the lease with `lease`.
          params.takeOwnership === true && !aware ? clientId : undefined,
        );
        // Mobile now asks the home host to drain. Give back only the legacy lease
        // this exact client acquired with an older queue action, never another
        // sender's authority or a row whose delivery is already in flight.
        if (
          aware &&
          clientId.startsWith("mobile:") &&
          queue.status === "active" &&
          !queue.claim &&
          !queue.editingId &&
          queue.drain?.holder === clientId &&
          (queue.drain as StoredLease).legacy === true
        ) {
          await this.release(id, clientId, queue.drain.epoch);
          queue = await this.get(id);
        }
      } else if (action === "claim") {
        if (!clientId.startsWith("desktop:"))
          throw new Error("Only the owning desktop claims local sends.");
        queue = await this.claim(
          id,
          String(params.id ?? ""),
          clientId,
          Number(params.revision),
          params.steer === true,
          { epoch, legacy: !aware },
        );
      } else
        queue = await this.finish(id, String(params.token ?? ""), params.accepted === true, epoch);
      return this.view(queue, aware);
    });
  }
  /** Which queues changed, newest last, so a desktop that polls for it can
   * re-read exactly those instead of re-reading every idle queue on a timer. */
  private readonly changed = new Map<string, number>();
  /** Queue ids changed after `since`. A cursor this host never issued (it
   * restarted) or already forgot cannot be answered precisely: `reset`. */
  changesSince(since: unknown): {
    seq: number;
    ids: string[];
    boot: string;
    reset?: true;
  } {
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
  private noteChange(id: string): void {
    this.changed.delete(id);
    this.changed.set(id, ++this.sequence);
    while (this.changed.size > 512) {
      const oldest = this.changed.entries().next().value!;
      this.changed.delete(oldest[0]);
      this.floor = Math.max(this.floor, oldest[1]);
    }
  }
  async get(id: string): Promise<SharedQueue> {
    return this.db.scope(async () => {
      await this.ready;
      const row = await this.db
        .prepare("SELECT payload FROM session_queues WHERE session_id=?")
        .get(id);
      return row ? (JSON.parse(String(row.payload)) as SharedQueue) : { messages: [], revision: 0 };
    });
  }
  private async save(id: string, queue: SharedQueue): Promise<SharedQueue> {
    const next = { ...queue, revision: queue.revision + 1 };
    // Nothing left to send: nobody needs to hold the queue.
    if (!next.messages.length && next.drain && next.drain.expiresAt > 0)
      next.drain = { ...next.drain, expiresAt: 0 };
    await this.db
      .prepare(
        "INSERT INTO session_queues VALUES (?, ?) ON CONFLICT(session_id) DO UPDATE SET payload=excluded.payload",
      )
      .run(id, JSON.stringify(next));
    this.db.afterCommit(() => {
      this.schedule(id, next);
      this.noteChange(id);
      this.onChange?.(id);
    });
    return next;
  }
  /** Whether the head of the queue could be sent right now by whoever holds it: nothing is in flight or being edited. */
  async sendable(id: string): Promise<boolean> {
    return this.db.scope(async () => {
      await this.ready;
      const queue = await this.get(id);
      const head = queue.messages[0];
      return (
        !!head &&
        queue.status === "active" &&
        !queue.claim &&
        !queue.editingId &&
        !head.deliveryUnknown
      );
    });
  }
  /** A lease for `holder`: a new epoch unless the holder already has a live one. */
  private grant(queue: SharedQueue, holder: string, legacy = false): DrainLease {
    const drain = queue.drain;
    if (drain && drain.holder === holder && this.live(queue))
      return { ...drain, expiresAt: this.now() + QUEUE_LEASE_TTL_MS };
    return {
      holder,
      epoch: (drain?.epoch ?? 0) + 1,
      expiresAt: this.now() + QUEUE_LEASE_TTL_MS,
      ...(legacy ? { legacy: true } : {}),
    } as StoredLease;
  }
  /** The holder gives its lease back (or the host takes it from a holder that makes no progress). */
  async release(id: string, holder: string, epoch?: number): Promise<null> {
    return this.db.scope(async () => {
      await this.ready;
      const queue = await this.get(id);
      const drain = queue.drain;
      if (
        drain &&
        drain.holder === holder &&
        (epoch === undefined || drain.epoch === epoch) &&
        this.live(queue)
      )
        await this.save(id, { ...queue, drain: { ...drain, expiresAt: 0 } });
      return null;
    });
  }
  /**
   * A send whose sender is gone (its lease ended or moved on) has no
   * acknowledgement: the row is held as unconfirmed and the queue paused. It is
   * never sent again on its own; the sender may still settle it with its token.
   */
  async reapStale(id: string): Promise<SharedQueue> {
    return this.db.scope(async () => {
      await this.ready;
      const queue = await this.get(id);
      const claim = queue.claim;
      if (!claim || this.now() < this.claimDeadline(queue)!) return queue;
      return await this.save(id, {
        ...queue,
        messages: queue.messages.map((row) =>
          row.id === claim.id ? { ...row, deliveryUnknown: true } : row,
        ),
        status: "paused",
        claim: undefined,
        settled: {
          token: claim.token,
          clientId: claim.clientId,
          accepted: false,
          reaped: true,
          id: claim.id,
          // What the queue was before the doubt paused it, to restore it if the
          // sender comes back and says the row was delivered.
          ...(queue.status === "active" ? { prior: "active" } : {}),
        } as StoredSettled,
      });
    });
  }
  /**
   * Gives `holder` the drain lease. A live lease of someone else is refused
   * unless this is an explicit takeover (new epoch). The holder's own live lease
   * is only extended. A queue with nothing in it needs no holder.
   */
  async acquire(id: string, holder: string, takeover = false): Promise<SharedQueue> {
    return this.db.scope(async () => {
      await this.ready;
      const queue = await this.get(id);
      if (!queue.messages.length) return queue;
      if (this.live(queue) && queue.drain!.holder !== holder && !takeover)
        throw new QueueLeaseError("Another window holds this queue's drain lease.");
      if (this.live(queue) && queue.drain!.holder === holder) {
        await this.renew(id, holder, queue.drain!.epoch);
        return await this.get(id);
      }
      const current = await this.reapStale(id);
      return await this.save(id, { ...current, drain: this.grant(current, holder) });
    });
  }
  /**
   * Extends a live lease that `holder` still has at `epoch`. Returns the lease,
   * or null when it was lost (expired, taken over, or the queue is empty). The
   * stored expiry only moves once `RENEW_AFTER_MS` of it is used, so the
   * heartbeat costs a write every ~15 s per held queue, not one per beat, while
   * a hidden window that beats once a minute still finds a lease to renew.
   */
  async renew(id: string, holder: string, epoch?: number): Promise<DrainLease | null> {
    return this.db.scope(async () => {
      await this.ready;
      const queue = await this.get(id);
      const drain = queue.drain;
      if (
        !drain ||
        drain.holder !== holder ||
        (epoch !== undefined && drain.epoch !== epoch) ||
        !queue.messages.length ||
        !this.live(queue)
      )
        return null;
      if (drain.expiresAt - this.now() >= QUEUE_LEASE_TTL_MS - QUEUE_RENEW_AFTER_MS) return drain;
      const renewed = { ...drain, expiresAt: this.now() + QUEUE_LEASE_TTL_MS };
      await this.db
        .prepare("UPDATE session_queues SET payload=? WHERE session_id=?")
        .run(JSON.stringify({ ...queue, drain: renewed }), id);
      this.schedule(id, { ...queue, drain: renewed });
      return renewed;
    });
  }
  /** The host's own hold: a send it started was refused or its turn failed, so the owner decides. */
  async hold(id: string, reason?: string): Promise<SharedQueue> {
    return this.db.scope(async () => {
      await this.ready;
      const queue = await this.get(id);
      if (queue.status === "paused") return queue;
      return await this.save(id, {
        ...queue,
        status: "paused",
        ...(reason ? { holdReason: reason.slice(0, 500) } : {}),
      } as StoredQueue);
    });
  }
  /** `owner` asks to own the queue the way older clients do: a takeover. */
  async change(id: string, before: unknown, after: unknown, owner?: string): Promise<SharedQueue> {
    return this.db.scope(async () => {
      await this.ready;
      const current = await this.get(id);
      const old = this.parse(before);
      const incoming = this.parse(after);
      const accepted: typeof incoming.messages = [];
      for (const row of incoming.messages) {
        if (
          old.messages.some((entry) => entry.id === row.id) ||
          !(await this.db
            .prepare("SELECT 1 FROM session_queue_removed WHERE session_id=? AND message_id=?")
            .get(id, row.id))
        )
          accepted.push(row);
      }
      incoming.messages = accepted;
      const next = mergeQueueChange(current, { before: old, after: incoming }) as StoredQueue;
      // An older client owns the queue by asking, but never takes a live lease from
      // a window that holds it as a lease (that is an explicit takeover).
      const held = this.live(current) ? (current.drain as StoredLease) : undefined;
      if (owner && next.messages.length && (!held || held.holder === owner || held.legacy))
        next.drain = this.grant(current, owner, true);
      // The owner decided about the queue's state: a hold's reason and a late
      // acknowledgement's restore no longer apply.
      if (next.status !== "paused") delete next.holdReason;
      if ((current.settled as StoredSettled | undefined)?.prior && old.status !== incoming.status)
        next.settled = { ...next.settled!, prior: undefined } as StoredSettled;
      if (next.messages.length > 100 || Buffer.byteLength(JSON.stringify(next)) > 3 * 1024 * 1024)
        throw new Error("Shared queue is full.");
      for (const row of current.messages)
        if (!next.messages.some((entry) => entry.id === row.id)) await this.removed(id, row.id);
      return sameQueueValue(current, next) ? current : await this.save(id, next);
    });
  }
  private parse(raw: unknown): RemoteQueue {
    if (!raw || typeof raw !== "object") throw new Error("Invalid queue");
    const value = raw as RemoteQueue;
    if (!Array.isArray(value.messages) || value.messages.length > 100)
      throw new Error("Invalid queue messages");
    const messages = restoreQueuedMessages(value.messages);
    if (
      messages.length !== value.messages.length ||
      new Set(messages.map((row) => row.id)).size !== messages.length
    )
      throw new Error("Invalid queued message");
    if (
      value.status !== undefined &&
      !["active", "paused", "restored", "resuming"].includes(value.status)
    )
      throw new Error("Invalid queue status");
    if (
      value.editingId !== undefined &&
      (typeof value.editingId !== "string" || !messages.some((row) => row.id === value.editingId))
    )
      throw new Error("Invalid queued edit");
    // A shared queue is never "restored": an owner's wait is a pause.
    return {
      messages,
      status: value.status === "restored" ? "paused" : value.status,
      editingId: value.editingId,
    };
  }
  async assertSend(
    id: string,
    rowId: string,
    clientId: string,
    revision: number,
    steer = false,
    authority: SendAuthority = {},
  ): Promise<SharedQueue> {
    return this.db.scope(async () => {
      await this.ready;
      const queue = await this.get(id);
      if (this.live(queue)) {
        const drain = queue.drain!;
        if (
          drain.holder !== clientId ||
          (authority.epoch !== undefined && drain.epoch !== authority.epoch)
        )
          throw new QueueLeaseError();
      } else if (!steer && !authority.legacy) throw new QueueLeaseError();
      if (
        queue.revision !== revision ||
        queue.claim ||
        queue.editingId ||
        (!steer && queue.status !== "active") ||
        !queue.messages.some((row) => row.id === rowId && !row.deliveryUnknown) ||
        (!steer && queue.messages[0]?.id !== rowId)
      )
        throw new Error("The shared queue changed. Refresh it before sending.");
      return queue;
    });
  }
  async claim(
    id: string,
    rowId: string,
    clientId: string,
    revision: number,
    steer = false,
    authority: SendAuthority = {},
  ): Promise<SharedQueue> {
    return this.db.scope(async () => {
      await this.ready;
      const queue = await this.assertSend(id, rowId, clientId, revision, steer, authority);
      // An older client sends under a lease it never asked for: hold one for the send.
      const drain =
        authority.legacy && !this.live(queue) ? this.grant(queue, clientId, true) : queue.drain;
      return await this.save(id, {
        ...queue,
        drain,
        claim: {
          id: rowId,
          clientId,
          token: randomUUID(),
          epoch: drain?.epoch,
          at: this.now(),
          ...(authority.legacy ? { legacy: true } : {}),
        } as StoredClaim,
      });
    });
  }
  async finish(id: string, token: string, accepted: boolean, epoch?: number): Promise<SharedQueue> {
    return this.db.scope(async () => {
      await this.ready;
      const queue = await this.get(id);
      if (queue.settled?.token === token && queue.settled.accepted === accepted) return queue;
      const given = queue.settled?.token === token ? queue.settled : undefined;
      if (given?.reaped && given.id) {
        // The sender came back after its send was given up as unconfirmed.
        if (!accepted)
          return await this.save(id, { ...queue, settled: { ...given, accepted: false } });
        await this.removed(id, given.id);
        const messages = queue.messages.filter((row) => row.id !== given.id);
        // The doubt about this row is what paused the queue: with it settled, the
        // queue goes on as it was, unless its owner decided something meanwhile.
        const resume =
          (given as StoredSettled).prior === "active" &&
          queue.status === "paused" &&
          !queue.editingId &&
          !messages.some((row) => row.deliveryUnknown);
        return await this.save(id, {
          ...queue,
          messages,
          status: !messages.length ? undefined : resume ? "active" : queue.status,
          editingId: messages.length ? queue.editingId : undefined,
          settled: { ...given, accepted: true, prior: undefined } as StoredSettled,
        });
      }
      if (queue.claim?.token !== token)
        throw new Error("Queued send no longer belongs to this client.");
      if (epoch !== undefined && queue.claim.epoch !== undefined && queue.claim.epoch !== epoch)
        throw new QueueLeaseError();
      const messages = accepted
        ? queue.messages.filter((row) => row.id !== queue.claim!.id)
        : queue.messages;
      if (accepted) await this.removed(id, queue.claim.id);
      return await this.save(id, {
        ...queue,
        messages,
        status: messages.length ? queue.status : undefined,
        settled: { token, clientId: queue.claim.clientId, accepted },
        claim: undefined,
      });
    });
  }
  async consumed(id: string, rowId: string): Promise<SharedQueue> {
    return this.db.scope(async () => {
      await this.ready;
      const queue = await this.get(id);
      const messages = queue.messages.filter((row) => row.id !== rowId);
      await this.removed(id, rowId);
      return await this.save(id, {
        ...queue,
        messages,
        status: messages.length ? queue.status : undefined,
      });
    });
  }
  async delete(id: string): Promise<void> {
    return this.db.scope(async () => {
      await this.ready;
      await this.db.prepare("DELETE FROM session_queues WHERE session_id=?").run(id);
      await this.db.prepare("DELETE FROM session_queue_removed WHERE session_id=?").run(id);
      this.db.afterCommit(() => {
        this.leases.delete(id);
        this.noteChange(id);
        this.onChange?.(id);
      });
    });
  }
  private async removed(id: string, rowId: string): Promise<void> {
    await this.db
      .prepare("INSERT OR IGNORE INTO session_queue_removed VALUES (?, ?)")
      .run(id, rowId);
  }
}
