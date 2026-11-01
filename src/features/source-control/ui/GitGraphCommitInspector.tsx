import { SearchInput } from "../../../shared/ui/SearchInput";
import { ChevronDown, ChevronRight, ChevronLeft, X } from "../../../shared/ui/icons";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Button } from "../../../shared/ui/Button";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { OverflowTooltip } from "../../../shared/ui/Tooltip";
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
  onClose,
  disabled = false,
  mode = "changes",
  onMode,
}: {
  cwd: string;
  commit: GitHistoryCommit;
  onBranch: () => void;
  onClose?: () => void;
  disabled?: boolean;
  mode?: "changes" | "blame";
  onMode?: (mode: "changes" | "blame") => void;
}) {
  useLocale();
  const readFiles = useCallback(() => gitCommitFiles(cwd, commit.sha), [cwd, commit.sha]);
  const files = useGitResource(cwd, `graph-files:${cwd}:${commit.sha}`, true, readFiles, false);
  const [fileQuery, setFileQuery] = useState("");
  const [filesOpen, setFilesOpen] = useState(true);
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
  const visibleFiles = (files.data ?? []).filter((file) =>
    file.relative.toLocaleLowerCase().includes(fileQuery.trim().toLocaleLowerCase()),
  );
  const selectedIndex = visibleFiles.findIndex((file) => file.relative === relative);
  const totals = (files.data ?? []).reduce(
    (sum, file) => ({
      additions: sum.additions + file.additions,
      deletions: sum.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 },
  );
  const deleted = files.data?.find((file) => file.relative === relative)?.status === "deleted";
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-(--ui-pane-border) p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <code className="select-all text-ui-caption text-(--ui-tone-accent-fg)">{commit.shortSha}</code>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              motion="none"
              type="button"
              onClick={onBranch}
              disabled={disabled}
            >
              {t("Create Branch…")}
            </Button>
            {onClose ? (
              <Button
                variant="ghost"
                size="sm"
                motion="none"
                iconOnly
                label={t("Close commit details")}
                onClick={onClose}
              >
                <X className="icon-sm" />
              </Button>
            ) : null}
          </div>
        </div>
        <h3 className="break-words text-ui-body font-medium text-content">{commit.subject}</h3>
        <p className="mt-1 text-ui-caption text-(--ui-text-secondary)">
          {commit.author} · {new Date(commit.timestamp * 1000).toLocaleString()}
        </p>
        <p className="flex gap-2 text-ui-caption tabular-nums text-(--ui-text-secondary)">
          <span>
            {files.data?.length ?? "…"} {t("files")}
          </span>
          <span className="text-diff-add-fg">+{totals.additions}</span>
          <span className="text-diff-del-fg">−{totals.deletions}</span>
        </p>
      </header>
      <div className="flex shrink-0 items-center gap-2 border-b border-(--ui-pane-border) px-2 py-1">
        <Button
          variant="ghost"
          size="sm"
          motion="none"
          aria-expanded={filesOpen}
          onClick={() => setFilesOpen(!filesOpen)}
        >
          {filesOpen ? <ChevronDown className="icon-sm" /> : <ChevronRight className="icon-sm" />}
          {t("Changed files")}
        </Button>
        {filesOpen ? (
          <SearchInput
            type="search"
            appearance="field"
            containerClassName="min-w-0 flex-1"
            aria-label={t("Filter commit files")}
            placeholder={t("File or folder name")}
            value={fileQuery}
            onChange={(event) => setFileQuery(event.target.value)}
          />
        ) : null}
      </div>
      {files.error ? (
        <GitFeedback
          title={t("Couldn’t load commit")}
          detail={files.error}
          onRetry={files.refresh}
        />
      ) : null}
      <section
        hidden={!filesOpen}
        aria-label={t("Changed files")}
        className="max-h-[30%] min-h-0 shrink-0 overflow-y-auto border-b border-(--ui-pane-border)"
      >
        {files.loading && !files.data ? <GitLoading text="Loading…" /> : null}
        {visibleFiles.map((file) => (
          <Button
            variant="item"
            motion="none"
            key={file.relative}
            size="sm"
            tooltip={file.relative}
            tooltipWhen="overflow"
            type="button"
            aria-pressed={relative === file.relative}
            onClick={() => setPicked(file.relative)}
            className="flex w-full items-center justify-start gap-2"
          >
            <FileTypeIcon name={file.relative} isDir={false} size="sm" />
            <span className="min-w-0 flex-1 truncate">{file.relative}</span>
            <span className="text-diff-add-fg">+{file.additions}</span>
            <span className="text-diff-del-fg">−{file.deletions}</span>
          </Button>
        ))}
        {files.data && visibleFiles.length === 0 ? (
          <EmptyState
            size="inline"
            kind={fileQuery ? "filtered" : "empty"}
            className="px-3"
            description={t(fileQuery ? "No matching files" : "No changed files")}
          />
        ) : null}
      </section>
      <div className="flex min-h-9 shrink-0 items-center justify-between border-b border-(--ui-pane-border) px-3 text-ui-caption text-(--ui-text-secondary)">
        <span>
          {mode === "blame"
            ? deleted
              ? t("Blame at parent (deleted file)")
              : t("Blame at commit")
            : t("Parent → commit")}
        </span>
        {onMode ? (
          <SegmentedControl
            label={t("Commit view")}
            value={mode}
            options={[
              { value: "changes", label: t("Changes") },
              { value: "blame", label: t("Blame") },
            ]}
            onValueChange={(value) => onMode(value as "changes" | "blame")}
          />
        ) : null}
      </div>
      {relative ? (
        <div className="flex min-w-0 shrink-0 items-center gap-1 border-b border-(--ui-pane-border) px-2 py-1 text-ui-caption">
          <OverflowTooltip label={relative}>
            <span className="min-w-0 flex-1 truncate">{relative}</span>
          </OverflowTooltip>
          <span className="tabular-nums text-(--ui-text-secondary)">
            {selectedIndex < 0 ? "–" : selectedIndex + 1}/{visibleFiles.length}
          </span>
          <Button
            variant="ghost"
            size="sm"
            motion="none"
            iconOnly
            label={t("Previous file")}
            disabled={selectedIndex <= 0}
            onClick={() => setPicked(visibleFiles[selectedIndex - 1].relative)}
          >
            <ChevronLeft className="icon-sm" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            motion="none"
            iconOnly
            label={t("Next file")}
            disabled={selectedIndex < 0 || selectedIndex >= visibleFiles.length - 1}
            onClick={() => setPicked(visibleFiles[selectedIndex + 1].relative)}
          >
            <ChevronRight className="icon-sm" />
          </Button>
        </div>
      ) : null}
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
