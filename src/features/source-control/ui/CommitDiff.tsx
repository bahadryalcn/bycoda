import { errorText } from "../../../shared/lib/errors";
import { isMissingPathError } from "../model/checkoutSelection";
import { presentRemoteError } from "../../connections/public/remoteFailure";
import { useReloadOnReconnect } from "../../connections/public/useReloadOnReconnect";
import { FailureState } from "../../../shared/ui/FailureState";
import { useConnectionErrorShownCentrally } from "../../../shared/ui/connectionErrorGate";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { t, useLocale } from "../../../shared/i18n/git";
import { useEffect, useMemo, useState } from "react";
import { SurfaceLoading } from "../../../shared/ui/SurfaceLoading";
import { gitCommitFileDiff, gitCommitFiles, type GitChangedFile } from "../../../platform/tauri/fs";
import { useNeededSections } from "../hooks/useNeededSections";
import { runDiffWorker } from "../model/diffWorker";
import {
  createLazyDiffLoader,
  LAZY_DIFF_CONCURRENCY,
  LAZY_DIFF_EAGER,
  type LazyDiffItem,
} from "../model/lazyDiffLoader";
import { buildUnifiedFileAsync, type UnifiedFileDiff } from "../model/unifiedDiff";
import { UnifiedDiffView, type UnifiedDiffFileModel } from "./UnifiedDiffView";

type Props = {
  cwd: string;
  sha: string;
};

type LoadedDiff = {
  binary: boolean;
  tooLarge: boolean;
  unified: UnifiedFileDiff | null;
  error?: string;
};

type CommitDiffItem = LazyDiffItem & { file: GitChangedFile };

/** A commit is immutable, so a file's row is its whole signature. */
function commitDiffItem(file: GitChangedFile): CommitDiffItem {
  return {
    id: file.relative,
    signature: `${file.path}\0${file.status}\0${file.additions}\0${file.deletions}`,
    file,
  };
}

export function CommitDiff({ cwd, sha }: Props) {
  useLocale();
  const { needed, pumpRef, onSectionNeeded } = useNeededSections();
  const [files, setFiles] = useState<GitChangedFile[] | null>(null);
  const [diffs, setDiffs] = useState<Map<string, LoadedDiff>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const shownCentrally = useConnectionErrorShownCentrally(error);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    setError(null);
    if (!cwd || cwd === "~" || !sha) {
      setFiles([]);
      setDiffs(new Map());
      return;
    }

    let disposed = false;
    setFiles(null);
    setDiffs(new Map());

    // Bodies load for the files that are visible or among the first few, and
    // reach the view in per-frame batches instead of one render per file.
    const loader = createLazyDiffLoader<CommitDiffItem, LoadedDiff>({
      concurrency: LAZY_DIFF_CONCURRENCY,
      eagerCount: LAZY_DIFF_EAGER,
      needed,
      load: async (item) => {
        const diff = await gitCommitFileDiff(cwd, sha, item.file.relative);
        const unified =
          !diff.binary && !diff.tooLarge
            ? await runDiffWorker(
                (remote) => remote.build(diff.original, diff.current),
                () => buildUnifiedFileAsync(diff.original, diff.current),
                { size: diff.original.length + diff.current.length },
              )
            : null;
        return { binary: diff.binary, tooLarge: diff.tooLarge, unified };
      },
      failure: (caught) => ({
        binary: false,
        tooLarge: false,
        unified: null,
        error: errorText(caught),
      }),
      onChange: setDiffs,
    });
    pumpRef.current = loader.pump;

    void gitCommitFiles(cwd, sha)
      .then((listed) => {
        if (disposed) return;
        setFiles(listed);
        setError(null);
        loader.setItems(listed.map(commitDiffItem));
      })
      .catch((caught: unknown) => {
        if (disposed) return;
        setError(presentRemoteError(caught, { explicit: true }));
        setFiles([]);
      });

    return () => {
      disposed = true;
      pumpRef.current = null;
      loader.dispose();
    };
  }, [cwd, sha, retry, needed, pumpRef]);
  // A failed first load reruns once the machine's link is back.
  useReloadOnReconnect(cwd, () => setRetry((value) => value + 1), { active: error !== null });

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
              ? t("Couldn’t load diff: {p0}", { p0: loaded.error })
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

  const totals = useMemo(() => {
    return models.reduce(
      (sum, file) => ({
        additions: sum.additions + file.additions,
        deletions: sum.deletions + file.deletions,
      }),
      { additions: 0, deletions: 0 },
    );
  }, [models]);

  // A folder that no longer exists is the same state as no folder: nothing to retry.
  if (!cwd || cwd === "~" || (files == null && isMissingPathError(error))) {
    return (
      <div className="grid h-full place-items-center">
        <EmptyState key="no-project" context="panel" description={t("No project folder")} />
      </div>
    );
  }
  if (error) {
    if (shownCentrally) return null;
    return (
      <div className="grid h-full place-items-center p-6">
        <FailureState
          key="load-error"

          context="panel"
          title={t("Couldn’t load commit")}
          error={error}
          onRetry={() => setRetry((value) => value + 1)}
        />
      </div>
    );
  }
  if (files == null) {
    return <SurfaceLoading />;
  }

  return <UnifiedDiffView files={models} totals={totals} onSectionNeeded={onSectionNeeded} />;
}
