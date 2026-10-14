import { projectDisplayName } from "../../projects/model/projectNames";
import { pathKey } from "../../../shared/lib/paths";
import { projectGroupIdForPath, type ProjectGroup } from "../../projects/model/projectGroups";
import type { RecentProject } from "../../projects/model/recents";
import { sessionDisplayTitle, type HarnessId } from "../../sessions/model/session";
import type { SessionContentSession } from "../../sessions/data/sessionStore";
import { asHarness, recencyBonus, type AppSearchHit } from "./appSearch";

export type ChatScope = "everywhere" | "group" | "project";
export type ChatDateRange = "any" | "week" | "month" | "year";

export type ChatFilters = {
  scope: ChatScope;
  harness: HarnessId | "any";
  range: ChatDateRange;
  archived: boolean;
};

export const DEFAULT_CHAT_FILTERS: ChatFilters = {
  scope: "everywhere",
  harness: "any",
  range: "any",
  archived: false,
};

export type ProjectGrouping = {
  groups: ProjectGroup[];
  assignments: Record<string, string>;
};

const DAY = 24 * 60 * 60 * 1000;
const RANGE_DAYS: Record<Exclude<ChatDateRange, "any">, number> = {
  week: 7,
  month: 30,
  year: 365,
};
/** Hits listed under a session; the rest are counted, not listed. */
export const MAX_VISIBLE_HITS = 3;

export function chatGroupFor(cwd: string, grouping: ProjectGrouping): ProjectGroup | undefined {
  const id = projectGroupIdForPath(cwd, grouping.assignments);
  return id ? grouping.groups.find((group) => group.id === id) : undefined;
}

/** Project folders a scope covers; `undefined` means every project. */
export function scopeCwds(
  scope: ChatScope,
  cwd: string,
  recents: RecentProject[],
  grouping: ProjectGrouping,
): string[] | undefined {
  if (scope === "everywhere") return undefined;
  if (scope === "project") return [cwd];
  const group = chatGroupFor(cwd, grouping);
  if (!group) return [cwd];
  const members = recents
    .map((recent) => recent.path)
    .filter((path) => chatGroupFor(path, grouping)?.id === group.id);
  return members.some((path) => pathKey(path) === pathKey(cwd)) ? members : [cwd, ...members];
}

export function sinceFor(range: ChatDateRange, now = Date.now()): number | undefined {
  return range === "any" ? undefined : now - RANGE_DAYS[range] * DAY;
}

export type ChatHitRow = {
  id: string;
  blockId: string;
  role: string;
  snippet: string;
  ranges: [number, number][];
};

export type ChatSessionRow = {
  id: string;
  sessionId: string;
  title: string;
  titleRanges: [number, number][];
  harness: HarnessId;
  updatedAt: number;
  archived: boolean;
  hitCount: number;
  hits: ChatHitRow[];
};

export type ChatProjectGroup = {
  key: string;
  cwd: string;
  name: string;
  /** Rail group the project is filed under, if any. */
  groupName?: string;
  sessions: ChatSessionRow[];
};

/** Results grouped by project, projects ordered by their most recent hit. */
export function groupChatSessions(
  sessions: SessionContentSession[],
  grouping: ProjectGrouping,
): ChatProjectGroup[] {
  const byProject = new Map<string, ChatProjectGroup>();
  for (const session of sessions) {
    const key = pathKey(session.cwd);
    let group = byProject.get(key);
    if (!group) {
      group = {
        key,
        cwd: session.cwd,
        name: projectDisplayName(session.cwd),
        groupName: chatGroupFor(session.cwd, grouping)?.name,
        sessions: [],
      };
      byProject.set(key, group);
    }
    const harness = asHarness(session.harness);
    const title = sessionDisplayTitle(session.title, harness);
    group.sessions.push({
      id: `session:${session.sessionId}`,
      sessionId: session.sessionId,
      title,
      // The ranges index the stored title, which only a verbatim title keeps.
      titleRanges: title === session.title ? session.titleRanges : [],
      harness,
      updatedAt: session.updatedAt,
      archived: session.archived,
      hitCount: session.hitCount,
      hits: session.hits.slice(0, MAX_VISIBLE_HITS).map((hit) => ({
        id: `hit:${session.sessionId}:${hit.blockId}`,
        blockId: hit.blockId,
        role: hit.role,
        snippet: hit.snippet,
        ranges: hit.ranges,
      })),
    });
  }
  return [...byProject.values()];
}

/** What arrow keys step through: each session, then its listed hits. */
export type ChatEntry = { id: string; sessionId: string; blockId?: string };

export function chatEntries(groups: ChatProjectGroup[]): ChatEntry[] {
  const entries: ChatEntry[] = [];
  for (const group of groups) {
    for (const session of group.sessions) {
      entries.push({
        id: session.id,
        sessionId: session.sessionId,
        blockId: session.hits[0]?.blockId,
      });
      for (const hit of session.hits) {
        entries.push({
          id: hit.id,
          sessionId: session.sessionId,
          blockId: hit.blockId,
        });
      }
    }
  }
  return entries;
}

/** Splits `text` into runs by UTF-16 `ranges` (sorted, non-overlapping). */
export function highlightRuns(
  text: string,
  ranges: [number, number][],
): { text: string; match: boolean }[] {
  const runs: { text: string; match: boolean }[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start < cursor || end > text.length || end <= start) continue;
    if (start > cursor) runs.push({ text: text.slice(cursor, start), match: false });
    runs.push({ text: text.slice(start, end), match: true });
    cursor = end;
  }
  if (cursor < text.length) runs.push({ text: text.slice(cursor), match: false });
  return runs;
}

/** The "All" tab's flat rows from the same search: title hits, then messages. */
export function hitsFromContentSessions(sessions: SessionContentSession[]): AppSearchHit[] {
  const hits: AppSearchHit[] = [];
  for (const session of sessions) {
    const harness = asHarness(session.harness);
    const title = sessionDisplayTitle(session.title, harness);
    if (session.titleRanges.length > 0) {
      hits.push({
        id: `conversation:${session.sessionId}`,
        kind: "conversation",
        sessionId: session.sessionId,
        cwd: session.cwd,
        harness,
        title,
        updatedAt: session.updatedAt,
        score: 10 + recencyBonus(session.updatedAt),
        positions: [],
      });
    }
    for (const hit of session.hits.slice(0, 2)) {
      hits.push({
        id: `message:${session.sessionId}:${hit.blockId}`,
        kind: "message",
        sessionId: session.sessionId,
        cwd: session.cwd,
        harness,
        title,
        updatedAt: session.updatedAt,
        blockId: hit.blockId,
        role: hit.role,
        preview: hit.snippet,
        score: 16 + recencyBonus(session.updatedAt),
      });
    }
  }
  return hits;
}

export function formatChatDate(timestamp: number, now = Date.now()): string {
  const date = new Date(timestamp);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}
