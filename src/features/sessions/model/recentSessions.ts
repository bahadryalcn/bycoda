import { sessionIssue } from "./sessionIssue";
import { pathKey } from "../../../shared/lib/paths";
import { isRemoteProjectPath } from "../../projects/model/recents";
import { sessionDisplayTitle, sessionNeedsInput, type HarnessId, type Session } from "./session";

/** Minimal shape of a stored session row; `SessionSummary` satisfies it. */
export type StoredSessionRow = {
  id: string;
  cwd: string;
  title: string;
  harness: HarnessId;
  model: string;
  updatedAt: number;
  pinned?: boolean;
};

export type RecentSessionStatus = "working" | "input" | "done" | "retrying" | "failed";

/** What the in-memory sessions add to the stored rows. */
export type LiveSessionInfo = {
  id: string;
  cwd: string;
  title: string;
  harness: HarnessId;
  model: string;
  status?: RecentSessionStatus;
  /** Last user turn, for sessions the store does not hold (remote machines). */
  activityAt: number;
};

export type RecentSessionRow = {
  id: string;
  cwd: string;
  title: string;
  harness: HarnessId;
  model: string;
  updatedAt: number;
  pinned: boolean;
  /** Pinning writes to the local store, which holds no remote sessions. */
  pinnable: boolean;
  remote: boolean;
  status?: RecentSessionStatus;
};

/** Row counts the header offers. The last one is "All recent". */
export const RECENT_SESSION_COUNTS = [3, 5, 10, 20, 50] as const;
export type RecentSessionCount = (typeof RECENT_SESSION_COUNTS)[number];
export const DEFAULT_RECENT_SESSION_COUNT: RecentSessionCount = 10;
/** Rows the store query returns; pinned sessions come on top of it. */
export const RECENT_SESSION_FETCH_LIMIT = 100;

export function recentCountLabel(count: RecentSessionCount): string {
  return count === 50 ? "All recent" : `Last ${count}`;
}

export type RecentSessionsPrefs = {
  collapsed: boolean;
  count: RecentSessionCount;
};

const PREFS_KEY = "bycoda.lastSessions";

export function loadRecentSessionsPrefs(): RecentSessionsPrefs {
  const fallback = {
    collapsed: false,
    count: DEFAULT_RECENT_SESSION_COUNT,
  };
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "");
    if (!parsed || typeof parsed !== "object") return fallback;
    const { collapsed, count } = parsed as Record<string, unknown>;
    return {
      collapsed: collapsed === true,
      count: RECENT_SESSION_COUNTS.find((option) => option === count) ?? fallback.count,
    };
  } catch {
    return fallback;
  }
}

export function saveRecentSessionsPrefs(prefs: RecentSessionsPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // private mode / quota
  }
}

/** A chat the user has actually written in; blank tabs and unsent drafts do not count. */
function hasSentTurn(session: Session): boolean {
  return session.blocks.some((block) => block.role === "user" && !block.draft);
}

function lastTurnAt(session: Session): number {
  for (let i = session.blocks.length - 1; i >= 0; i--) {
    const block = session.blocks[i];
    if (block.role === "user" && !block.draft) {
      return (block.startedAt ?? 0) + (block.durationMs ?? 0);
    }
  }
  return 0;
}

export function liveSessionInfos(
  sessions: readonly Session[],
  unseenFinishedIds: ReadonlySet<string> = new Set(),
): LiveSessionInfo[] {
  const infos: LiveSessionInfo[] = [];
  for (const session of sessions) {
    if (session.inboxAsk || session.orchestrationLeadId) continue;
    if (!hasSentTurn(session)) continue;
    const needsInput = sessionNeedsInput(session);
    const busy = !session.worktreeRemoved && (!!session.busy || !!session.continuingElsewhere);
    infos.push({
      id: session.id,
      cwd: session.cwd,
      title: session.title,
      harness: session.harness,
      model: session.model,
      status:
        sessionIssue(session) ??
        (needsInput
          ? "input"
          : busy
            ? "working"
            : unseenFinishedIds.has(session.id)
              ? "done"
              : undefined),
      activityAt: lastTurnAt(session),
    });
  }
  return infos;
}

export function sameLiveSessionInfos(
  a: readonly LiveSessionInfo[],
  b: readonly LiveSessionInfo[],
): boolean {
  return (
    a.length === b.length &&
    a.every((left, index) => {
      const right = b[index];
      return (
        left.id === right.id &&
        left.cwd === right.cwd &&
        left.title === right.title &&
        left.harness === right.harness &&
        left.model === right.model &&
        left.status === right.status &&
        left.activityAt === right.activityAt
      );
    })
  );
}

function comparePinnedThenRecent(a: RecentSessionRow, b: RecentSessionRow) {
  return (
    Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)
  );
}

/**
 * Stored rows overlaid with what is running now, restricted to the projects on
 * the rail. Pinned sessions come first (most recent first), within the same
 * total row limit as the remaining recent sessions.
 */
export function buildRecentSessions({
  stored,
  live,
  projectKeys,
  limit,
  now,
}: {
  stored: readonly StoredSessionRow[];
  live: readonly LiveSessionInfo[];
  projectKeys: ReadonlySet<string>;
  limit: number;
  now: number;
}): RecentSessionRow[] {
  const liveById = new Map(live.map((info) => [info.id, info]));
  const rows = new Map<string, RecentSessionRow>();
  for (const row of stored) {
    if (!projectKeys.has(pathKey(row.cwd))) continue;
    const info = liveById.get(row.id);
    const active = info?.status === "working" || info?.status === "input";
    rows.set(row.id, {
      id: row.id,
      cwd: row.cwd,
      title: sessionDisplayTitle(info?.title ?? row.title, row.harness),
      harness: row.harness,
      model: info?.model || row.model,
      updatedAt: active ? Math.max(row.updatedAt, now) : row.updatedAt,
      pinned: !!row.pinned,
      pinnable: true,
      remote: isRemoteProjectPath(row.cwd),
      status: info?.status,
    });
  }
  // A session the store does not hold: a remote one, or a local one that has
  // only just started. An idle local one is skipped, since it is either older
  // than the stored window or about to arrive with the next fetch.
  for (const info of live) {
    if (rows.has(info.id) || !projectKeys.has(pathKey(info.cwd))) continue;
    const remote = isRemoteProjectPath(info.cwd);
    if (!remote && !info.status) continue;
    rows.set(info.id, {
      id: info.id,
      cwd: info.cwd,
      title: sessionDisplayTitle(info.title, info.harness),
      harness: info.harness,
      model: info.model,
      updatedAt: info.status === "working" || info.status === "input" ? now : info.activityAt,
      pinned: false,
      pinnable: false,
      remote,
      status: info.status,
    });
  }
  const sorted = [...rows.values()].sort(comparePinnedThenRecent);
  return sorted.slice(0, limit);
}

/** Compact age: "now", "5m", "3h 20m", "2d", then a short date. */
export function formatRelative(value: number, now: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  const seconds = Math.max(0, Math.round((now - value) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest ? `${hours}h ${rest}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
    }).format(new Date(value));
  } catch {
    return "";
  }
}
