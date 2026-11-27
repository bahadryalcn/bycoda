import { randomUUID } from "node:crypto";
import { HostDomainRefusalError } from "../domains/context";
import type { GroupPasswordResult } from "../../src/shared/model/host-contracts/group-lock";

/** A phone's unlock lasts this long; unlocking again starts a new window. */
export const GROUP_GRANT_TTL_MS = 30 * 60_000;
/** A relayed request that the desktop does not answer in this time fails as unavailable. */
export const GROUP_RELAY_TIMEOUT_MS = 20_000;
/** A desktop window that has not beaten for this long no longer counts as live. */
const CLIENT_FRESH_MS = 20_000;
const MAX_PENDING = 20;

export const GROUP_LOCK_UNAVAILABLE_MESSAGE =
  "Open the bycoda app on that computer to unlock groups from this device.";

/** What the Host asks the desktop window to run; the password only travels in this job. */
export type GroupLockJob = { id: string } & (
  | { kind: "unlock"; groupId: string; password: string }
  | { kind: "authorizeHidden"; password: string }
  | { kind: "setHidden"; groupId: string; hidden: boolean }
);
export type GroupLockRequest = DistributiveOmit<GroupLockJob, "id">;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** What the desktop answers: a verdict for passwords, `ok` for a hidden-state change. */
export type GroupLockReply = { id: string; error?: string } & Partial<GroupPasswordResult>;

type Pending = {
  job: GroupLockJob;
  delivered: boolean;
  finish: (reply: GroupLockReply | Error) => void;
};
type Grant = { groups: Map<string, number>; hiddenUntil?: number };

/** What one device may see beyond the default directory. */
export type GroupAccess = { groupIds: ReadonlySet<string>; hiddenList: boolean };
export const NO_GROUP_ACCESS: GroupAccess = { groupIds: new Set(), hiddenList: false };

/**
 * Relays remote unlock attempts to the desktop renderer, which alone holds the
 * password hash, and keeps the in-memory grants a phone earns. A grant lives per
 * principal (the device's token hash): re-pairing or revoking a device drops it,
 * and so do the desktop locking everything, changing the password or restarting.
 */
export class DesktopGroupLock {
  private clients = new Map<string, { at: number; epoch?: string }>();
  private pending = new Map<string, Pending>();
  private grants = new Map<string, Grant>();
  private sweep?: ReturnType<typeof setTimeout>;
  /** Grants changed or expired: directory views must be built again. */
  onChange?: () => void;

  declare private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** Whether a desktop window that can run these requests is beating now. */
  ready(): boolean {
    return [...this.clients.values()].some((client) => this.now() - client.at <= CLIENT_FRESH_MS);
  }

  request(job: GroupLockRequest): Promise<GroupLockReply> {
    if (!this.ready() || this.pending.size >= MAX_PENDING)
      return Promise.reject(groupLockUnavailable());
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => finish(groupLockUnavailable()), GROUP_RELAY_TIMEOUT_MS);
      timer.unref?.();
      const finish = (reply: GroupLockReply | Error) => {
        clearTimeout(timer);
        this.pending.delete(id);
        if (reply instanceof Error) reject(reply);
        else resolve(reply);
      };
      this.pending.set(id, { job: { ...job, id } as GroupLockJob, delivered: false, finish });
    });
  }

  /**
   * One desktop heartbeat: take its replies and `epoch` (any change means the desktop
   * locked, changed the password or restarted, so every grant ends), hand out new jobs.
   */
  beat(client: string, input: unknown): { jobs: GroupLockJob[]; acked: string[] } {
    if (!input || typeof input !== "object" || Array.isArray(input)) return { jobs: [], acked: [] };
    const payload = input as { version?: number; epoch?: unknown; replies?: unknown };
    if (payload.version !== 1) return { jobs: [], acked: [] };
    const epoch =
      typeof payload.epoch === "string" && payload.epoch.length <= 128 ? payload.epoch : "";
    const previous = this.clients.get(client);
    this.clients.set(client, { at: this.now(), epoch });
    for (const [id, entry] of this.clients)
      if (this.now() - entry.at > CLIENT_FRESH_MS) this.clients.delete(id);
    // A window seen for the first time, or after a gap, may have restarted: end every grant.
    if (!previous || previous.epoch !== epoch) this.revokeAll();
    const acked: string[] = [];
    const replies = Array.isArray(payload.replies) ? payload.replies.slice(0, 100) : [];
    for (const reply of replies as GroupLockReply[]) {
      if (!reply || typeof reply.id !== "string") continue;
      const pending = this.pending.get(reply.id);
      pending?.finish(reply);
      acked.push(reply.id);
    }
    const jobs: GroupLockJob[] = [];
    for (const pending of this.pending.values()) {
      // Deliver once: a lost answer must never replay a password.
      if (pending.delivered) continue;
      pending.delivered = true;
      jobs.push(pending.job);
    }
    return { jobs, acked };
  }

  grantGroup(principal: string, groupId: string): void {
    const grant = this.grantFor(principal);
    grant.groups.set(groupId, this.now() + GROUP_GRANT_TTL_MS);
    this.scheduleSweep();
    this.onChange?.();
  }

  grantHidden(principal: string): void {
    this.grantFor(principal).hiddenUntil = this.now() + GROUP_GRANT_TTL_MS;
    this.scheduleSweep();
    this.onChange?.();
  }

  /** Drops one group's grant, or every grant of this device. */
  revoke(principal: string, groupId?: string): void {
    const grant = this.grants.get(principal);
    if (!grant) return;
    if (groupId === undefined) this.grants.delete(principal);
    else if (!grant.groups.delete(groupId)) return;
    this.onChange?.();
  }

  revokeAll(): void {
    if (!this.grants.size) return;
    this.grants.clear();
    this.onChange?.();
  }

  /** Live grants of a device; expired ones are gone. */
  access(principal: string | undefined): GroupAccess {
    const grant = principal ? this.grants.get(principal) : undefined;
    if (!grant) return NO_GROUP_ACCESS;
    const now = this.now();
    const groupIds = new Set<string>();
    for (const [id, until] of grant.groups) if (until > now) groupIds.add(id);
    return { groupIds, hiddenList: (grant.hiddenUntil ?? 0) > now };
  }

  close(): void {
    clearTimeout(this.sweep);
    for (const pending of this.pending.values()) pending.finish(groupLockUnavailable());
    this.grants.clear();
  }

  private grantFor(principal: string): Grant {
    let grant = this.grants.get(principal);
    if (!grant) this.grants.set(principal, (grant = { groups: new Map() }));
    return grant;
  }

  /** Streams only rebuild on a change, so an expiry must announce itself. */
  private scheduleSweep(): void {
    clearTimeout(this.sweep);
    let next = Infinity;
    for (const grant of this.grants.values()) {
      for (const until of grant.groups.values()) next = Math.min(next, until);
      if (grant.hiddenUntil) next = Math.min(next, grant.hiddenUntil);
    }
    if (next === Infinity) return;
    this.sweep = setTimeout(
      () => {
        for (const [principal, grant] of this.grants) {
          for (const [id, until] of grant.groups) if (until <= this.now()) grant.groups.delete(id);
          if (grant.hiddenUntil && grant.hiddenUntil <= this.now()) delete grant.hiddenUntil;
          if (!grant.groups.size && grant.hiddenUntil === undefined) this.grants.delete(principal);
        }
        this.scheduleSweep();
        this.onChange?.();
      },
      Math.max(1_000, next - this.now() + 50),
    );
    this.sweep.unref?.();
  }
}

export function groupLockUnavailable(): HostDomainRefusalError {
  return new HostDomainRefusalError(
    "GROUP_LOCK_DESKTOP_UNAVAILABLE",
    "conflict",
    true,
    GROUP_LOCK_UNAVAILABLE_MESSAGE,
  );
}
