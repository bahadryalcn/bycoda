import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n";
import { ChevronDown, ChevronRight, FileDiff } from "../../../shared/ui/icons";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  keepSessionChanges,
  sessionCheckpointStatus,
  subscribeReviewChanged,
  undoSessionChanges,
  type CheckpointFile,
} from "../model/checkpoint";
import { invalidateProjectFiles } from "../../files/model/fileIndex";
import { invalidateWatchedFiles } from "../../files/model/fileWatch";
import { basename, notifyGitChanged, subscribeGitChanged } from "../../../platform/tauri/fs";
import { formatInteger } from "../../../shared/lib/numbers";
import { FileTypeIcon } from "../../files/ui/FileTypeIcon";
import { useChangedFileMenu } from "../../files/ui/useChangedFileMenu";

type Props = {
  sessionId: string;
  cwd: string;
  enabled?: boolean;
  busy?: boolean;
  undoLocked?: boolean;
  onOpenFile?: (path: string) => void;
  onOpenDiff: (path?: string, session?: { sessionId: string; cwd: string }) => void;
};

export function SessionReview(props: Props) {
  return <SessionReviewContent key={JSON.stringify([props.sessionId, props.cwd])} {...props} />;
}

function SessionReviewContent({
  sessionId,
  cwd,
  enabled = true,
  busy = false,
  undoLocked = false,
  onOpenFile,
  onOpenDiff,
}: Props) {
  useLocale();
  const [files, setFiles] = useState<CheckpointFile[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [acting, setActing] = useState<"keep" | "undo" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const request = useRef(0);
  const actingRef = useRef(false);
  const filesRef = useRef(files);
  filesRef.current = files;

  const load = useCallback(() => {
    if (actingRef.current) return;
    const generation = ++request.current;
    if (!cwd || cwd === "~") {
      setFiles([]);
      return;
    }
    return sessionCheckpointStatus(sessionId, cwd)
      .then((status) => {
        if (generation !== request.current) return;
        setFiles(status.files);
        setError(null);
        setRecording(false);
      })
      .catch((cause: unknown) => {
        if (generation === request.current) {
          setFiles([]);
          const message = cause instanceof Error ? cause.message : String(cause);
          const pending = message.includes("Workspace checkpoint is still recording this turn");
          setRecording(pending);
          setError(pending ? null : message);
        }
      });
  }, [sessionId, cwd]);

  useEffect(() => {
    if (!enabled || busy) return;
    load();
    let timer: number | null = null;
    const schedule = () => {
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        load();
      }, 200);
    };
    const unsubReview = subscribeReviewChanged((id) => {
      if (!id || id === sessionId) schedule();
    });
    const unsubGit = subscribeGitChanged(() => {
      if (filesRef.current.length > 0) schedule();
    });
    const onResume = () => {
      if (filesRef.current.length > 0) schedule();
    };
    window.addEventListener("focus", onResume);
    document.addEventListener("visibilitychange", onResume);
    return () => {
      request.current += 1;
      if (timer != null) window.clearTimeout(timer);
      window.removeEventListener("focus", onResume);
      document.removeEventListener("visibilitychange", onResume);
      unsubReview();
      unsubGit();
    };
  }, [enabled, load, sessionId, busy]);

  useEffect(() => {
    if (!recording || !enabled || busy) return;
    let cancelled = false;
    let timer: number;
    const poll = async () => {
      await load();
      if (!cancelled) timer = window.setTimeout(() => void poll(), 1000);
    };
    timer = window.setTimeout(() => void poll(), 1000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [recording, enabled, busy, load]);

  useEffect(() => {
    if (files.length <= 3) setExpanded(false);
  }, [files.length]);

  useEffect(() => {
    if (busy) setFiles([]);
  }, [busy]);

  // The card represents the result of a turn. Keep it out of the live turn,
  // then refresh and reveal it once the turn has settled.
  if (!enabled || busy || (files.length === 0 && !error && !recording)) return null;
  if (recording) {
    return (
      <p role="status" className="px-3 py-2 text-xs text-(--ui-text-secondary)">
        {t("Loading changes…")}
      </p>
    );
  }

  const errorNotice = error ? (
    <Alert tone="danger" role="alert">
      {error}{" "}
      <Button variant="ghost" type="button" onClick={load}>
        {t("Retry")}
      </Button>
    </Alert>
  ) : null;
  if (files.length === 0) return errorNotice;

  const disabled = acting != null;
  const canUndoAll = !undoLocked && files.every((file) => file.undoable);
  const visibleFiles = expanded ? files : files.slice(0, 3);
  const hiddenFileCount = files.length - visibleFiles.length;
  const totals = files.reduce(
    (sum, file) => ({
      additions: sum.additions + file.additions,
      deletions: sum.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 },
  );

  const run = (action: "keep" | "undo") => {
    if (actingRef.current) return;
    actingRef.current = true;
    const generation = ++request.current;
    setActing(action);
    setError(null);
    const op =
      action === "keep" ? keepSessionChanges(sessionId, cwd) : undoSessionChanges(sessionId, cwd);
    const previous = filesRef.current.map((file) => file.path);
    void op
      .then((status) => {
        notifyGitChanged();
        invalidateWatchedFiles(previous);
        invalidateProjectFiles(cwd);
        if (generation === request.current) setFiles(status.files);
      })
      .catch((cause: unknown) => {
        if (generation === request.current)
          setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        actingRef.current = false;
        setActing(null);
      });
  };

  return (
    <div className="px-4 pt-1 pb-2 font-sans" data-session-review-shell>
      <div
        className="overflow-hidden rounded-xl border border-(--ui-tone-neutral-border) bg-(--ui-surface-raised)"
        data-session-review
      >
        {errorNotice}
        <div className="flex min-w-0 items-center gap-2.5 px-3 py-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-(--ui-surface-raised) text-(--ui-text-secondary)">
            <FileDiff className="size-4" strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-medium text-(--ui-text-secondary)">
              {t("Changed ")}
              {files.length} {files.length === 1 ? t("file") : t("files")}
            </div>
            <div className="flex items-center gap-1.5 font-sans text-[11px] font-semibold tabular-nums -mt-0.5">
              <span className="text-diff-add-fg">+{formatInteger(totals.additions)}</span>
              <span className="text-diff-del-fg">-{formatInteger(totals.deletions)}</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              variant="ghost"
              type="button"
              title={
                canUndoAll
                  ? t("Undo all session changes")
                  : undoLocked
                    ? t("Undo is unavailable while another session is running in this project")
                    : t("Undo is unavailable because a file changed outside this session")
              }
              disabled={disabled || !canUndoAll}
              onClick={() => run("undo")}
            >
              {t("Undo")}
            </Button>
            <Button
              variant="ghost"
              type="button"
              title={t("Keep all session changes and dismiss this card")}
              disabled={disabled}
              onClick={() => run("keep")}
            >
              {t("Keep")}
            </Button>
            <Button
              variant="ghost"
              type="button"
              title={t("Review changes")}
              onClick={() => onOpenDiff(undefined, { sessionId, cwd })}
            >
              {t("Review")}
            </Button>
          </div>
        </div>
        <ul
          className={`scrollbar-none border-t border-(--ui-tone-neutral-border) py-1 ${
            expanded ? "max-h-64 overflow-y-auto" : ""
          }`}
        >
          {visibleFiles.map((file) => (
            <li key={file.relative}>
              <FileRow
                file={file}
                sessionId={sessionId}
                cwd={cwd}
                onOpenDiff={onOpenDiff}
                onOpenFile={onOpenFile}
              />
            </li>
          ))}
        </ul>
        {files.length > 3 ? (
          <Button
            fullWidth
            variant="item"
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((open) => !open)}
            className="w-full text-left"
          >
            {expanded ? (
              <ChevronDown className="size-3.5" strokeWidth={1.75} />
            ) : (
              <ChevronRight className="size-3.5" strokeWidth={1.75} />
            )}
            <span>
              {expanded
                ? t("Show fewer files")
                : t(hiddenFileCount === 1 ? "Show {p0} more file" : "Show {p0} more files", {
                    p0: hiddenFileCount,
                  })}
            </span>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function FileRow({
  file,
  sessionId,
  cwd,
  onOpenDiff,
  onOpenFile,
}: {
  file: CheckpointFile;
  sessionId: string;
  cwd: string;
  onOpenFile?: (path: string) => void;
  onOpenDiff: (path?: string, session?: { sessionId: string; cwd: string }) => void;
}) {
  useLocale();
  const name = basename(file.relative);
  const { menu, ...menuHandlers } = useChangedFileMenu({
    path: file.path,
    relative: file.relative,
    deleted: file.status === "deleted",
    onOpenChanges: () => onOpenDiff(file.path, { sessionId, cwd }),
    onOpenFile: onOpenFile ? () => onOpenFile(file.path) : undefined,
  });
  return (
    <>
      <Button
        fullWidth
        variant="item"
        {...menuHandlers}
        type="button"
        title={file.relative}
        onClick={() => onOpenDiff(file.path, { sessionId, cwd })}
        className="w-full min-w-0 text-left"
      >
        <FileTypeIcon name={name} isDir={false} size={15} />
        <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{file.relative}</span>
        <DiffCounts file={file} />
      </Button>
      {menu}
    </>
  );
}

function DiffCounts({ file }: { file: CheckpointFile }) {
  useLocale();
  if (!file.exact) {
    return (
      <span className="shrink-0 text-[11px] font-medium text-(--ui-tone-warning-fg)">
        {t("Mixed changes")}
      </span>
    );
  }
  return (
    <span className="flex shrink-0 gap-2 font-sans text-[11px] font-semibold tabular-nums">
      <span className="text-diff-add-fg">+{formatInteger(file.additions)}</span>
      <span className="text-diff-del-fg">-{formatInteger(file.deletions)}</span>
    </span>
  );
}
