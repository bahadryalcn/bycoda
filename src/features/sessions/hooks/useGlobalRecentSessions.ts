import { useGracedFailure } from "../../connections/public/transientFailure";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SessionSummary } from "../data/sessionStore";
import {
  EMPTY_CATALOG,
  SessionCatalog,
  sameSummaryRows,
  type CatalogQuery,
  type CatalogSegmentKey,
  type CatalogSegmentState,
  type CatalogSnapshot,
} from "../data/sessionCatalog";
import type { SettledMark } from "../data/sessionListFeed";
import type { Session } from "../model/session";
import { mergeGlobalRecentSessions } from "../model/globalRecentSessions";
import { useSessionLifecycleSnapshot } from "../model/sessionLifecycleClient";
import { isRemoteProjectPath } from "../../projects/public/recents";
import { pathKey, projectKey } from "../../../shared/lib/paths";
import { remoteSessionFor } from "../../connections/public/connections";
import { useStableValue } from "../../../shared/hooks/useStableValue";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";

export type { CatalogSegmentKey } from "../data/sessionCatalog";

const NO_ROWS: SessionSummary[] = [];
const NO_PROJECTS: readonly string[] = [];
const NO_QUERY: CatalogQuery = {};
const IDLE_SEGMENT: CatalogSegmentState = { status: "idle", loaded: 0 };

/** `cwd` is one stored path of the project, for its name and icon before any row loads. */
export type CatalogProject = { key: string; cwd: string; count: number; latestActivityAt: number };

export function useGlobalRecentSessions(
  history: readonly SessionSummary[],
  sessions: readonly Session[],
  enabled: boolean,
  allowedProjectKeys: ReadonlySet<string>,
  remoteRows: readonly SessionSummary[] = NO_ROWS,
  freshRemoteProjects: readonly string[] = NO_PROJECTS,
): {
  rows: SessionSummary[];
  loading: boolean;
  error: string | null;
  remoteHistoryLimited: boolean;
  refresh: () => void;
  /** Owned by the Sidebar; changing it resets every segment. */
  setQuery: (query: { since?: number; title?: string; archived?: boolean }) => void;
  catalog: {
    projects: CatalogProject[];
    settledCount: number;
    segment: (key: CatalogSegmentKey) => CatalogSegmentState;
    loadMore: (key: CatalogSegmentKey) => void;
  };
} {
  const [view, setView] = useState<CatalogSnapshot>(EMPTY_CATALOG);
  const [failure, setFailure] = useState<{ cause: unknown } | null>(null);
  const [query, setQueryState] = useState<CatalogQuery>(NO_QUERY);
  const engine = useRef<SessionCatalog | null>(null);
  const { views } = useSessionLifecycleSnapshot();
  // The Host's settled records are the native list's settle state; only a change of them matters.
  const marksKey = JSON.stringify(
    [...views.values()]
      .filter((entry) => entry.state === "settled")
      .map((entry): SettledMark => ({ id: entry.sessionId, settledAt: entry.settledAt ?? null }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  );
  const refresh = useCallback(() => engine.current?.refresh(), []);
  const setQuery = useCallback((next: { since?: number; title?: string; archived?: boolean }) => {
    const title = next.title?.trim() || undefined;
    const archived = next.archived === true;
    setQueryState((previous) =>
      previous.since === next.since &&
      previous.title === title &&
      (previous.archived ?? false) === archived
        ? previous
        : {
            ...(next.since === undefined ? {} : { since: next.since }),
            ...(title ? { title } : {}),
            ...(archived ? { archived } : {}),
          },
    );
  }, []);
  const loadMore = useCallback((key: CatalogSegmentKey) => engine.current?.loadMore(key), []);
  const latest = useStableCallback(() => ({ query, marksKey }));
  const freshKeys = useMemo(() => new Set(freshRemoteProjects.map(pathKey)), [freshRemoteProjects]);
  // Only the open panel reads the rows, so a closed one builds nothing: tool starts and status
  // changes in any open session would otherwise re-merge all history and rescan every live
  // transcript. Opening builds from the current inputs in the same render.
  const merged = useMemo(() => {
    if (!enabled) return NO_ROWS;
    const listedByProject = new Map<string, Set<string>>();
    for (const row of remoteRows) {
      const key = pathKey(row.cwd);
      const ids = listedByProject.get(key) ?? new Set<string>();
      ids.add(row.id);
      listedByProject.set(key, ids);
    }
    const keep = (row: { cwd: string; id: string }) => {
      if (!isRemoteProjectPath(row.cwd)) return true;
      const key = pathKey(row.cwd);
      return (
        !freshKeys.has(key) && !listedByProject.get(key)?.has(remoteSessionFor(row.id) ?? row.id)
      );
    };
    return mergeGlobalRecentSessions(
      view.stored.filter(keep),
      [...history.filter(keep), ...remoteRows],
      sessions.filter(keep),
      allowedProjectKeys,
      query.archived === true,
    );
  }, [
    enabled,
    view.stored,
    history,
    sessions,
    allowedProjectKeys,
    remoteRows,
    freshKeys,
    query.archived,
  ]);
  const rows = useStableValue(merged, sameSummaryRows);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Own the paged native catalog while the panel is open: it polls the store revision, refetches on focus and stops with the panel.
  useEffect(() => {
    if (!enabled) return;
    const initial = latest();
    const marks = JSON.parse(initial.marksKey) as SettledMark[];
    const catalog = new SessionCatalog(
      {
        onChange: setView,
        onError: (cause) => setFailure(cause === null ? null : { cause }),
      },
      initial.query,
      marks,
      initial.marksKey,
    );
    engine.current = catalog;
    catalog.start();
    return () => {
      catalog.stop();
      engine.current = null;
      setView(EMPTY_CATALOG);
      setFailure(null);
    };
  }, [enabled, latest]);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Push the owner's query into the running catalog, which resets its segments.
  useEffect(() => {
    engine.current?.setQuery(query);
  }, [query]);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Push changed settled records into the running catalog, which re-queries without resetting.
  useEffect(() => {
    engine.current?.setMarks(JSON.parse(marksKey) as SettledMark[], marksKey);
  }, [marksKey]);
  const remoteHistoryLimited = useMemo(
    () => [...allowedProjectKeys].some((key) => isRemoteProjectPath(key) && !freshKeys.has(key)),
    [allowedProjectKeys, freshKeys],
  );
  const { visibleError, pending } = useGracedFailure({
    error: enabled ? failure?.cause : undefined,
    retry: refresh,
  });
  const visibleLoading = enabled && (view.loading || pending);
  const error = visibleError ?? null;
  const catalog = useMemo(() => {
    const byProject = new Map<string, CatalogProject>();
    for (const group of enabled ? view.groups : []) {
      if (!allowedProjectKeys.has(pathKey(group.cwd))) continue;
      const key = projectKey(group.cwd);
      const entry = byProject.get(key) ?? { key, cwd: group.cwd, count: 0, latestActivityAt: 0 };
      entry.count += group.count;
      entry.latestActivityAt = Math.max(entry.latestActivityAt, group.latestActivityAt);
      byProject.set(key, entry);
    }
    return {
      projects: [...byProject.values()].sort((a, b) => b.latestActivityAt - a.latestActivityAt),
      settledCount: enabled ? view.settledCount : 0,
      segment: (key: CatalogSegmentKey) => view.segments.get(key) ?? IDLE_SEGMENT,
      loadMore,
    };
  }, [enabled, view, allowedProjectKeys, loadMore]);
  return useMemo(
    () => ({
      rows,
      loading: visibleLoading,
      error,
      remoteHistoryLimited,
      refresh,
      setQuery,
      catalog,
    }),
    [rows, visibleLoading, error, remoteHistoryLimited, refresh, setQuery, catalog],
  );
}
