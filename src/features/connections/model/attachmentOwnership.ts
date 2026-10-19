import { getAllWindows, getCurrentWindow } from "@tauri-apps/api/window";

/** Nonsecret, durable claim/release intent. Bytes and credentials never enter this ledger. */
export const ATTACHMENT_OWNERSHIP_CAPABILITY = "attachments.ownership.v1";
export type AttachmentOwnershipRequest = (
  method: string,
  params: Record<string, unknown>,
) => Promise<unknown>;
type Release = { id: string; claimId?: string };
type Ledger = {
  held: string[];
  sources: Record<string, string[]>;
  releases: Release[];
  claims: Record<string, string>;
  cacheGeneration?: string;
};

export class AttachmentOwnership {
  private state: Ledger;
  private serial: Promise<unknown> = Promise.resolve();
  private readonly key: string;
  private readonly activeSources = new Set<string>();
  beginJob(source: string): void {
    this.activeSources.add(source);
  }
  finishJob(source: string): void {
    this.activeSources.delete(source);
  }
  sourceNames(): string[] {
    return Object.keys(this.state.sources);
  }
  constructor(
    readonly ownerId: string,
    scope: string,
    private readonly request: AttachmentOwnershipRequest,
    private readonly storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
  ) {
    this.key = `bycoda:attachment-ownership:v1:${JSON.stringify([scope, ownerId])}`;
    const raw = storage.getItem(this.key);
    this.state = raw
      ? (JSON.parse(raw) as Ledger)
      : { held: [], sources: {}, releases: [], claims: {} };
    this.state.claims ??= {};
    if (
      !Array.isArray(this.state.held) ||
      !this.state.held.every((id) => typeof id === "string") ||
      !Array.isArray(this.state.releases) ||
      !this.state.releases.every(
        (entry) =>
          entry &&
          typeof entry.id === "string" &&
          (entry.claimId === undefined || typeof entry.claimId === "string"),
      ) ||
      !this.state.sources ||
      typeof this.state.sources !== "object" ||
      !Object.values(this.state.sources).every(
        (ids) => Array.isArray(ids) && ids.every((id) => typeof id === "string"),
      ) ||
      !Object.values(this.state.claims).every((id) => typeof id === "string")
    )
      throw new Error("Could not read attachment ownership ledger");
  }
  private save(next: Ledger) {
    // Persist first: a failed local write must never authorize a host release.
    this.storage.setItem(this.key, JSON.stringify(next));
    this.state = next;
  }
  private ordered<T>(operation: () => Promise<T>): Promise<T> {
    const work = this.serial.catch(() => {}).then(operation);
    this.serial = work;
    return work;
  }
  /** Adds a durable reference without declaring any older reference removed. */
  retain(source: string, ids: string[]): Promise<void> {
    return this.ordered(async () => {
      this.save({
        ...this.state,
        sources: {
          ...this.state.sources,
          [source]: [...new Set([...(this.state.sources[source] ?? []), ...ids])],
        },
      });
    });
  }
  acquire(source: string, ids: string[]): Promise<void> {
    return this.ordered(async () => {
      const unique = [...new Set(ids)];
      if (!unique.length) return;
      const claims = { ...this.state.claims };
      const nonce = crypto.randomUUID();
      for (const id of unique)
        if (
          !claims[id] ||
          this.state.releases.some((release) => release.id === id && release.claimId === claims[id])
        )
          claims[id] = nonce;
      this.save({
        ...this.state,
        held: [...new Set([...this.state.held, ...unique])],
        sources: {
          ...this.state.sources,
          [source]: [...new Set([...(this.state.sources[source] ?? []), ...unique])],
        },
        claims,
      });
      for (const claimId of new Set(unique.map((id) => claims[id]))) {
        const ids = unique.filter((id) => claims[id] === claimId);
        for (let index = 0; index < ids.length; index += 20)
          await this.request("attachments.claim", {
            ownerId: this.ownerId,
            claimId,
            ids: ids.slice(index, index + 20),
          });
      }
    });
  }
  /** Caller must establish durable removal or an acknowledged server handoff first. */
  replaceDurable(source: string, ids: string[]): Promise<void> {
    return this.reconcile(() => ({ ...this.state.sources, [source]: [...new Set(ids)] }));
  }
  /** Full, authoritative durable inventory; active uploads protect unsaved references. */
  reconcileDurable(sources: Record<string, string[]>): Promise<void> {
    return this.reconcile(
      () => ({
        ...sources,
        ...Object.fromEntries(
          [...this.activeSources].map((source) => [source, this.state.sources[source] ?? []]),
        ),
      }),
      true,
    );
  }
  private reconcile(
    readSources: () => Record<string, string[]>,
    repairHost = false,
  ): Promise<void> {
    return this.ordered(async () => {
      const sources = Object.fromEntries(
        Object.entries(readSources()).filter(([, ids]) => ids.length > 0),
      );
      const referenced = new Set(Object.values(sources).flat());
      const releases = [...this.state.releases];
      if (repairHost) {
        const claims = { ...this.state.claims };
        const nonce = crypto.randomUUID();
        for (const id of referenced)
          if (
            !claims[id] ||
            releases.some((entry) => entry.id === id && entry.claimId === claims[id])
          )
            claims[id] = nonce;
        this.save({
          ...this.state,
          sources,
          claims,
          held: [...new Set([...this.state.held, ...referenced])],
        });
        for (const claimId of new Set([...referenced].map((id) => claims[id]))) {
          const ids = [...referenced].filter((id) => claims[id] === claimId);
          for (let index = 0; index < ids.length; index += 20)
            await this.request("attachments.claim", {
              ownerId: this.ownerId,
              claimId,
              ids: ids.slice(index, index + 20),
            });
        }
        let after: Release | undefined;
        const cursors = new Set<string>();
        do {
          const response = (await this.request("attachments.claims", {
            ownerId: this.ownerId,
            ...(after ? { after } : {}),
          })) as { claims: Release[]; next?: Release };
          if (
            !response ||
            !Array.isArray(response.claims) ||
            response.claims.length > 200 ||
            response.claims.some(
              (entry) =>
                !entry || typeof entry.id !== "string" || typeof entry.claimId !== "string",
            )
          )
            throw new Error("Invalid attachment claim inventory");
          for (const entry of response.claims)
            if (
              (!referenced.has(entry.id) || claims[entry.id] !== entry.claimId) &&
              !releases.some((old) => old.id === entry.id && old.claimId === entry.claimId)
            )
              releases.push(entry);
          after = response.next;
          if (after) {
            const cursor = JSON.stringify(after);
            if (
              typeof after.id !== "string" ||
              typeof after.claimId !== "string" ||
              cursors.has(cursor) ||
              !response.claims.length
            )
              throw new Error("Invalid attachment claim inventory cursor");
            cursors.add(cursor);
          }
        } while (after);
      }
      for (const id of this.state.held.filter((id) => !referenced.has(id))) {
        const claimId = this.state.claims[id];
        if (!releases.some((entry) => entry.id === id && entry.claimId === claimId))
          releases.push({ id, claimId });
      }
      this.save({ ...this.state, sources, releases });
      await this.drain();
    });
  }
  retry(): Promise<void> {
    return this.ordered(() => this.drain());
  }
  claimId(id: string): string | undefined {
    return this.state.claims[id];
  }
  cacheClaimId(): string {
    if (
      !this.state.cacheGeneration ||
      this.state.releases.some((entry) => entry.claimId === this.state.cacheGeneration)
    )
      this.save({ ...this.state, cacheGeneration: crypto.randomUUID() });
    return this.state.cacheGeneration!;
  }
  /** A queue.get response has already atomically claimed these bytes on the host. */
  adoptClaimed(source: string, ids: string[], claimId: string): Promise<void> {
    return this.ordered(async () => {
      const claims = { ...this.state.claims };
      const releases = [...this.state.releases];
      for (const id of ids) {
        if (
          claims[id] &&
          claims[id] !== claimId &&
          !releases.some((entry) => entry.id === id && entry.claimId === claims[id])
        )
          releases.push({ id, claimId: claims[id] });
        claims[id] = claimId;
      }
      this.save({
        ...this.state,
        claims,
        releases,
        held: [...new Set([...this.state.held, ...ids])],
        sources: { ...this.state.sources, [source]: [...new Set(ids)] },
      });
    });
  }
  private async drain() {
    const referenced = new Set(Object.values(this.state.sources).flat());
    const eligible = (release: Release) =>
      !referenced.has(release.id) || this.state.claims[release.id] !== release.claimId;
    const first = this.state.releases.find(eligible);
    const claimId = first?.claimId;
    const ids = this.state.releases
      .filter((entry) => eligible(entry) && entry.claimId === claimId)
      .slice(0, 20)
      .map((entry) => entry.id);
    if (!ids.length) return;
    await this.request("attachments.release", { ownerId: this.ownerId, claimId, ids });
    const claims = { ...this.state.claims };
    for (const id of ids) if (claims[id] === claimId) delete claims[id];
    this.save({
      ...this.state,
      releases: this.state.releases.filter(
        (entry) => entry.claimId !== claimId || !ids.includes(entry.id),
      ),
      claims,
      held: this.state.held.filter((id) => !ids.includes(id) || this.state.claims[id] !== claimId),
    });
    await this.drain();
  }
}

const scopes = new Map<string, AttachmentOwnership>();
let realm: string | undefined;
export function attachmentOwnerId(kind: string, id: string): string {
  try {
    const label = getCurrentWindow().label;
    if (label) return JSON.stringify([kind, id, label]);
  } catch {
    /* Browser fixtures use an isolated realm. */
  }
  if (!realm) {
    const key = "bycoda:attachment-owner-realm:v1";
    realm = sessionStorage.getItem(key) ?? crypto.randomUUID();
    sessionStorage.setItem(key, realm);
  }
  return JSON.stringify([kind, id, realm]);
}
export function attachmentOwnershipScope(
  machineId: string,
  environmentId: string,
  ownerId: string,
  request: AttachmentOwnershipRequest,
): AttachmentOwnership {
  const key = JSON.stringify([machineId, environmentId, ownerId]);
  let scope = scopes.get(key);
  if (!scope) {
    scope = new AttachmentOwnership(ownerId, JSON.stringify([machineId, environmentId]), request);
    scopes.set(key, scope);
  }
  return scope;
}

/** Retry only durable release intents, including ledgers from a previous app run. */
export async function retryAttachmentOwnershipReleases(
  machineId: string,
  environmentId: string,
  request: AttachmentOwnershipRequest,
): Promise<void> {
  const currentLabel = getCurrentWindow().label;
  const live = new Set((await getAllWindows()).map((window) => window.label));
  const prefix = "bycoda:attachment-ownership:v1:";
  const scope = JSON.stringify([machineId, environmentId]);
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!key?.startsWith(prefix)) continue;
    const [storedScope, ownerId] = JSON.parse(key.slice(prefix.length)) as [string, string];
    if (storedScope !== scope) continue;
    const [, , label] = JSON.parse(ownerId) as string[];
    if (live.has(label) && label !== currentLabel) continue;
    await attachmentOwnershipScope(machineId, environmentId, ownerId, request).retry();
  }
}

export async function retireClosedAttachmentOwners(
  machineId: string,
  environmentId: string,
  current: AttachmentOwnership,
  sources: Record<string, string[]>,
  request: AttachmentOwnershipRequest,
): Promise<boolean> {
  const [kind, logical] = JSON.parse(current.ownerId) as string[];
  const live = new Set((await getAllWindows()).map((window) => window.label));
  const prefix = "bycoda:attachment-ownership:v1:";
  const scope = JSON.stringify([machineId, environmentId]);
  const retiring: string[] = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!key?.startsWith(prefix)) continue;
    const [storedScope, ownerId] = JSON.parse(key.slice(prefix.length)) as [string, string];
    if (storedScope !== scope || ownerId === current.ownerId) continue;
    const [storedKind, storedLogical, label] = JSON.parse(ownerId) as string[];
    if (storedKind !== kind || storedLogical !== logical || live.has(label)) continue;
    retiring.push(ownerId);
  }
  if (!retiring.length) return false;
  for (const [source, ids] of Object.entries(sources)) await current.acquire(source, ids);
  for (const ownerId of retiring)
    await attachmentOwnershipScope(machineId, environmentId, ownerId, request).reconcileDurable({});
  return true;
}

export function attachmentOwnershipSourceNames(
  machineId: string,
  environmentId: string,
  ownerId: string,
): string[] {
  const [kind, logical] = JSON.parse(ownerId) as string[];
  const prefix = "bycoda:attachment-ownership:v1:";
  const scope = JSON.stringify([machineId, environmentId]);
  const names = new Set<string>();
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!key?.startsWith(prefix)) continue;
    const [storedScope, storedOwner] = JSON.parse(key.slice(prefix.length)) as [string, string];
    const [storedKind, storedLogical] = JSON.parse(storedOwner) as string[];
    if (storedScope !== scope || storedKind !== kind || storedLogical !== logical) continue;
    const ledger = JSON.parse(localStorage.getItem(key)!) as Ledger;
    for (const source of Object.keys(ledger.sources)) names.add(source);
  }
  return [...names];
}
