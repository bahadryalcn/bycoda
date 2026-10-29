import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import {
  subscribeGitChanged,
  type GitChangeScope,
  type GitDiffIndex,
} from "../../../platform/tauri/fs";
import { invalidateWatchedFiles } from "../../files/model/fileWatch";
import { isRemoteProjectPath } from "../../projects/model/recents";
import { remotePollDue, reportRemoteLoad } from "../../connections/model/remoteHealth";
import { sameConflicts } from "../model/conflictSection";
import { gitPanelRuntime } from "../model/gitPanelState";
import {
  fetchGitIndex,
  peekFullGitIndex,
  notifyGitChangedWith,
  type GitChangeHint,
} from "../model/gitIndexStore";
import {
  ACTIVE_PROJECT_REFRESH_MS,
  GIT_PANEL_ENTRY_FRESH_MS,
  GIT_PANEL_FOCUS_FRESH_MS,
} from "../model/gitRefreshPolicy";
import { applyProjectDiffStats } from "./useProjectDiffStats";

const indexByCwd = new Map<string, GitDiffIndex>();

/** Observations already contain a fresh index; mutations need a new read. */
let announcingObservedChange = false;

export function announceGitChange(cwd: string, scope: GitChangeScope, hint: GitChangeHint = {}) {
  announcingObservedChange = hint.observed === true;
  try {
    notifyGitChangedWith(cwd, scope, hint);
  } finally {
    announcingObservedChange = false;
  }
}

export function useDiffIndex(
  cwd: string,
  enabled: boolean,
  polling: boolean,
  panel: RefObject<HTMLDivElement | null>,
): {
  index: GitDiffIndex | null;
  reload: () => void;
  showOptimistic: (next: GitDiffIndex) => void;
  error: string | null;
  loading: boolean;
} {
  // A remote project keeps its last good index when a load fails; the failure
  // is shown by `ChangedFiles`.
  const remote = isRemoteProjectPath(cwd);
  const [index, setIndex] = useState<GitDiffIndex | null>(() => cachedIndex(cwd));
  const [nonce, setNonce] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const handledRefresh = useRef({ cwd, nonce: 0 });
  const failedRead = useRef<{ cwd: string; at: number } | null>(null);
  const indexRef = useRef(index);
  useLayoutEffect(() => {
    indexRef.current = index;
  }, [index]);
  // An optimistic index is on screen and its git command may still be
  // running: a poll that started earlier must not put the old rows back.
  const holdRef = useRef(false);
  // The caller of `reload` announces its change itself.
  const announcedRef = useRef(false);
  const reload = useCallback(() => {
    holdRef.current = false;
    announcedRef.current = true;
    setNonce((value) => value + 1);
  }, []);
  const showOptimistic = useCallback(
    (next: GitDiffIndex) => {
      holdRef.current = true;
      indexByCwd.set(cwd, next);
      indexRef.current = next;
      setIndex(next);
    },
    [cwd],
  );

  useEffect(() => {
    if (!enabled || !cwd || cwd === "~") {
      return;
    }
    const cached = cachedIndex(cwd);
    if (cached && !sameIndex(indexRef.current, cached)) {
      indexRef.current = cached;
      setIndex(cached);
    }
    let cancelled = false;
    let inFlight = false;
    let pending = false;

    const load = async (fresh = false, maxAgeMs = ACTIVE_PROJECT_REFRESH_MS) => {
      if (inFlight) {
        pending ||= fresh;
        return;
      }
      if (document.hidden && !fresh) return;
      if (
        !fresh &&
        failedRead.current?.cwd === cwd &&
        Date.now() - failedRead.current.at < ACTIVE_PROJECT_REFRESH_MS
      )
        return;
      inFlight = true;
      setLoading(!indexRef.current);
      try {
        // Reopening may reuse a recent full index; explicit refresh and known
        // changes always read beyond the shared cache.
        const next = await fetchGitIndex(cwd, {
          full: true,
          since: fresh ? Date.now() : Date.now() - maxAgeMs + 1,
        });
        if (cancelled || holdRef.current) return;
        failedRead.current = null;
        setError(null);
        if (remote) reportRemoteLoad(cwd, "changes");
        const prev = indexRef.current;
        const announced = announcedRef.current;
        announcedRef.current = false;
        applyProjectDiffStats(
          cwd,
          {
            files: next.files.length + (next.conflicts?.length ?? 0),
            additions: next.additions,
            deletions: next.deletions,
          },
          peekFullGitIndex(cwd)?.at,
        );
        if (sameIndex(prev, next)) return;
        indexByCwd.set(cwd, next);
        indexRef.current = next;
        setIndex(next);
        if (prev) {
          const paths = changedFilePaths(prev, next);
          invalidateWatchedFiles(paths);
          // Found by the poll (an agent, a terminal): tell the other git views,
          // and spare the commit graph when only files moved.
          if (!announced) {
            // The shared index was just read, so keep it; only an index change
            // can name the files whose contents moved.
            const index = sameRefs(prev, next);
            announceGitChange(cwd, index ? "index" : "refs", {
              observed: true,
              paths: index ? paths : undefined,
            });
          }
        }
      } catch (error) {
        if (cancelled) return;
        failedRead.current = { cwd, at: Date.now() };
        if (remote) {
          reportRemoteLoad(cwd, "changes", error);
        } else {
          setError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!cancelled) setLoading(false);
        inFlight = false;
        if (pending && !cancelled) {
          pending = false;
          void load(true);
        }
      }
    };

    const explicitRefresh =
      handledRefresh.current.cwd === cwd && handledRefresh.current.nonce !== nonce;
    handledRefresh.current = { cwd, nonce };
    void load(explicitRefresh, GIT_PANEL_ENTRY_FRESH_MS);
    const onResume = () => {
      if (polling && !document.hidden) void load();
    };
    const pane = panel.current;
    const onPanelInteraction = () => {
      // Keep pending optimistic changes until their mutation confirms the index.
      if (document.hidden || holdRef.current || gitPanelRuntime(cwd).state.busy) return;
      void load(false, GIT_PANEL_FOCUS_FRESH_MS);
    };
    const onPanelFocus = (event: FocusEvent) => {
      // Moving between controls in this panel is not a new panel entry.
      if (event.relatedTarget instanceof Node && pane?.contains(event.relatedTarget)) return;
      onPanelInteraction();
    };
    pane?.addEventListener("focusin", onPanelFocus);
    pane?.addEventListener("pointerdown", onPanelInteraction);
    // Polling slows while a remote machine is unreachable.
    const timer = window.setInterval(() => {
      // Local polls wait for window focus; `focus` above refreshes on return.
      if (remote ? remotePollDue(cwd) : document.hasFocus()) onResume();
    }, ACTIVE_PROJECT_REFRESH_MS);
    window.addEventListener("focus", onResume);
    document.addEventListener("visibilitychange", onResume);
    const unsubGit = subscribeGitChanged(
      () => {
        if (!announcingObservedChange) {
          // A mutation can finish in a panel that has already unmounted.
          // Release this mounted panel's optimistic hold and refresh it too.
          holdRef.current = false;
          announcedRef.current = true;
          if (polling && !document.hidden) void load(true);
        }
      },
      { cwd },
    );
    return () => {
      cancelled = true;
      pane?.removeEventListener("focusin", onPanelFocus);
      pane?.removeEventListener("pointerdown", onPanelInteraction);
      window.clearInterval(timer);
      window.removeEventListener("focus", onResume);
      document.removeEventListener("visibilitychange", onResume);
      unsubGit();
    };
  }, [cwd, enabled, nonce, remote, polling, panel]);

  return { index, reload, showOptimistic, error, loading };
}

/** Whether HEAD, its branch and its upstream counts are unchanged. */
function sameRefs(prev: GitDiffIndex, next: GitDiffIndex): boolean {
  return (
    prev.branch === next.branch &&
    prev.head === next.head &&
    prev.upstream === next.upstream &&
    prev.ahead === next.ahead &&
    prev.behind === next.behind &&
    prev.aheadOfDefault === next.aheadOfDefault &&
    prev.headPushed === next.headPushed &&
    (prev.operation ?? null) === (next.operation ?? null)
  );
}

function cachedIndex(cwd: string | undefined): GitDiffIndex | null {
  if (!cwd || cwd === "~") return null;
  return indexByCwd.get(cwd) ?? null;
}

function changedFilePaths(prev: GitDiffIndex, next: GitDiffIndex): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  const previous = new Map(prev.files.map((file) => [file.relative, file]));
  const current = new Set(next.files.map((file) => file.relative));
  for (const file of next.files) {
    const before = previous.get(file.relative);
    if (
      !before ||
      before.status !== file.status ||
      before.additions !== file.additions ||
      before.deletions !== file.deletions ||
      before.staged !== file.staged ||
      before.unstaged !== file.unstaged
    ) {
      paths.push(file.path);
      seen.add(file.path);
    }
  }
  for (const file of prev.files) {
    if (!current.has(file.relative) && !seen.has(file.path)) {
      paths.push(file.path);
    }
  }
  // A file entering, leaving or changing kind has new contents on disk.
  const before = new Map((prev.conflicts ?? []).map((file) => [file.relative, file]));
  const after = new Map((next.conflicts ?? []).map((file) => [file.relative, file]));
  for (const [relative, file] of after) {
    if (before.get(relative)?.kind !== file.kind) paths.push(file.path);
  }
  for (const [relative, file] of before) if (!after.has(relative)) paths.push(file.path);
  return paths;
}

function sameIndex(prev: GitDiffIndex | null, next: GitDiffIndex): boolean {
  if (!prev) return false;
  if (
    prev.branch !== next.branch ||
    prev.head !== next.head ||
    prev.additions !== next.additions ||
    prev.deletions !== next.deletions ||
    prev.files.length !== next.files.length ||
    prev.remote !== next.remote ||
    prev.upstream !== next.upstream ||
    prev.defaultBranch !== next.defaultBranch ||
    prev.ahead !== next.ahead ||
    prev.behind !== next.behind ||
    prev.aheadOfDefault !== next.aheadOfDefault ||
    prev.headPushed !== next.headPushed ||
    (prev.operation ?? null) !== (next.operation ?? null) ||
    !sameConflicts(prev.conflicts, next.conflicts)
  ) {
    return false;
  }
  return prev.files.every((file, i) => {
    const other = next.files[i];
    return (
      other &&
      file.relative === other.relative &&
      file.status === other.status &&
      file.additions === other.additions &&
      file.deletions === other.deletions &&
      file.staged === other.staged &&
      file.unstaged === other.unstaged
    );
  });
}
