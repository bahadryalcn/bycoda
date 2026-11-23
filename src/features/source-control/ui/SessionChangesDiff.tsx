import { errorText } from "../../../shared/lib/errors";
import { isMissingPathError } from "../model/checkoutSelection";
import { presentRemoteError } from "../../connections/public/remoteFailure";
import { useReloadOnReconnect } from "../../connections/public/useReloadOnReconnect";
import { FailureState } from "../../../shared/ui/FailureState";
import { useConnectionErrorShownCentrally } from "../../../shared/ui/connectionErrorGate";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { t, useLocale } from "../../../shared/i18n/git";
import { useEffect, useMemo, useRef, useState } from "react";
import { SurfaceLoading } from "../../../shared/ui/SurfaceLoading";
import {
  sessionCheckpointFileDiff,
  sessionCheckpointStatus,
  subscribeReviewChanged,
  type CheckpointFile,
} from "../../sessions/public/checkpoint";

import { useNeededSections } from "../hooks/useNeededSections";
import { runDiffWorker } from "../model/diffWorker";
import {
  createLazyDiffLoader,
  LAZY_DIFF_CONCURRENCY,
  LAZY_DIFF_EAGER,
  type LazyDiffItem,
} from "../model/lazyDiffLoader";
import { reuseLoadedDiff } from "../model/workingTreeReload";
import { buildUnifiedFileAsync, type UnifiedFileDiff } from "../model/unifiedDiff";
import { StaleReviewNotice } from "./StaleReviewNotice";
import { UnifiedDiffView, type UnifiedDiffFileModel } from "./UnifiedDiffView";

type Props = {
  cwd: string;
  sessionId: string;
  focusPath?: string;
};

type LoadedDiff = {
  binary: boolean;
  tooLarge: boolean;
  original: string;
  current: string;
  unified: UnifiedFileDiff | null;
  error?: string;
};

type CachedModel = {
  file: CheckpointFile;
  loaded: LoadedDiff | undefined;
  model: UnifiedDiffFileModel;
  locale: ReturnType<typeof useLocale>;
};

type SessionDiffItem = LazyDiffItem & { file: CheckpointFile };

const REFRESH_DEBOUNCE_MS = 500;

/** Read-only review of the exact before/after snapshots owned by one session. */
export function SessionChangesDiff({ cwd, sessionId, focusPath }: Props) {
  const locale = useLocale();
  const [files, setFiles] = useState<CheckpointFile[] | null>(null);
  const [diffs, setDiffs] = useState<Map<string, LoadedDiff>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const shownCentrally = useConnectionErrorShownCentrally(error);
  const [retry, setRetry] = useState(0);
  const focusPathRef = useRef(focusPath);
  focusPathRef.current = focusPath;
  const refocusRef = useRef<(() => void) | null>(null);
  const refreshRef = useRef<(() => void) | null>(null);
  const { needed, pumpRef, onSectionNeeded } = useNeededSections();

  useEffect(() => {
    setError(null);
    if (!cwd || cwd === "~" || !sessionId) {
      setFiles([]);
      setDiffs(new Map());
      return;
    }

    let disposed = false;
    let generation = 0;
    let items: SessionDiffItem[] = [];
    // A new session or target starts from the loading surface; a refresh keeps
    // the previous diffs on screen until the new ones arrive.
    setFiles(null);
    setDiffs(new Map());
    // Bodies load for the files that are visible, focused or among the first
    // few, and reach the view in per-frame batches instead of one render per file.
    const loader = createLazyDiffLoader<SessionDiffItem, LoadedDiff>({
      concurrency: LAZY_DIFF_CONCURRENCY,
      eagerCount: LAZY_DIFF_EAGER,
      needed,
      load: async (item, previous) => {
        const diff = await sessionCheckpointFileDiff(sessionId, cwd, item.file.relative);
        const candidate: LoadedDiff = {
          binary: diff.binary,
          tooLarge: diff.tooLarge,
          original: diff.original,
          current: diff.current,
          unified: null,
        };
        // Same texts as on screen: keep that object, skip the parse.
        const reused = reuseLoadedDiff(previous, candidate);
        if (reused !== candidate) return reused;
        return {
          ...candidate,
          unified:
            !diff.binary && !diff.tooLarge
              ? await runDiffWorker(
                  (remote) => remote.build(diff.original, diff.current),
                  () => buildUnifiedFileAsync(diff.original, diff.current),
                  { size: diff.original.length + diff.current.length },
                )
              : null,
        };
      },
      failure: (caught) => ({
        binary: false,
        tooLarge: false,
        original: "",
        current: "",
        unified: null,
        error: errorText(caught),
      }),
      onChange: setDiffs,
    });
    pumpRef.current = loader.pump;
    refocusRef.current = () => loader.setFocus(focusItemId(items, focusPathRef.current));
    const run = () => {
      const current = ++generation;
      // The error stays until a read succeeds, so the stale notice does not flicker
      // while a retry is in flight.
      void sessionCheckpointStatus(sessionId, cwd)
        .then((status) => {
          if (disposed || current !== generation) return;
          setFiles(status.files);
          setError(null);
          items = status.files.map(sessionDiffItem);
          loader.setFocus(focusItemId(items, focusPathRef.current));
          // The change does not say which snapshots moved, so every loaded body
          // is fetched again once it is needed.
          loader.setItems(items, { refresh: true });
        })
        .catch((caught: unknown) => {
          if (disposed || current !== generation) return;
          // Keeps `files` and the loaded diffs: a failed refresh must not drop a review that
          // was valid a moment ago.
          setError(presentRemoteError(caught, { explicit: true }));
        });
    };

    refreshRef.current = run;
    run();
    let refreshTimer = 0;
    const unsubscribe = subscribeReviewChanged((changedSessionId) => {
      if (changedSessionId && changedSessionId !== sessionId) return;
      if (refreshTimer) return;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = 0;
        run();
      }, REFRESH_DEBOUNCE_MS);
    });
    return () => {
      disposed = true;
      pumpRef.current = null;
      refocusRef.current = null;
      refreshRef.current = null;
      loader.dispose();
      window.clearTimeout(refreshTimer);
      unsubscribe();
    };
  }, [cwd, sessionId, retry, needed, pumpRef]);
  // Retry before anything loaded restarts the load; after a failed refresh it re-reads in
  // place, so the review on screen keeps its scroll, focus and expanded files.
  const reload = () => {
    if (files !== null && refreshRef.current) refreshRef.current();
    else setRetry((value) => value + 1);
  };
  // A failed load or refresh reruns once the machine's link is back.
  useReloadOnReconnect(cwd, reload, { active: error !== null });

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Reprioritize outstanding diff reads when the focused file changes.
  useEffect(() => {
    refocusRef.current?.();
  }, [focusPath]);

  const modelCache = useRef(new Map<string, CachedModel>());
  const models = useMemo<UnifiedDiffFileModel[]>(() => {
    if (!files) return [];
    const next = new Map<string, CachedModel>();
    const built = files.map((file) => {
      const loaded = diffs.get(file.relative);
      const cached = modelCache.current.get(file.relative);
      if (
        cached &&
        cached.locale === locale &&
        cached.loaded === loaded &&
        cached.file.path === file.path &&
        cached.file.additions === file.additions &&
        cached.file.deletions === file.deletions
      ) {
        next.set(file.relative, cached);
        return cached.model;
      }
      const unified = loaded?.unified ?? null;
      const model: UnifiedDiffFileModel = {
        id: file.relative,
        path: file.path,
        label: file.relative,
        binary: loaded?.binary,
        tooLarge: loaded?.tooLarge,
        emptyMessage:
          loaded == null
            ? t("Loading…")
            : loaded.error
              ? loaded.error
              : unified != null &&
                  unified.additions === 0 &&
                  unified.deletions === 0 &&
                  !loaded.binary
                ? t("No textual diff")
                : undefined,
        additions: unified?.additions ?? file.additions,
        deletions: unified?.deletions ?? file.deletions,
        blocks: unified?.blocks ?? [],
      };
      next.set(file.relative, { file, loaded, model, locale });
      return model;
    });
    modelCache.current = next;
    return built;
  }, [diffs, files, locale]);

  const totals = useMemo(
    () =>
      models.reduce(
        (sum, file) => ({
          additions: sum.additions + file.additions,
          deletions: sum.deletions + file.deletions,
        }),
        { additions: 0, deletions: 0 },
      ),
    [models],
  );

  // A folder that no longer exists is the same state as no folder: nothing to retry.
  if (!cwd || cwd === "~" || (files == null && isMissingPathError(error))) {
    return (
      <div className="grid h-full place-items-center">
        <EmptyState key="no-project" context="panel" description={t("No project folder")} />
      </div>
    );
  }
  // The full-panel failure is only for a review that never loaded.
  if (error && files == null) {
    if (shownCentrally) return null;
    return (
      <div className="grid h-full place-items-center p-6">
        <FailureState
          key="load-error"
          context="panel"
          title={t("Couldn’t load session changes")}
          description={error}
          onRetry={reload}
        />
      </div>
    );
  }
  if (files == null) {
    return <SurfaceLoading />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {error ? <StaleReviewNotice error={error} onRetry={reload} /> : null}
      {files.length === 0 ? (
        <div className="grid min-h-0 flex-1 place-items-center">
          <EmptyState context="panel" description={t("No session changes")} />
        </div>
      ) : (
        <UnifiedDiffView
          files={models}
          focusPath={focusPath}
          totals={totals}
          onSectionNeeded={onSectionNeeded}
        />
      )}
    </div>
  );
}

/** The snapshot's row is its signature: any change to it, or a refresh, loads the body again. */
function sessionDiffItem(file: CheckpointFile): SessionDiffItem {
  return {
    id: file.relative,
    signature: [
      file.path,
      file.status,
      file.additions,
      file.deletions,
      file.exact,
      file.undoable,
    ].join("\0"),
    file,
  };
}

function focusItemId(
  items: readonly SessionDiffItem[],
  focusPath: string | undefined,
): string | undefined {
  if (!focusPath) return undefined;
  return items.find((item) => item.file.path === focusPath || item.file.relative === focusPath)?.id;
}
