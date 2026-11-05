import { useCallback, useEffect, useRef } from "react";
import { gitHistory, type GitHistoryCommit } from "../../../platform/tauri/fs";
import { isRemoteProjectPath } from "../../projects/public/recents";
import { reportRemoteLoad, useRemoteLoadFailure } from "../../connections/public/remoteHealth";
import { useGitResource } from "./useGitResource";

/** Commit history for the graph, keeping the previous page visible while a longer one loads. */
export function useGitHistory(cwd: string, enabled: boolean, all: boolean, limit: number) {
  const failure = useRemoteLoadFailure(cwd, "graph");
  const remote = isRemoteProjectPath(cwd);
  const read = useCallback(
    async () => (await gitHistory(cwd, limit, all)).commits,
    [cwd, limit, all],
  );
  const resource = useGitResource(
    cwd,
    `history:${cwd}:${all}:${limit}`,
    enabled && !!cwd && cwd !== "~",
    read,
  );
  // Paging changes the cache key, but keeps the previous page visible while
  // the longer history is loading. Never carry it across a checkout or scope.
  const retained = useRef<{
    cwd: string;
    all: boolean;
    commits: GitHistoryCommit[];
  } | null>(null);
  if (resource.data) retained.current = { cwd, all, commits: resource.data };
  const commits =
    resource.data ??
    (retained.current?.cwd === cwd && retained.current.all === all ? retained.current.commits : []);
  useEffect(() => {
    if (enabled && remote && !resource.loading)
      reportRemoteLoad(cwd, "graph", resource.error ?? undefined);
  }, [cwd, enabled, remote, resource.loading, resource.error]);
  return {
    commits,
    loading: resource.loading,
    error: resource.error,
    failure,
    refresh: resource.refresh,
  };
}
