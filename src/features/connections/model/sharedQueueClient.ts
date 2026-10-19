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
import { mergeQueueChange, sameQueueValue, type SharedQueue } from "./sharedQueue";
import type { RemoteQueue } from "./remoteQueue";

export type QueueTransport = <T>(method: string, params: Record<string, unknown>) => Promise<T>;
export const queueClientId = `remote:${crypto.randomUUID()}`;
export const desktopQueueClientId = `desktop:${crypto.randomUUID()}`;

export class SharedQueueClient {
  private base: SharedQueue = { messages: [], revision: 0 };
  private desired: RemoteQueue = this.base;
  private listeners = new Set<() => void>();
  private running?: Promise<void>;
  private takeOwnership = false;
  private conflict = false;
  private hasBaseline = false;
  private state: { queue: SharedQueue; loaded: boolean; error?: string; recovery?: string } = {
    queue: this.base,
    loaded: false,
  };
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
    this.storageKey = `bycoda:shared-queue:v1:${JSON.stringify([environmentId, sessionId, clientId.startsWith("desktop:") ? "desktop" : "remote"])}`;
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
    this.state = {
      queue: { ...this.base, ...this.desired },
      loaded,
      ...(error ? { error } : {}),
      recovery: this.recovery,
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
    this.takeOwnership ||= takeOwnership || (!this.base.consumer && !!this.desired.messages.length);
    try {
      this.persist();
    } catch (error) {
      this.desired = before;
      this.takeOwnership = ownership;
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
          this.desired = { ...legacy, status: legacy.status ?? "restored" };
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
  private async call<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
    const scope = this.attachments();
    const claimId = scope?.cacheClaimId();
    const result = await this.request<T>(`sessions.queue.${action}`, {
      sessionId: this.sessionId,
      clientId: this.clientId,
      ...(scope ? { ownerId: scope.ownerId, claimId } : {}),
      ...params,
    }).catch((error) => {
      this.attachmentFingerprint = undefined;
      throw error;
    });
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
  async sync(): Promise<void> {
    if (this.running) return this.running;
    const task = async () => {
      try {
        await this.recoverAcknowledgement();
        if (this.conflict) throw new Error(this.state.error);
        for (;;) {
          while (this.dirty()) {
            const sent = this.desired;
            const ownership = this.takeOwnership;
            const after = await this.wire(sent);
            const value = await this.call<SharedQueue>("change", {
              before: this.fields(this.base),
              after,
              takeOwnership: ownership,
            });
            // Edits made while the request was in flight are applied after its result.
            const pending = {
              before: after,
              after: this.desired === sent ? after : await this.wire(this.desired),
            };
            this.desired = mergeQueueChange(value, pending);
            this.base = value;
            if (ownership) this.takeOwnership = false;
            for (const row of after.messages)
              this.attachmentScope?.finishJob(`queue-upload:${row.id}`);
            this.persist();
            this.emit(true);
          }
          const before = this.base;
          const value = await this.call<SharedQueue>("get");
          if (this.dirty()) {
            this.desired = mergeQueueChange(value, { before, after: this.desired });
            this.base = value;
            continue;
          }
          this.base = value;
          this.desired = value;
          this.persist();
          this.emit(true);
          break;
        }
      } catch (error) {
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
      this.running = undefined;
    });
    return this.running;
  }
  async retry(): Promise<void> {
    if (this.running) {
      try {
        await this.running;
      } catch {}
    }
    if (this.conflict) {
      const value = await this.call<SharedQueue>("get");
      const changed = this.desired.messages.filter((row) => {
        const before = this.base.messages.find((old) => old.id === row.id);
        const remote = value.messages.find((old) => old.id === row.id);
        return !sameQueueValue(before, row) && !sameQueueValue(remote, row);
      });
      this.base = value;
      this.desired = {
        ...value,
        messages: [
          ...value.messages,
          ...changed.map((row) => ({ ...row, id: crypto.randomUUID() })),
        ],
        status: "paused",
        editingId: undefined,
      };
      this.conflict = false;
      this.persist();
    }
    this.emit(true);
    await this.sync();
  }
  canDrain(): boolean {
    return (
      this.state.loaded &&
      !this.state.error &&
      !this.dirty() &&
      !this.base.claim &&
      this.base.consumer === this.clientId
    );
  }
  dispatch(id: string, selected = false) {
    return {
      id,
      clientId: this.clientId,
      revision: this.base.revision,
      ...(selected ? { selected: true } : {}),
    };
  }
  async claim(id: string, steer: boolean): Promise<string | undefined> {
    await this.sync();
    if (!this.canDrain()) return undefined;
    // Write before the RPC: a committed claim with a lost reply must be recoverable.
    // No provider callback can run until this method returns its token.
    localStorage.setItem(
      `${this.storageKey}:send`,
      JSON.stringify({ id, clientId: this.clientId, accepted: false }),
    );
    const value = await this.call<SharedQueue>("claim", {
      id,
      revision: this.base.revision,
      steer,
    });
    this.base = value;
    this.desired = value;
    this.emit(true);
    localStorage.setItem(
      `${this.storageKey}:send`,
      JSON.stringify({ token: value.claim?.token, id, clientId: this.clientId, accepted: null }),
    );
    return value.claim?.token;
  }
  async finish(token: string, accepted: boolean) {
    localStorage.setItem(
      `${this.storageKey}:send`,
      JSON.stringify({ token, clientId: this.clientId, accepted }),
    );
    await this.recoverAcknowledgement(false);
  }
  private async recoverAcknowledgement(pause = true) {
    const journal = localStorage.getItem(`${this.storageKey}:send`);
    if (!journal) return;
    const pending = JSON.parse(journal) as {
      token?: string;
      id?: string;
      clientId: string;
      accepted: boolean | null;
    };
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
        this.recovery =
          value.messages.find((row) => row.id === (pending.id ?? value.claim?.id))?.text ||
          "Queued message";
        throw new Error(
          "Delivery of a queued message is unknown. Review the conversation and resolve the held send.",
        );
      }
    }
    const value = await this.call<SharedQueue>("finish", pending);
    this.base = value;
    this.desired = value;
    localStorage.removeItem(`${this.storageKey}:send`);
    this.recovery = undefined;
    // A recovered send must never resume retained work automatically.
    if (pause) {
      this.desired = {
        ...value,
        status: value.messages.length ? "paused" : undefined,
        editingId: undefined,
      };
      this.takeOwnership = true;
    }
    this.persist();
    this.emit(true);
  }
  /** Explicit owner reconciliation. Keeping a row pauses it; this never sends it. */
  async resolveRecovery(accepted: boolean) {
    if (this.running) await this.running.catch(() => {});
    if (!this.recovery) return;
    const pending = JSON.parse(localStorage.getItem(`${this.storageKey}:send`)!);
    localStorage.setItem(
      `${this.storageKey}:send`,
      JSON.stringify({ ...pending, accepted: pending.accepted ?? accepted }),
    );
    await this.recoverAcknowledgement();
    await this.sync();
  }
}
