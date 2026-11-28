import type { SessionSummary } from "../data/sessionStore";
import { projectKey } from "../../../shared/lib/paths";
import { createStoredSetting } from "../../../shared/lib/storedSetting";
import { isProjectlessCwd } from "./recentSessions";
import type { GlobalSessionListView, SessionTimeFilter } from "./sessionFilters";

/** Group key of projectless sessions when Last sessions groups by project. */
export const PROJECTLESS_GROUP_KEY = "~";

/**
 * One block of the Last sessions list, in display order: Pinned first, then the view's groups
 * (projects with No project last), then the Settled shelf.
 */
export type GlobalSessionSection =
  | { kind: "pinned"; sessions: SessionSummary[] }
  | {
      kind: "group";
      key: string;
      sessions: SessionSummary[];
      total: number;
      /** A stored path of the group's project, also when none of its rows is loaded yet. */
      cwd: string;
    }
  | { kind: "settled"; sessions: SessionSummary[]; total: number };

/** What the paged catalog knows beyond the loaded rows: every group's size and age. */
export type GlobalSessionCatalogTotals = {
  projects: readonly { key: string; cwd: string; count: number; latestActivityAt: number }[];
  settledCount: number;
};

const activityAt = (session: SessionSummary) => session.lastActivityAt ?? session.updatedAt;

/**
 * Splits the listed sessions like the project list does: pinned sessions keep their own block
 * whatever their group or settle state, and settled sessions move to the shelf at the end.
 * Without `isSettled` (the Settled filter lists only settled sessions) there is no shelf.
 */
export function buildGlobalSessionSections(
  sessions: readonly SessionSummary[],
  view: GlobalSessionListView,
  stateOf: (session: SessionSummary) => string,
  isSettled?: (session: SessionSummary) => boolean,
  catalog?: GlobalSessionCatalogTotals,
): GlobalSessionSection[] {
  const ordered =
    view.sort === "oldest"
      ? [...sessions].sort((a, b) => activityAt(a) - activityAt(b))
      : [...sessions];
  const pinned: SessionSummary[] = [];
  const settled: SessionSummary[] = [];
  const groups = new Map<string, SessionSummary[]>();
  for (const session of ordered) {
    if (session.pinned) {
      pinned.push(session);
      continue;
    }
    if (isSettled?.(session)) {
      settled.push(session);
      continue;
    }
    const key =
      view.groupBy === "none"
        ? ""
        : view.groupBy === "state"
          ? stateOf(session)
          : isProjectlessCwd(session.cwd)
            ? PROJECTLESS_GROUP_KEY
            : projectKey(session.cwd);
    const group = groups.get(key);
    if (group) group.push(session);
    else groups.set(key, [session]);
  }
  const totals = new Map(catalog?.projects.map((project) => [project.key, project]));
  let groupOrder = [...groups.keys()];
  if (view.groupBy === "project" && catalog) {
    // Projects with unloaded history still get their header; the newest activity leads.
    for (const project of catalog.projects) if (!groups.has(project.key)) groups.set(project.key, []);
    const latest = (key: string) =>
      Math.max(
        totals.get(key)?.latestActivityAt ?? 0,
        ...groups.get(key)!.map((session) => activityAt(session)),
      );
    groupOrder = [...groups.keys()].sort((a, b) =>
      view.sort === "oldest" ? latest(a) - latest(b) : latest(b) - latest(a),
    );
  }
  if (view.groupBy === "project") {
    groupOrder = groupOrder.filter((key) => key !== PROJECTLESS_GROUP_KEY);
    if (groups.has(PROJECTLESS_GROUP_KEY)) groupOrder.push(PROJECTLESS_GROUP_KEY);
  }
  const sections: GlobalSessionSection[] = [];
  if (pinned.length) sections.push({ kind: "pinned", sessions: pinned });
  for (const key of groupOrder) {
    const group = groups.get(key)!;
    sections.push({
      kind: "group",
      key,
      sessions: group,
      total: Math.max(group.length, totals.get(key)?.count ?? 0),
      cwd: group[0]?.cwd ?? totals.get(key)?.cwd ?? key,
    });
  }
  const settledTotal = Math.max(settled.length, isSettled ? (catalog?.settledCount ?? 0) : 0);
  if (settledTotal) sections.push({ kind: "settled", sessions: settled, total: settledTotal });
  return sections;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * The native query's lower activity bound for a time filter. Rounded down to the hour so the
 * minute clock never changes the query; the list's own filter trims the extra rows exactly.
 */
export function globalSessionQuerySince(time: SessionTimeFilter, now: number): number | undefined {
  if (time === "all") return undefined;
  if (time === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return start.getTime();
  }
  const days = time === "7d" ? 7 : 30;
  return Math.floor((now - days * DAY_MS) / HOUR_MS) * HOUR_MS;
}

/** Collapse key of a section; the state and ungrouped views have no collapsible groups. */
export function globalSectionCollapseKey(
  section: GlobalSessionSection,
  view: GlobalSessionListView,
): string | null {
  if (section.kind === "pinned") return "pinned";
  if (section.kind === "settled") return "settled";
  return view.groupBy === "project" ? `project:${section.key}` : null;
}

/** The sessions a section shows; collapsed sections show none unless search expands them. */
export function visibleGlobalSections(
  sections: readonly GlobalSessionSection[],
  view: GlobalSessionListView,
  isCollapsed: (key: string) => boolean,
  expandCollapsed: boolean,
): { section: GlobalSessionSection; collapsed: boolean; shown: SessionSummary[] }[] {
  return sections.map((section) => {
    const key = globalSectionCollapseKey(section, view);
    const collapsed = !expandCollapsed && key !== null && isCollapsed(key);
    return { section, collapsed, shown: collapsed ? [] : section.sessions };
  });
}

export type GlobalSessionListPrefs = {
  view: GlobalSessionListView;
  /** Collapse keys of the Pinned block and project groups; Settled shares the project lists' state. */
  collapsed: string[];
};

export const DEFAULT_GLOBAL_SESSION_LIST_PREFS: GlobalSessionListPrefs = {
  view: { groupBy: "project", sort: "newest" },
  collapsed: [],
};

const GROUP_BY = new Set<GlobalSessionListView["groupBy"]>(["none", "project", "state"]);

export function parseGlobalSessionListPrefs(raw: string): GlobalSessionListPrefs {
  const value = JSON.parse(raw) as Partial<{
    view: Partial<GlobalSessionListView>;
    collapsed: unknown;
  }> | null;
  const groupBy = value?.view?.groupBy;
  return {
    view: {
      groupBy: groupBy && GROUP_BY.has(groupBy) ? groupBy : "project",
      sort: value?.view?.sort === "oldest" ? "oldest" : "newest",
    },
    collapsed: Array.isArray(value?.collapsed)
      ? value.collapsed.filter((key): key is string => typeof key === "string")
      : [],
  };
}

export const globalSessionListPrefs = createStoredSetting<GlobalSessionListPrefs>({
  key: "bycoda.lastSessionsList",
  fallback: DEFAULT_GLOBAL_SESSION_LIST_PREFS,
  parse: parseGlobalSessionListPrefs,
  serialize: (value) => JSON.stringify(value),
});
