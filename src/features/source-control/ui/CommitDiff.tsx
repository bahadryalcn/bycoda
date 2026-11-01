import { EmptyState } from "../../../shared/ui/EmptyState";
import { t, useLocale } from "../../../shared/i18n/git";
import { useEffect, useMemo, useState } from "react";
import { SurfaceLoading } from "../../../shared/ui/SurfaceLoading";
import { gitCommitFileDiff, gitCommitFiles, type GitChangedFile } from "../../../platform/tauri/fs";
import { forEachConcurrent } from "../../../shared/lib/concurrent";
import { buildUnifiedFile, type UnifiedFileDiff } from "../model/unifiedDiff";
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

const DIFF_LOAD_CONCURRENCY = 4;

export function CommitDiff({ cwd, sha }: Props) {
  useLocale();
  const [files, setFiles] = useState<GitChangedFile[] | null>(null);
  const [diffs, setDiffs] = useState<Map<string, LoadedDiff>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    setError(null);
    if (!cwd || cwd === "~" || !sha) {
      setFiles([]);
      setDiffs(new Map());
      return;
    }

    let disposed = false;
    let generation = 0;
    setFiles(null);
    setDiffs(new Map());

    const run = () => {
      const current = ++generation;
      void gitCommitFiles(cwd, sha)
        .then(async (listed) => {
          if (disposed || current !== generation) return;
          setFiles(listed);
          setDiffs(new Map());
          setError(null);
          await forEachConcurrent(
            listed,
            DIFF_LOAD_CONCURRENCY,
            async (file) => {
              let loaded: LoadedDiff;
              try {
                const diff = await gitCommitFileDiff(cwd, sha, file.relative);
                const unified =
                  !diff.binary && !diff.tooLarge
                    ? buildUnifiedFile(diff.original, diff.current)
                    : null;
                loaded = {
                  binary: diff.binary,
                  tooLarge: diff.tooLarge,
                  unified,
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
    return () => {
      disposed = true;
    };
  }, [cwd, sha, retry]);

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
            ? "Loading…"
            : loaded.error
              ? `Couldn’t load diff: ${loaded.error}`
              : unified != null &&
                  unified.additions === 0 &&
                  unified.deletions === 0 &&
                  !loaded.binary
                ? "No textual diff"
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
          title={t("Couldn’t load commit")}
          description={error}
          onRetry={() => setRetry((value) => value + 1)}
        />
      </div>
    );
  }
  if (files == null) {
    return (
      <SurfaceLoading />
    );
  }

  return <UnifiedDiffView files={models} totals={totals} />;
}
