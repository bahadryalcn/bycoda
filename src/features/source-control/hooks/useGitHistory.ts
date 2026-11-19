import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { gitHistory, type GitHistoryCommit } from "../../../platform/tauri/fs";
import { isRemoteProjectPath } from "../../projects/public/recents";
import { reportRemoteLoad, useRemoteLoadFailure } from "../../connections/public/remoteHealth";
import { presentRemoteError } from "../../connections/public/remoteFailure";
import { useGitResource } from "./useGitResource";

const HISTORY_PAGE = 200;
// The Host and native readers clamp one request to this many commits.
const HISTORY_READ_MAX = 5000;

/** Pages read after the resource's own read; valid only while `base` is the shown snapshot. */
type Continuation = {
  base: GitHistoryCommit[];
  commits: GitHistoryCommit[];
  ended: boolean;
  loading: boolean;
  error: string | null;
};

/**
 * Commit history for the graph. One cache entry holds each checkout and scope, and
 * "load more" reads only the next page (`skip`) of the same topological walk instead
 * of fetching and caching every longer prefix again. A refresh after a ref change
 * re-reads what was loaded in one request, so pages never mix two ref states.
 */
export function useGitHistory(cwd: string, enabled: boolean, all: boolean) {
  const failure = useRemoteLoadFailure(cwd, "graph");
  const remote = isRemoteProjectPath(cwd);
  const scope = `${cwd}:${all}`;
  // Commits shown for the scope, so a refresh keeps the depth the owner scrolled to.
  const loaded = useRef({ scope, count: HISTORY_PAGE });
  // The snapshot a read returned fewer commits than it asked for: no more history.
  const ended = useRef<GitHistoryCommit[] | null>(null);
  const read = useCallback(async () => {
    const depth = loaded.current.scope === scope ? loaded.current.count : HISTORY_PAGE;
    const requested = Math.min(Math.max(depth, HISTORY_PAGE), HISTORY_READ_MAX);
    const { commits } = await gitHistory(cwd, requested, all);
    loaded.current = { scope, count: commits.length };
    if (commits.length < requested) ended.current = commits;
    return commits;
  }, [cwd, all, scope]);
  const resource = useGitResource(
    cwd,
    `history:${cwd}:${all}`,
    enabled && !!cwd && cwd !== "~",
    read,
  );
  const base = resource.data;
  const [continuation, setContinuation] = useState<Continuation | null>(null);
  const tail = base && continuation?.base === base ? continuation : null;
  const commits = useMemo(
    () => (!base ? [] : tail && tail.commits.length ? base.concat(tail.commits) : base),
    [base, tail],
  );
  const hasMore =
    !!base && (tail ? !tail.ended : base.length >= HISTORY_PAGE && ended.current !== base);

  const loadMore = () => {
    if (!base || tail?.loading || !hasMore) return;
    const prior = tail?.commits ?? [];
    const skip = base.length + prior.length;
    setContinuation({ base, commits: prior, ended: false, loading: true, error: null });
    gitHistory(cwd, HISTORY_PAGE, all, skip).then(
      (page) => {
        // An older Host ignores `skip`; commits already shown are never added twice.
        const known = new Set([...base, ...prior].map((commit) => commit.sha));
        const fresh = page.commits.filter((commit) => !known.has(commit.sha));
        loaded.current = { scope, count: skip + fresh.length };
        // A refresh or scope change since the request replaced `base`; the page is then stale.
        setContinuation((current) =>
          current?.base === base
            ? {
                base,
                commits: prior.concat(fresh),
                ended: fresh.length === 0 || page.commits.length < HISTORY_PAGE,
                loading: false,
                error: null,
              }
            : current,
        );
      },
      (error: unknown) =>
        setContinuation((current) =>
          current?.base === base
            ? { ...current, loading: false, error: presentRemoteError(error, { explicit: true }) }
            : current,
        ),
    );
  };

  const error = resource.error ?? tail?.error ?? null;
  useEffect(() => {
    if (enabled && remote && !resource.loading)
      reportRemoteLoad(cwd, "graph", resource.error ?? undefined);
  }, [cwd, enabled, remote, resource.loading, resource.error]);
  return {
    commits,
    hasMore,
    loadMore,
    loading: resource.loading || !!tail?.loading,
    error,
    failure,
    refresh: resource.refresh,
  };
}
