import { Button } from "../../../shared/ui/Button";
import { useCallback, useMemo, useState } from "react";
import {
  gitCommitFiles,
  gitCommitFileDiff,
  type GitHistoryCommit,
} from "../../../platform/tauri/fs";
import { t, useLocale } from "../../../shared/i18n/git";
import { useGitResource } from "../hooks/useGitResource";
import { buildUnifiedFile } from "../model/unifiedDiff";
import { UnifiedDiffView } from "./UnifiedDiffView";
import { GitFeedback, GitLoading } from "./GitFeedback";
import { FileTypeIcon } from "../../files/ui/FileTypeIcon";
import { GitCommitBlameView } from "./GitCommitBlameView";

export function GitGraphCommitInspector({
  cwd,
  commit,
  onBranch,
  disabled = false,
  mode = "changes",
  onMode,
}: {
  cwd: string;
  commit: GitHistoryCommit;
  onBranch: () => void;
  disabled?: boolean;
  mode?: "changes" | "blame";
  onMode?: (mode: "changes" | "blame") => void;
}) {
  useLocale();
  const readFiles = useCallback(() => gitCommitFiles(cwd, commit.sha), [cwd, commit.sha]);
  const files = useGitResource(cwd, `graph-files:${cwd}:${commit.sha}`, true, readFiles, false);
  const [picked, setPicked] = useState<string | null>(null);
  const relative =
    picked && files.data?.some((f) => f.relative === picked) ? picked : files.data?.[0]?.relative;
  const readDiff = useCallback(
    () => gitCommitFileDiff(cwd, commit.sha, relative!),
    [cwd, commit.sha, relative],
  );
  const diff = useGitResource(
    cwd,
    `graph-diff:${cwd}:${commit.sha}:${relative}`,
    !!relative,
    readDiff,
    false,
  );
  const models = useMemo(() => {
    const value = diff.data;
    if (!value) return [];
    const unified =
      value.binary || value.tooLarge ? null : buildUnifiedFile(value.original, value.current);
    return [
      {
        id: relative!,
        path: value.path,
        label: relative!,
        binary: value.binary,
        tooLarge: value.tooLarge,
        blocks: unified?.blocks ?? [],
        additions: unified?.additions ?? 0,
        deletions: unified?.deletions ?? 0,
      },
    ];
  }, [diff.data, relative]);
  const deleted = files.data?.find((file) => file.relative === relative)?.status === "deleted";
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-stroke p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <code className="select-all text-[12px] text-accent">{commit.shortSha}</code>
          <Button
            variant="ghost"
            motion="none"
            type="button"
            onClick={onBranch}
            disabled={disabled}
          >
            {t("Create Branch…")}
          </Button>
        </div>
        <h3 className="break-words text-[14px] font-medium text-content">{commit.subject}</h3>
        <p className="mt-1 text-[12px] text-[var(--ui-text-secondary)]">
          {commit.author} · {new Date(commit.timestamp * 1000).toLocaleString()}
        </p>
      </header>
      <section
        aria-label={t("Changed files")}
        className="max-h-[30%] min-h-24 shrink-0 overflow-y-auto border-b border-stroke"
      >
        <h4 className="sticky top-0 bg-[var(--ui-surface)] px-3 py-2 text-[11px] font-semibold text-[var(--ui-text-secondary)]">
          {t("Changed files")} · {files.data?.length ?? "…"}
        </h4>
        {files.error ? (
          <GitFeedback
            title={t("Couldn’t load commit")}
            detail={files.error}
            onRetry={files.refresh}
          />
        ) : null}
        {files.loading && !files.data ? <GitLoading text="Loading…" /> : null}
        {files.data?.map((file) => (
          <Button
            variant="item"
            motion="none"
            key={file.relative}
            type="button"
            aria-pressed={relative === file.relative}
            onClick={() => setPicked(file.relative)}
            className={" flex h-8 w-full items-center gap-2 text-left "}
          >
            <FileTypeIcon name={file.relative} isDir={false} size={14} />
            <span title={file.relative} className="min-w-0 flex-1 truncate">
              {file.relative}
            </span>
            <span className="text-success">+{file.additions}</span>
            <span className="text-danger">−{file.deletions}</span>
          </Button>
        ))}
        {files.data?.length === 0 ? (
          <p className="px-3 py-2 text-[12px] text-[var(--ui-text-secondary)]">
            {t("No changed files")}
          </p>
        ) : null}
      </section>
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-stroke px-3 text-[11px] text-[var(--ui-text-secondary)]">
        <span>
          {mode === "blame"
            ? deleted
              ? t("Blame at parent (deleted file)")
              : t("Blame at commit")
            : t("Parent → commit")}
        </span>
        {onMode ? (
          <div className="flex gap-1">
            {(["changes", "blame"] as const).map((value) => (
              <Button
                variant="ghost"
                motion="none"
                key={value}
                type="button"
                aria-pressed={mode === value}
                onClick={() => onMode(value)}
              >
                {value === "changes" ? t("Changes") : t("Blame")}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
      {diff.error ? (
        <GitFeedback title={t("Couldn’t load diff")} detail={diff.error} onRetry={diff.refresh} />
      ) : null}
      {diff.loading && !diff.data ? <GitLoading text="Loading…" /> : null}
      <div className="flex min-h-0 flex-1 flex-col">
        {mode === "blame" && relative && diff.data && !diff.data.binary && !diff.data.tooLarge ? (
          <GitCommitBlameView
            key={`${cwd}:${commit.sha}:${relative}:${deleted}`}
            cwd={cwd}
            sha={deleted ? commit.parents[0] : commit.sha}
            relative={relative}
            text={deleted ? diff.data.original : diff.data.current}
          />
        ) : (
          <UnifiedDiffView files={models} />
        )}
      </div>
    </div>
  );
}
