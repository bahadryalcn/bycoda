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

import { forEachConcurrent } from "../../../shared/lib/concurrent";
import { runDiffWorker } from "../model/diffWorker";
import { buildUnifiedFileAsync, type UnifiedFileDiff } from "../model/unifiedDiff";
import { UnifiedDiffView, type UnifiedDiffFileModel } from "./UnifiedDiffView";

type Props = {
  cwd: string;
  sessionId: string;
  focusPath?: string;
};

type LoadedDiff = {
  binary: boolean;
  tooLarge: boolean;
  unified: UnifiedFileDiff | null;
  error?: string;
};

const DIFF_LOAD_CONCURRENCY = 4;
const REFRESH_DEBOUNCE_MS = 500;

/** Read-only review of the exact before/after snapshots owned by one session. */
export function SessionChangesDiff({ cwd, sessionId, focusPath }: Props) {
  useLocale();
  const [files, setFiles] = useState<CheckpointFile[] | null>(null);
  const [diffs, setDiffs] = useState<Map<string, LoadedDiff>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const focusPathRef = useRef(focusPath);
  focusPathRef.current = focusPath;

  useEffect(() => {
    setError(null);
    if (!cwd || cwd === "~" || !sessionId) {
      setFiles([]);
      setDiffs(new Map());
      return;
    }

    let disposed = false;
    let generation = 0;
    // A new session or target starts from the loading surface; a refresh keeps
    // the previous diffs on screen until the new ones arrive.
    setFiles(null);
    setDiffs(new Map());
    const run = () => {
      const current = ++generation;
      setError(null);
      void sessionCheckpointStatus(sessionId, cwd)
        .then(async (status) => {
          if (disposed || current !== generation) return;
          setFiles(status.files);
          setError(null);
          const known = new Set(status.files.map((file) => file.relative));
          setDiffs((existing) =>
            [...existing.keys()].every((id) => known.has(id))
              ? existing
              : new Map([...existing].filter(([id]) => known.has(id))),
          );
          const pendingFiles = [...status.files];
          await forEachConcurrent(
            status.files,
            DIFF_LOAD_CONCURRENCY,
            async () => {
              // Reorder only work that has not started when focus changes.
              const file = prioritizeFile(pendingFiles, focusPathRef.current)[0];
              pendingFiles.splice(pendingFiles.indexOf(file), 1);
              let loaded: LoadedDiff;
              try {
                const diff = await sessionCheckpointFileDiff(sessionId, cwd, file.relative);
                loaded = {
                  binary: diff.binary,
                  tooLarge: diff.tooLarge,
                  unified:
                    !diff.binary && !diff.tooLarge
                      ? await runDiffWorker(
                          (remote) => remote.build(diff.original, diff.current),
                          () => buildUnifiedFileAsync(diff.original, diff.current),
                          { size: diff.original.length + diff.current.length },
                        )
                      : null,
                };
              } catch (caught: unknown) {
                loaded = {
                  binary: false,
                  tooLarge: false,
                  unified: null,
                  error: caught instanceof Error ? caught.message : String(caught),
                };
              }
              if (disposed || current !== generation) return;
              setDiffs((existing) => {
                const next = new Map(existing);
                next.set(file.relative, loaded);
                return next;
              });
            },
            () => !disposed && current === generation,
          );
        })
        .catch((caught: unknown) => {
          if (disposed || current !== generation) return;
          setError(caught instanceof Error ? caught.message : String(caught));
          setFiles([]);
        });
    };

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
      window.clearTimeout(refreshTimer);
      unsubscribe();
    };
  }, [cwd, sessionId, retry]);

  const models = useMemo<UnifiedDiffFileModel[]>(() => {
    if (!files) return [];
    return files.map((file) => {
      const loaded = diffs.get(file.relative);
      const unified = loaded?.unified ?? null;
      return {
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
    });
  }, [diffs, files]);

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

  if (!cwd || cwd === "~") {
    return (
      <div className="grid h-full place-items-center">
        <EmptyState key="no-project" context="panel" description={t("No project folder")} />
      </div>
    );
  }
  if (error) {
    return (
      <div className="grid h-full place-items-center p-6">
        <EmptyState
          key="load-error"
          kind="unavailable"
          context="panel"
          title={t("Couldn’t load session changes")}
          description={error}
          onRetry={() => setRetry((value) => value + 1)}
        />
      </div>
    );
  }
  if (files == null) {
    return <SurfaceLoading />;
  }
  if (files.length === 0) {
    return (
      <div className="grid h-full place-items-center">
        <EmptyState context="panel" description={t("No session changes")} />
      </div>
    );
  }

  return <UnifiedDiffView files={models} focusPath={focusPath} totals={totals} />;
}

function prioritizeFile(
  files: readonly CheckpointFile[],
  focusPath: string | undefined,
): CheckpointFile[] {
  if (!focusPath) return [...files];
  const focused = files.find((file) => file.path === focusPath || file.relative === focusPath);
  if (!focused) return [...files];
  return [focused, ...files.filter((file) => file !== focused)];
}
