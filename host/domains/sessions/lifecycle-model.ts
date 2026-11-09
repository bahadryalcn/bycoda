/**
 * Who takes part in a session. Today there is exactly one local owner; `userId` is null while
 * signed out. The list is the extension point for shared sessions, so readers never assume one.
 */
export type SessionParticipant = { userId: string | null; role: "owner" };

/**
 * Settling is a list state, not a lock: a settled session moves out of the active list and
 * wakes up on its next message. `settling` is an owner request that applies when the turn ends.
 */
export type SessionLifecycleState = "active" | "settling" | "settled";
export type SettledBy = "owner" | "auto";

/** Lifecycle sidecar of one session, independent of archive and pin. Absent means active. */
export interface SessionLifecycleRecord {
  sessionId: string;
  state: SessionLifecycleState;
  participants: SessionParticipant[];
  settleRequestedAt?: number;
  settledAt?: number;
  settledBy?: SettledBy;
  /** The owner un-settled it: automatic settling skips it until the next message. */
  keepActive?: boolean;
}

export interface AutoSettleSettings {
  /** Settle sessions idle for this many days; null turns automatic settling off. */
  afterDays: number | null;
}

export const DEFAULT_AUTO_SETTLE_SETTINGS: AutoSettleSettings = { afterDays: 3 };
export const MAX_AUTO_SETTLE_DAYS = 365;

export function normalizeAutoSettleSettings(raw: unknown): AutoSettleSettings {
  const value = (raw && typeof raw === "object" ? raw : {}) as { afterDays?: unknown };
  if (value.afterDays === null) return { afterDays: null };
  const days = Number(value.afterDays);
  return Number.isInteger(days) && days >= 1 && days <= MAX_AUTO_SETTLE_DAYS
    ? { afterDays: days }
    : DEFAULT_AUTO_SETTLE_SETTINGS;
}

function normalizeParticipants(value: unknown, owner: string | null): SessionParticipant[] {
  const list = Array.isArray(value)
    ? value.flatMap((entry): SessionParticipant[] => {
        if (!entry || typeof entry !== "object") return [];
        const { userId } = entry as { userId?: unknown };
        if (userId !== null && typeof userId !== "string") return [];
        return [{ userId, role: "owner" }];
      })
    : [];
  return list.length ? list : [{ userId: owner, role: "owner" }];
}

const finite = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/**
 * Old or partial records get the current shape; unknown fields are dropped. Rows from the earlier
 * close model migrate: closed becomes settled by the owner, a pending close a pending settle.
 */
export function normalizeLifecycleRecord(
  sessionId: string,
  raw: unknown,
  owner: string | null = null,
): SessionLifecycleRecord {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const participants = normalizeParticipants(value.participants, owner);
  const legacyClosing = value.closing as { requestedAt?: unknown } | undefined;
  if (value.state === "settled" || value.state === "closed") {
    const settledAt = finite(value.settledAt) ?? finite(value.closedAt);
    return {
      sessionId,
      state: "settled",
      participants,
      ...(settledAt !== undefined ? { settledAt } : {}),
      settledBy: value.settledBy === "auto" ? "auto" : "owner",
    };
  }
  if (value.state === "settling" || (value.state === "closing" && legacyClosing)) {
    const requestedAt = finite(value.settleRequestedAt) ?? finite(legacyClosing?.requestedAt) ?? 0;
    return { sessionId, state: "settling", participants, settleRequestedAt: requestedAt };
  }
  return {
    sessionId,
    state: "active",
    participants,
    ...(value.keepActive === true ? { keepActive: true } : {}),
  };
}

/** A record that says nothing beyond the default needs no row on disk. */
export function isDefaultLifecycleRecord(record: SessionLifecycleRecord): boolean {
  return record.state === "active" && !record.keepActive;
}

/** What the lifecycle service needs from its persistence; the Host store implements it. */
export interface SessionLifecycleStore {
  get(sessionId: string): Promise<SessionLifecycleRecord>;
  list(): Promise<SessionLifecycleRecord[]>;
  update<T>(
    sessionId: string,
    change: (current: SessionLifecycleRecord) => { next?: SessionLifecycleRecord; result: T },
  ): Promise<T>;
  autoSettleSettings(): Promise<AutoSettleSettings>;
  saveAutoSettleSettings(settings: AutoSettleSettings): Promise<AutoSettleSettings>;
}
