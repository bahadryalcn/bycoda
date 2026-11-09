/**
 * Renderer view of the Host session lifecycle (settle, un-settle, task link). The Host owns the
 * state; these types mirror its wire shape. Settled is a list state, not a lock: the session stays
 * writable and its next message makes it active again. Nothing here reads archive or pin.
 */

export type SessionLifecycleState = "active" | "settling" | "settled";

export type SessionParticipant = { userId: string | null; role: "owner" };

export interface SessionLifecycleView {
  sessionId: string;
  state: SessionLifecycleState;
  participants: SessionParticipant[];
  settleRequestedAt?: number;
  settledAt?: number;
  settledBy?: "owner" | "auto";
  keepActive?: boolean;
}

export interface AutoSettleSettings {
  /** Days of inactivity before the Host settles a session; null is off. */
  afterDays: number | null;
  /** Days on the Settled shelf before the Host archives a session; null is off, absent on an older Host. */
  archiveAfterDays?: number | null;
}

export const AUTO_SETTLE_DAY_OPTIONS = [1, 3, 7, 14, 30] as const;
export const AUTO_ARCHIVE_DAY_OPTIONS = [7, 14, 30, 90] as const;

/** Saves that land just after a turn ends must not undo the settle that turn applied. */
export const SETTLE_ACTIVITY_GRACE_MS = 5000;

/**
 * Whether the sidebar files a session on its Settled shelf. Activity clearly newer than the settle
 * shows the session as active at once, before the Host's woken record is read again.
 */
export function isSettledSession(
  view: Pick<SessionLifecycleView, "state" | "settledAt"> | undefined,
  lastActivityAt: number | undefined,
): boolean {
  if (view?.state !== "settled") return false;
  if (lastActivityAt === undefined || view.settledAt === undefined) return true;
  return lastActivityAt <= view.settledAt + SETTLE_ACTIVITY_GRACE_MS;
}

/** One owner entry today; `null` userId while signed out. Readers must not assume a single entry. */
export function defaultParticipants(userId: string | null = null): SessionParticipant[] {
  return [{ userId, role: "owner" }];
}
