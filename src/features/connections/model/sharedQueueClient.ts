import { persistableQueue } from "../../sessions/model/queuePersistence";
import { cachedRemoteCapabilities, remoteRequest } from "./connections";
import {
  ATTACHMENT_OWNERSHIP_CAPABILITY,
  attachmentOwnerId,
  attachmentOwnershipScope,
  retireClosedAttachmentOwners,
  type AttachmentOwnership,
} from "./attachmentOwnership";
import { globalDesktopAttachmentInventory } from "./desktopAttachmentInventory";
import { uploadRemoteAttachments } from "./remoteAttachments";
import {
  leaseLive,
  mergeQueueChange,
  sameQueueValue,
  type DrainLease,
  type SharedQueue,
} from "./sharedQueue";
import { desktopInstanceId } from "./desktopInstance";
import type { RemoteQueue } from "./remoteQueue";

export type QueueTransport = <T>(method: string, params: Record<string, unknown>) => Promise<T>;
export const queueClientId = `remote:${crypto.randomUUID()}`;
/** One identity per desktop window, kept across restarts: a restarted app reclaims its queues. */
export const desktopQueueClientId = `desktop:${desktopInstanceId()}`;

/** The host's refusal of a claim made against an outdated queue revision. */
const CLAIM_RACE = /shared queue changed/i;
/** Another window holds the drain lease, or the lease moved on while asking. */
export const LEASE_HELD = /drain lease/i;
const CLAIM_RACE_RETRIES = 3;
/** The host answered that it has no `sessions.queue.release`. */
let releaseUnsupported = false;

/** The durable record of a claimed send, written before and after the provider call. */
type SendJournal = {
  token?: string;
  id?: string;
  clientId: string;
  accepted: boolean | null;
  /** The outcome holds the queue for the owner; a replay pauses only then. */
  held?: boolean;
  /** The owner pressed Stop while this send was unsettled: the queue pauses once it settles. */
  stopped?: boolean;
};

export class SharedQueueClient {
  private base: SharedQueue = { messages: [], revision: 0 };
  private desired: RemoteQueue = this.base;
  private listeners = new Set<() => void>();
  private running?: Promise<void>;
  private syncGeneration = 0;
  private reading = false;
  private takeOwnership = false;
  /** Take the lease from a live holder (an explicit Resume), not only when it is free. */
  private takeover = false;
  /** The host grants leases (an older host names a permanent `consumer`). */
  private leased?: boolean;
  /** Host clock minus this clock, to judge a lease expiry. */
  private skew = 0;
  private conflict = false;
  private hasBaseline = false;
  private state: {
    queue: SharedQueue;
    loaded: boolean;
    error?: string;
    recovery?: string;
    /** Why this window paused the queue itself (a conflicting edit), for the queue banner. */
    notice?: string;
  } = {
    queue: this.base,
    loaded: false,
  };
  private notice?: string;
  private readonly storageKey: string;
  private recovery?: string;
  private attachmentScope?: AttachmentOwnership;
  private recoveredAttachmentOwners = false;
  private recoveredSources: Record<string, string[]> = {};
  private attachmentWrites = Promise.resolve();
  private attachmentFingerprint?: string;
  private attachments() {
    if (!cachedRemoteCapabilities(this.environmentId)?.includes(ATTACHMENT_OWNERSHIP_CAPABILITY))
      return undefined;
    return (this.attachmentScope ??= attachmentOwnershipScope(
      this.machineId,
      this.environmentId,
      attachmentOwnerId("desktop-queue", this.sessionId),
      this.request,
    ));
  }
  constructor(
    readonly machineId: string,
    readonly environmentId: string,
    readonly sessionId: string,
    readonly clientId = queueClientId,
    private readonly request: QueueTransport = (method, params) =>
      remoteRequest(machineId, method, params),
    private readonly upload = uploadRemoteAttachments,
  ) {
    const desktop = clientId.startsWith("desktop:");
    // Every desktop window keeps its own saved queue and send journal: windows share
    // one origin, and a second window must not read the first one's pending edits.
    this.storageKey = `bycoda:shared-queue:v1:${JSON.stringify([environmentId, sessionId, desktop ? "desktop" : "remote"])}`;
    if (desktop) {
      const shared = this.storageKey;
      this.storageKey = `bycoda:shared-queue:v2:${JSON.stringify([environmentId, sessionId, clientId])}`;
      // The first window to start adopts what the single shared key held. The
      // old keys are copied, never removed: an older build still reads them, so
      // a downgrade keeps the pending queue and send journal. The marker keeps
      // the other windows from adopting the same copy.
      const adopted = `${shared}:adopted`;
      if (localStorage.getItem(adopted) === null) {
        let copied = false;
        for (const suffix of ["", ":send"]) {
          const old = localStorage.getItem(shared + suffix);
          if (old !== null && localStorage.getItem(this.storageKey + suffix) === null) {
            localStorage.setItem(this.storageKey + suffix, old);
            copied = true;
          }
        }
        if (copied) localStorage.setItem(adopted, clientId);
      }
    }
    const stored = localStorage.getItem(this.storageKey);
    if (stored) {
      try {
        const value = JSON.parse(stored) as {
          base: SharedQueue;
          desired: RemoteQueue;
          takeOwnership?: boolean;
        };
        if (Array.isArray(value.base.messages) && Array.isArray(value.desired.messages)) {
          this.base = value.base;
          this.hasBaseline = true;
          this.desired = value.desired;
          this.takeOwnership = !!value.takeOwnership;
          this.state = { queue: { ...this.base, ...this.desired }, loaded: false };
        }
      } catch {
        this.state = {
          queue: this.base,
          loaded: false,
          error: "Could not read the saved shared queue.",
        };
      }
    }
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  hold(error: unknown) {
    this.emit(false, String(error).replace(/^Error: /, ""));
  }
  private emit(loaded = this.state.loaded, error?: string) {
    if (this.desired.status !== "paused") this.notice = undefined;
    this.state = {
      queue: { ...this.base, ...this.desired },
      loaded,
      ...(error ? { error } : {}),
      recovery: this.recovery,
      ...(this.notice && this.desired.status === "paused" ? { notice: this.notice } : {}),
    };
    this.listeners.forEach((listener) => listener());
  }
  private dirty() {
    return !sameQueueValue(this.fields(this.base), this.fields(this.desired)) || this.takeOwnership;
  }
  private fields(queue: RemoteQueue): RemoteQueue {
    return { messages: queue.messages, status: queue.status, editingId: queue.editingId };
  }
  private persist() {
    localStorage.setItem(
      this.storageKey,
      JSON.stringify({
        base: this.base,
        desired: {
          ...this.fields(this.desired),
          messages: persistableQueue(this.desired.messages) ?? [],
        },
        takeOwnership: this.takeOwnership,
      }),
    );
    this.hasBaseline = true;
    if (this.attachmentScope) {
      const scope = this.attachmentScope;
      const savedSources = {
        queue: this.desired.messages.flatMap((row) => row.attachments.map((file) => file.id)),
        cache: this.base.messages.flatMap((row) => row.attachments.map((file) => file.id)),
      };
      this.attachmentWrites = this.attachmentWrites
        .catch(() => {})
        .then(async () => {
          const fingerprint = JSON.stringify(
            Object.values(savedSources).map((ids) => [...new Set(ids)].sort()),
          );
          if (
            this.attachmentFingerprint === fingerprint &&
            !Object.values(this.recoveredSources).some((ids) => ids.length)
          ) {
            await scope.retry();
            return;
          }
          if (
            !this.recoveredAttachmentOwners ||
            Object.values(this.recoveredSources).some((ids) => ids.length)
          ) {
            const global = await globalDesktopAttachmentInventory(
              this.sessionId,
              this.environmentId,
            );
            const recovered = Object.fromEntries(
              Object.entries(global).map(([key, ids]) => [`recovered:${key}`, ids]),
            );
            if (!this.recoveredAttachmentOwners) {
              const retired = await retireClosedAttachmentOwners(
                this.machineId,
                this.environmentId,
                scope,
                recovered,
                this.request,
              );
              this.recoveredSources =
                retired || scope.sourceNames().some((source) => source.startsWith("recovered:"))
                  ? recovered
                  : {};
              this.recoveredAttachmentOwners = true;
            } else this.recoveredSources = recovered;
          }
          await scope.reconcileDurable({ ...savedSources, ...this.recoveredSources });
          this.attachmentFingerprint = fingerprint;
        });
      void this.attachmentWrites.catch(() => {});
    }
  }
  update(change: (queue: RemoteQueue) => RemoteQueue, takeOwnership = false): boolean {
    if (!this.state.loaded || this.conflict || this.base.claim) return false;
    const before = this.desired;
    this.desired = change(before);
    const ownership = this.takeOwnership;
    const takeover = this.takeover;
    if (takeOwnership) this.takeover = true;
    this.takeOwnership ||=
      takeOwnership || (this.mayHold() && !this.holder() && !!this.desired.messages.length);
    try {
      this.persist();
    } catch (error) {
      this.desired = before;
      this.takeOwnership = ownership;
      this.takeover = takeover;
      this.emit(true, `Could not save the queued message: ${String(error)}`);
      return false;
    }
    this.emit();
    void this.sync().catch(() => {});
    return true;
  }
  /** A desktop can change while a poll is in flight. Preserve its delta before painting the host result. */
  mergeLocal(before: RemoteQueue, after: RemoteQueue, takeOwnership = false): boolean {
    const canonical = (queue: RemoteQueue): RemoteQueue => ({
      ...queue,
      messages: queue.messages.map((row) => ({
        ...row,
        attachments: row.attachments.map((file) => {
          const shared = this.desired.messages
            .find((entry) => entry.id === row.id)
            ?.attachments.find((entry) => entry.id === file.id);
          return shared?.hostEnvironmentId
            ? {
                ...file,
                path: shared.path,
                hostEnvironmentId: shared.hostEnvironmentId,
                data: undefined,
                previewUrl: undefined,
                missing: undefined,
              }
            : file;
        }),
      })),
    });
    try {
      return this.update(
        (queue) =>
          mergeQueueChange(
            { ...this.base, ...queue },
            { before: canonical(before), after: canonical(after) },
          ),
        takeOwnership,
      );
    } catch (error) {
      const changed = after.messages.filter(
        (row) =>
          !sameQueueValue(
            before.messages.find((entry) => entry.id === row.id),
            row,
          ),
      );
      this.desired = {
        ...this.desired,
        messages: [
          ...this.desired.messages,
          ...changed.map((row) => ({ ...row, id: crypto.randomUUID() })),
        ],
        status: "paused",
        editingId: undefined,
      };
      this.conflict = true;
      this.notice =
        "Another computer changed a queued message you also changed. Your version was kept as a new message.";
      this.persist();
      this.emit(true, String(error).replace(/^Error: /, ""));
      return true;
    }
  }
  async initialize(legacy?: RemoteQueue): Promise<void> {
    try {
      await this.recoverAcknowledgement();
      if (!this.dirty()) {
        const previous = this.hasBaseline ? this.base : undefined;
        const value = await this.call<SharedQueue>("get");
        this.base = value;
        this.desired = value;
        // A nonzero revision includes an empty, previously consumed queue.
        // Old device backups must never resurrect those messages.
        if (!value.revision && legacy?.messages.length) {
          this.desired = { ...legacy, status: legacy.status ?? "paused" };
          this.takeOwnership = true;
          this.persist();
        } else if (previous && legacy && this.clientId.startsWith("desktop:")) {
          this.emit(true);
          this.mergeLocal(
            { ...previous, status: value.status, editingId: value.editingId },
            {
              messages: legacy.messages,
              status: value.status ?? legacy.status,
              editingId: value.editingId,
            },
          );
        }
      }
      this.emit(true);
      await this.sync();
    } catch (error) {
      this.emit(this.state.loaded, String(error).replace(/^Error: /, ""));
    }
  }
  private async call<T>(
    action: string,
    params: Record<string, unknown> = {},
    current = () => true,
  ): Promise<T> {
    const scope = this.attachments();
    const claimId = scope?.cacheClaimId();
    const result = await this.request<T>(`sessions.queue.${action}`, {
      sessionId: this.sessionId,
      clientId: this.clientId,
      leaseAware: true,
      ...(scope ? { ownerId: scope.ownerId, claimId } : {}),
      ...params,
    }).catch((error) => {
      this.attachmentFingerprint = undefined;
      throw error;
    });
    this.learn(result);
    if (!current()) {
      if (scope) {
        // The host may have exported attachment claims with this old view.
        // Reconcile those against the current durable inventory, never adopt
        // the stale view as the current cache source.
        this.attachmentFingerprint = undefined;
        this.persist();
      }
      return result;
    }
    if (scope && claimId)
      await scope
        .adoptClaimed(
          "cache",
          (result as SharedQueue).messages.flatMap((row) => row.attachments.map((file) => file.id)),
          claimId,
        )
        .catch((error) => {
          this.attachmentFingerprint = undefined;
          throw error;
        });
    return result;
  }
  private async wire(queue: RemoteQueue): Promise<RemoteQueue> {
    const messages = [];
    for (const row of queue.messages) {
      const refs = await this.upload(this.machineId, row.attachments, {
        ownership: this.attachments(),
        ownershipSource: `queue-upload:${row.id}`,
        environmentId: this.environmentId,
        resumable: true,
      });
      messages.push({
        ...row,
        attachments: refs.map((file) => ({ ...file, hostEnvironmentId: this.environmentId })),
      });
    }
    return { ...this.fields(queue), messages };
  }
  async sync(interactive = false): Promise<void> {
    // Only a background read may be overtaken. Writes and acknowledgement
    // recovery must finish before another operation can touch the queue.
    if (this.running && !(interactive && this.reading)) return this.running;
    const generation = ++this.syncGeneration;
    const current = () => generation === this.syncGeneration;
    this.reading = false;
    const task = async () => {
      try {
        await this.recoverAcknowledgement();
        // A conflict is not a place to stay: this window's competing edits are kept
        // as new messages, the queue pauses with the reason shown, and syncing goes on.
        if (this.conflict) await this.resolveConflict();
        for (;;) {
          while (this.dirty()) {
            const sent = this.desired;
            const ownership = this.takeOwnership;
            const after = await this.wire(sent);
            const takeover = this.takeover;
            let value =
              this.leased && sameQueueValue(this.fields(this.base), this.fields(after))
                ? this.base // only the lease is wanted
                : await this.call<SharedQueue>("change", {
                    before: this.fields(this.base),
                    after,
                    takeOwnership: ownership,
                  });
            if (ownership && this.leased && this.mayHold())
              value = await this.acquire(value, takeover);
            // Edits made while the request was in flight are applied after its result.
            const pending = {
              before: after,
              after: this.desired === sent ? after : await this.wire(this.desired),
            };
            this.desired = mergeQueueChange(value, pending);
            this.base = value;
            if (ownership) this.takeOwnership = false;
            if (takeover) this.takeover = false;
            for (const row of after.messages)
              this.attachmentScope?.finishJob(`queue-upload:${row.id}`);
            this.persist();
            this.emit(true);
          }
          const before = this.base;
          this.reading = !interactive;
          const value = await this.call<SharedQueue>("get", {}, () => {
            if (!current()) return false;
            this.reading = false;
            return true;
          });
          if (!current()) return;
          this.reading = false;
          if (this.dirty()) {
            this.desired = mergeQueueChange(value, { before, after: this.desired });
            this.base = value;
            continue;
          }
          this.base = value;
          this.desired = value;
          // Work waits and nobody holds the queue: this desktop takes the lease
          // so it, not the host, drains. A live holder is left alone.
          if (this.leased && this.mayHold() && this.wantsLease(value))
            this.base = this.desired = await this.acquire(value, false);
          this.persist();
          this.emit(true);
          break;
        }
      } catch (error) {
        if (!current()) return;
        const message = String(error).replace(/^Error: /, "");
        this.conflict =
          /changed on another computer|order changed|state changed|being sent|Queued message ID/.test(
            message,
          );
        this.emit(this.state.loaded, message);
        throw error;
      }
    };
    this.running = task().finally(() => {
      if (current()) {
        this.running = undefined;
        this.reading = false;
      }
    });
    return this.running;
  }
  async retry(): Promise<void> {
    if (this.running) {
      try {
        await this.sync(true);
        return;
      } catch {}
    }
    if (this.conflict) await this.resolveConflict();
    this.emit(true);
    await this.sync(true);
  }
  /**
   * Another computer changed a row this window also changed. The host copy wins
   * for every row; what this window changed on its own is kept as a new message,
   * and the queue pauses so nothing is sent until the owner has looked. The
   * reason is shown with the pause.
   */
  private async resolveConflict(): Promise<void> {
    const value = await this.call<SharedQueue>("get");
    const kept: typeof value.messages = [];
    let duplicated = false;
    for (const row of this.desired.messages) {
      const before = this.base.messages.find((old) => old.id === row.id);
      const remote = value.messages.find((old) => old.id === row.id);
      if (!before && !remote) kept.push(row); // new here, not yet sent
      else if (sameQueueValue(remote, row) || (before && sameQueueValue(before, row))) continue;
      else {
        kept.push({ ...row, id: crypto.randomUUID() });
        duplicated = true;
      }
    }
    this.base = value;
    this.desired = {
      ...value,
      messages: [...value.messages, ...kept],
      status: "paused",
      editingId: undefined,
    };
    this.conflict = false;
    this.notice = duplicated
      ? "Another computer changed a queued message you also changed. Your version was kept as a new message."
      : "Another computer changed the queue. Check it, then resume.";
    this.persist();
    this.emit(true);
  }
  /** The owner pressed Stop: with a send still unsettled, the queue pauses once it settles. */
  noteStop(): void {
    const prior = this.journal();
    if (!prior || prior.stopped) return;
    localStorage.setItem(`${this.storageKey}:send`, JSON.stringify({ ...prior, stopped: true }));
  }
  /**
   * An explicit "Take over": this window becomes the drainer even though another
   * window's lease is still live (a new epoch fences the old holder). Nothing in
   * the queue changes.
   */
  async takeOver(): Promise<void> {
    await this.retry();
    if (!this.update((queue) => queue, true))
      throw new Error(this.state.error ?? "The queue is being sent elsewhere. Wait and try again.");
    await this.sync(true);
    if (!this.canDrain())
      throw new Error(this.state.error ?? "The queue could not be taken over. Try again.");
  }
  /** Whether this client may send the head now: it holds the drain lease. */
  canDrain(): boolean {
    return (
      this.settled() &&
      (this.leased
        ? this.mayHold() && this.holder() === this.clientId
        : this.base.consumer === this.clientId)
    );
  }
  /** A row the person picked to send now: allowed unless another window holds the queue. */
  canSendSelected(): boolean {
    if (!this.leased) return this.canDrain();
    const holder = this.holder();
    return this.settled() && (!holder || holder === this.clientId);
  }
  private settled(): boolean {
    return this.state.loaded && !this.state.error && !this.dirty() && !this.base.claim;
  }
  /** Only a desktop window holds the drain lease; other computers edit and the host drains. */
  private mayHold(): boolean {
    return this.leased === false || this.clientId.startsWith("desktop:");
  }
  /** Who drains this queue now: the live lease holder (an older host: its consumer). */
  holder(): string | undefined {
    if (!this.leased) return this.base.consumer;
    return leaseLive(this.base.drain, Date.now(), this.skew) ? this.base.drain!.holder : undefined;
  }
  /** The queue is sent without this client: a desktop window or the home host drains it. */
  hostDrains(): boolean {
    return !!this.leased && !this.mayHold();
  }
  /** Another window holds the queue's drain lease right now. */
  heldByOther(): boolean {
    const holder = this.holder();
    return !!this.leased && !!holder && holder !== this.clientId;
  }
  /** When (this clock) another window's live lease on a queue that waits to be sent
   * runs out: the moment this window may take the queue over. */
  foreignLeaseEnds(): number | undefined {
    const drain = this.base.drain;
    if (
      !this.leased ||
      !drain ||
      drain.holder === this.clientId ||
      !this.mayHold() ||
      this.base.status !== "active" ||
      !this.base.messages.length
    )
      return undefined;
    const at = drain.expiresAt - this.skew;
    return at > Date.now() ? at : undefined;
  }
  private wantsLease(queue: SharedQueue): boolean {
    return (
      queue.status === "active" &&
      queue.messages.length > 0 &&
      !leaseLive(queue.drain, Date.now(), this.skew)
    );
  }
  private learn(result: unknown) {
    const queue = result as Partial<SharedQueue> | undefined;
    if (!queue || typeof queue !== "object" || !Array.isArray(queue.messages)) return;
    this.leased = queue.leased === true;
    if (typeof queue.hostTime === "number") this.skew = queue.hostTime - Date.now();
  }
  /** Asks the host for the lease. Someone else's live one stays theirs (unless taken over). */
  private async acquire(value: SharedQueue, takeover: boolean): Promise<SharedQueue> {
    try {
      return await this.call<SharedQueue>("lease", { takeover });
    } catch (error) {
      if (!LEASE_HELD.test(String(error))) throw error;
      return value;
    }
  }
  /** The lease this client holds, to be kept alive by the desktop heartbeat. */
  heldLease(): { sessionId: string; epoch: number } | undefined {
    const drain = this.base.drain;
    return this.leased && drain?.holder === this.clientId && drain.expiresAt > 0
      ? { sessionId: this.sessionId, epoch: drain.epoch }
      : undefined;
  }
  /** The heartbeat's answer: the lease was extended, or lost (`null`). */
  noteLease(lease: DrainLease | null | undefined) {
    const drain = this.base.drain;
    if (lease === undefined || !drain || drain.holder !== this.clientId) return;
    if (lease && lease.epoch !== drain.epoch) return;
    this.base = { ...this.base, drain: { ...drain, expiresAt: lease ? lease.expiresAt : 0 } };
    this.emit(this.state.loaded);
  }
  /**
   * Gives the drain lease back (a closed window, a conversation that moved away)
   * so no other window waits for it to run out. Best effort: it ends on its own
   * when the heartbeat stops. A host that has no such call is asked only once.
   */
  async releaseLease(): Promise<void> {
    const held = this.heldLease();
    if (!held || releaseUnsupported) return;
    try {
      await this.request("sessions.queue.release", {
        sessionId: this.sessionId,
        clientId: this.clientId,
        leaseAware: true,
        epoch: held.epoch,
      });
      const drain = this.base.drain;
      if (drain) this.base = { ...this.base, drain: { ...drain, expiresAt: 0 } };
    } catch (error) {
      if (/unknown method|not supported|unsupported|no such method/i.test(String(error)))
        releaseUnsupported = true;
    }
  }
  dispatch(id: string, selected = false) {
    const drain = this.base.drain;
    return {
      id,
      clientId: this.clientId,
      revision: this.base.revision,
      leaseAware: true,
      ...(drain?.holder === this.clientId ? { epoch: drain.epoch } : {}),
      ...(selected ? { selected: true } : {}),
    };
  }
  async claim(id: string, steer: boolean): Promise<string | undefined> {
    let value: SharedQueue | undefined;
    for (let attempt = 0; !value; attempt++) {
      await this.sync(true);
      if (!this.canDrain()) return undefined;
      // Write before the RPC: a committed claim with a lost reply must be recoverable.
      // No provider callback can run until this method returns its token.
      localStorage.setItem(
        `${this.storageKey}:send`,
        // `held: false`: if only the reply is lost, the claim is released as it was
        // and the queue is not paused for a send that never started.
        JSON.stringify({ id, clientId: this.clientId, accepted: false, held: false }),
      );
      try {
        value = await this.call<SharedQueue>("claim", {
          id,
          revision: this.base.revision,
          steer,
          ...(this.base.drain?.holder === this.clientId ? { epoch: this.base.drain.epoch } : {}),
        });
      } catch (error) {
        // Another computer appended or edited a row between our read and the
        // claim. The host refused it, so nothing was claimed: read the queue
        // again and claim against its new revision instead of failing the send.
        if (attempt >= CLAIM_RACE_RETRIES || !CLAIM_RACE.test(String(error))) throw error;
      }
    }
    this.base = value;
    this.desired = value;
    this.emit(true);
    localStorage.setItem(
      `${this.storageKey}:send`,
      JSON.stringify({ token: value.claim?.token, id, clientId: this.clientId, accepted: null }),
    );
    return value.claim?.token;
  }
  /**
   * Settles a claimed send. `held` says whether this outcome holds the queue for
   * the owner (a refused send does; a delivered one and a wait for the host do
   * not). It is journaled, so a replay after a lost reply or a restart does what
   * the first attempt would have done instead of pausing a delivered send.
   */
  async finish(token: string, accepted: boolean, held = !accepted) {
    const prior = this.journal();
    localStorage.setItem(
      `${this.storageKey}:send`,
      JSON.stringify({
        ...(prior?.id ? { id: prior.id } : {}),
        token,
        clientId: this.clientId,
        accepted,
        held,
        ...(prior?.stopped ? { stopped: true } : {}),
      }),
    );
    await this.recoverAcknowledgement(false);
    // The Stop is written to the host now, not on some later read.
    if (prior?.stopped) await this.sync(true).catch(() => {});
  }
  private journal(): SendJournal | undefined {
    const journal = localStorage.getItem(`${this.storageKey}:send`);
    if (!journal) return undefined;
    try {
      return JSON.parse(journal) as SendJournal;
    } catch {
      return undefined;
    }
  }
  /**
   * Tells the host how a journaled send ended. A host that no longer has the
   * claim open is read instead of failing every later sync: a row that is gone
   * was consumed, a token the host settled needs nothing more, and a delivered
   * row the host still lists is taken out of the queue (`remove`).
   */
  private async finishOnHost(
    pending: SendJournal,
  ): Promise<{ value: SharedQueue; remove?: string }> {
    try {
      return { value: await this.call<SharedQueue>("finish", pending) };
    } catch (error) {
      if (!/no longer belongs/i.test(String(error))) throw error;
      const value = await this.call<SharedQueue>("get");
      const queued = !!pending.id && value.messages.some((row) => row.id === pending.id);
      if (value.claim?.token === pending.token) throw error;
      if (queued && pending.accepted === true) return { value, remove: pending.id };
      return { value };
    }
  }
  private async recoverAcknowledgement(replay = true) {
    const pending = this.journal();
    if (!pending) return;
    if (!pending.token || pending.accepted === null) {
      const value = await this.call<SharedQueue>("get");
      this.base = value;
      this.desired = value;
      this.persist();
      this.emit(true);
      if (!pending.token) {
        if (value.claim?.clientId === pending.clientId && value.claim.id === pending.id) {
          pending.token = value.claim.token;
          localStorage.setItem(`${this.storageKey}:send`, JSON.stringify(pending));
        } else if (!value.claim) {
          localStorage.removeItem(`${this.storageKey}:send`);
          return;
        } else
          throw new Error("A queued send belongs to another reservation. Refresh before recovery.");
      }
      if (pending.accepted === null) {
        // The host already moved on without a verdict from us: the row is gone
        // (consumed) or the host settled this very claim as delivered. Nothing is
        // left to decide, and nothing is held.
        const rowId = pending.id ?? value.claim?.id;
        const gone = !!rowId && !value.messages.some((row) => row.id === rowId);
        const delivered = value.settled?.token === pending.token && value.settled.accepted;
        if (!value.claim && (gone || delivered)) {
          localStorage.removeItem(`${this.storageKey}:send`);
          return;
        }
        this.recovery =
          value.messages.find((row) => row.id === (pending.id ?? value.claim?.id))?.text ||
          "Queued message";
        throw new Error(
          "Delivery of a queued message is unknown. Review the conversation and resolve the held send.",
        );
      }
    }
    const { value, remove } = await this.finishOnHost(pending);
    this.base = value;
    this.desired = remove
      ? { ...this.fields(value), messages: value.messages.filter((row) => row.id !== remove) }
      : value;
    localStorage.removeItem(`${this.storageKey}:send`);
    this.recovery = undefined;
    // Retained work resumes on its own only after a send that ended well. A
    // refused or unconfirmed one holds the queue (journaled on the first attempt);
    // a delivered send, or a wait for the host, does not pause what is behind it.
    // A Stop pressed while the send was unsettled holds the queue whatever the
    // outcome was: a late success must not start draining against it.
    if ((replay && (pending.held ?? !pending.accepted)) || pending.stopped) {
      this.desired = {
        ...this.desired,
        status: this.desired.messages.length ? "paused" : undefined,
        editingId: undefined,
      };
      this.takeOwnership = true;
    }
    this.persist();
    this.emit(true);
  }
  /**
   * Whether a sent row is still unconfirmed. This replays the send journal, so it
   * must only run when no send is in flight: a live claim looks unconfirmed too.
   */
  async unconfirmed(): Promise<boolean> {
    if (!this.recovery) await this.sync(true).catch(() => {});
    return !!this.recovery;
  }
  /** Explicit owner reconciliation. Keeping a row pauses it; this never sends it. */
  async resolveRecovery(accepted: boolean) {
    if (this.running) await this.running.catch(() => {});
    if (!this.recovery) return;
    const pending = JSON.parse(localStorage.getItem(`${this.storageKey}:send`)!);
    // The owner decided on an unconfirmed send: the rest of the queue waits for them.
    localStorage.setItem(
      `${this.storageKey}:send`,
      JSON.stringify({ ...pending, accepted: pending.accepted ?? accepted, held: true }),
    );
    await this.recoverAcknowledgement();
    if (!accepted)
      this.update((queue) => ({
        ...queue,
        messages: queue.messages.map((row) =>
          row.id === pending.id ? { ...row, deliveryUnknown: undefined } : row,
        ),
      }));
    await this.sync();
  }
}
