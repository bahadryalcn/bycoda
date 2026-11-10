export { formatRecentRelative as formatRelative } from "../../../shared/i18n/format";
import { sessionIssue } from "./sessionIssue";
import {
  isUserConversation,
  type DelegationCollectionMetadata,
} from "../../../shared/model/host-contracts/delegation";
import { wasTurnInterrupted } from "./inFlight";
import { sessionActivityAt } from "./sessionActivity";
import { pathKey } from "../../../shared/lib/paths";
import { isRemoteProjectPath } from "../../projects/public/recents";
import { sessionDisplayTitle, sessionNeedsInput, type HarnessId, type Session } from "./session";

/** Minimal shape of a stored session row; `SessionSummary` satisfies it. */
export type StoredSessionRow = DelegationCollectionMetadata & {
  recentPinTarget?: import("../data/sessionPinReceipts").PinTarget | null;
  managedBy?: Session["managedBy"];
  id: string;
  cwd: string;
  title: string;
  harness: HarnessId;
  model: string;
  updatedAt: number;
  lastActivityAt?: number;
  pinned?: boolean;
  interrupted?: boolean;
};

export type RecentSessionStatus =
  | "working"
  | "input"
  | "done"
  | "retrying"
  | "failed"
  | "interrupted";

/** What the in-memory sessions add to the stored rows. */
export type LiveSessionInfo = DelegationCollectionMetadata & {
  managedBy?: Session["managedBy"];
  id: string;
  cwd: string;
  title: string;
  harness: HarnessId;
  model: string;
  status?: RecentSessionStatus;
  /** False when transcript hydration cannot yet establish the latest turn. */
  interruptionKnown?: boolean;
  /** Last user turn, for sessions the store does not hold (remote machines). */
  activityAt: number;
};

export type RecentSessionRow = {
  pinTarget?: import("../data/sessionPinReceipts").PinTarget | null;
  managedBy?: Session["managedBy"];
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

/** `cwd` of a session started without a project. Such sessions belong to no rail project. */
export const PROJECTLESS_CWD = "~";

export function isProjectlessCwd(cwd: string): boolean {
  return cwd === PROJECTLESS_CWD;
}

/** Project keys a recent-sessions list may show: the given projects plus projectless sessions. */
export function withProjectlessKey(keys: Iterable<string>): Set<string> {
  return new Set([...keys, pathKey(PROJECTLESS_CWD)]);
}

/** Row counts the header offers. The last one is "All recent". */
export const RECENT_SESSION_COUNTS = [3, 5, 10, 20, 50] as const;
export type RecentSessionCount = (typeof RECENT_SESSION_COUNTS)[number];
export const DEFAULT_RECENT_SESSION_COUNT: RecentSessionCount = 10;
/** Rows returned by the recent-session store query. */
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

export function liveSessionInfos(
  sessions: readonly Session[],
  unseenFinishedIds: ReadonlySet<string> = new Set(),
): LiveSessionInfo[] {
  const infos: LiveSessionInfo[] = [];
  for (const session of sessions) {
    if (session.inboxAsk || session.orchestrationLeadId || !isUserConversation(session)) continue;
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
            : wasTurnInterrupted(session)
              ? "interrupted"
              : unseenFinishedIds.has(session.id)
                ? "done"
                : undefined),
      interruptionKnown: !session.historyPartial && !session.historyLoading,
      activityAt: sessionActivityAt(session),
      managedBy: session.managedBy,
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
        left.interruptionKnown === right.interruptionKnown &&
        left.activityAt === right.activityAt &&
        left.managedBy?.jobId === right.managedBy?.jobId &&
        left.managedBy?.managedAt === right.managedBy?.managedAt
      );
    })
  );
}

function compareRecent(a: RecentSessionRow, b: RecentSessionRow) {
  return b.updatedAt - a.updatedAt || a.id.localeCompare(b.id);
}

/**
 * Stored rows overlaid with what is running now, restricted to the projects on
 * the rail, plus projectless sessions. Order by activity within the total row limit;
 * project pins do not change this cross-project list.
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
  const identity = (cwd: string, id: string) => JSON.stringify([pathKey(cwd), id]);
  const liveById = new Map(live.map((info) => [identity(info.cwd, info.id), info]));
  const rows = new Map<string, RecentSessionRow>();
  for (const row of stored) {
    if (!isUserConversation(row)) continue;
    const projectless = isProjectlessCwd(row.cwd);
    if (!projectless && !projectKeys.has(pathKey(row.cwd))) continue;
    const info = liveById.get(identity(row.cwd, row.id));
    const active = info?.status === "working" || info?.status === "input";
    rows.set(identity(row.cwd, row.id), {
      pinTarget: row.recentPinTarget ?? null,
      id: row.id,
      cwd: row.cwd,
      title: sessionDisplayTitle(info?.title ?? row.title, row.harness),
      harness: row.harness,
      model: info?.model || row.model,
      updatedAt: Math.max(
        row.lastActivityAt ?? row.updatedAt,
        info?.activityAt ?? 0,
        active ? now : 0,
      ),
      pinned: !!row.pinned,
      // shortcut: the pin owner layer refuses cwd "~", so projectless rows are not pinnable yet.
      pinnable: !projectless,
      remote: isRemoteProjectPath(row.cwd),
      status:
        info?.status ??
        (row.interrupted && (!info || info.interruptionKnown === false)
          ? "interrupted"
          : undefined),
      managedBy: info?.managedBy ?? row.managedBy,
    });
  }
  // A session the store does not hold: a remote one, or a local one that has
  // only just started. An idle local one is skipped, since it is either older
  // than the stored window or about to arrive with the next fetch.
  for (const info of live) {
    if (!isUserConversation(info)) continue;
    if (rows.has(identity(info.cwd, info.id))) continue;
    if (!isProjectlessCwd(info.cwd) && !projectKeys.has(pathKey(info.cwd))) continue;
    const remote = isRemoteProjectPath(info.cwd);
    if (!remote && !info.status) continue;
    rows.set(identity(info.cwd, info.id), {
      pinTarget: null,
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
      managedBy: info.managedBy,
    });
  }
  const sorted = [...rows.values()].sort(compareRecent);
  return sorted.slice(0, limit);
}
