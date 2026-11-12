import { LoadingText } from "../../../shared/ui/LoadingText";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { DiffStat } from "../../../shared/ui/DiffStat";
import { ScrollArea } from "../../../shared/ui/ScrollArea";
import { Text } from "../../../shared/ui/Text";
import { Surface } from "../../../shared/ui/Surface";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { ConfirmMorph } from "../../../shared/ui/ConfirmMorph";
import { useLocale, useT } from "../../../shared/i18n";
import { ChevronDown, ChevronRight } from "../../../shared/ui/icons";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  keepSessionChanges,
  sessionCheckpointStatus,
  subscribeReviewChanged,
  undoSessionChanges,
  type CheckpointFile,
} from "../model/checkpoint";
import { invalidateProjectFiles } from "../../files/public/fileIndex";
import { invalidateWatchedFiles } from "../../files/public/fileWatch";
import { basename, notifyGitChanged, subscribeGitChanged } from "../../../platform/tauri/fs";
import { FileTypeIcon } from "../../files/public/FileTypeIcon";
import { useChangedFileMenu } from "../../files/public/useChangedFileMenu";

type Props = {
  sessionId: string;
  cwd: string;
  enabled?: boolean;
  busy?: boolean;
  undoLockReason?: "session" | "orchestration";
  onOpenFile?: (path: string) => void;
  onOpenDiff: (path?: string, session?: { sessionId: string; cwd: string }) => void;
};

type UndoLockingRun = {
  status: string;
  leadId: string;
  tasks: readonly { sessionId?: string }[];
};

/** True while an active or paused orchestration run leads or dispatched this session. */
export function orchestrationLocksUndo(runs: readonly UndoLockingRun[], sessionId: string) {
  return runs.some(
    (run) =>
      (run.status === "active" || run.status === "paused") &&
      (run.leadId === sessionId || run.tasks.some((task) => task.sessionId === sessionId)),
  );
}

export function SessionReview(props: Props) {
  return <SessionReviewContent key={JSON.stringify([props.sessionId, props.cwd])} {...props} />;
}

function SessionReviewContent({
  sessionId,
  cwd,
  enabled = true,
  busy = false,
  undoLockReason,
  onOpenFile,
  onOpenDiff,
}: Props) {
  const t = useT();
  const [files, setFiles] = useState<CheckpointFile[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [acting, setActing] = useState<"keep" | "undo" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [statusStale, setStatusStale] = useState(false);
  const request = useRef(0);
  const actingRef = useRef(false);
  const filesRef = useRef(files);
  useLayoutEffect(() => {
    filesRef.current = files;
  }, [files]);
  // A running turn owns the workspace: drop the previous result, and a short list cannot stay expanded.
  if (busy && files.length > 0) setFiles([]);
  if (expanded && files.length <= 3) setExpanded(false);

  const load = useCallback(() => {
    if (actingRef.current) return;
    const generation = ++request.current;
    if (!cwd || cwd === "~") {
      setFiles([]);
      return;
    }
    setRefreshing(true);
    return sessionCheckpointStatus(sessionId, cwd)
      .then((status) => {
        if (generation !== request.current) return;
        setFiles(status.files);
        setStatusStale(false);
        setError(null);
        setRecording(false);
      })
      .catch((cause: unknown) => {
        if (generation === request.current) {
          setStatusStale(true);
          const message = cause instanceof Error ? cause.message : String(cause);
          const pending = message.includes("Workspace checkpoint is still recording this turn");
          setRecording(pending);
          setError(pending ? null : message);
        }
      })
      .finally(() => {
        if (generation === request.current) setRefreshing(false);
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

  // The card represents the result of a turn. Keep it out of the live turn,
  // then refresh and reveal it once the turn has settled.
  if (!enabled || busy || (files.length === 0 && !error && !recording)) return null;
  if (recording) {
    return (
      <LoadingText delay={false} className="px-3 py-2">
        {t("Loading changes…")}
      </LoadingText>
    );
  }

  const errorNotice = error ? (
    <Alert tone="danger">
      {error}{" "}
      {error.startsWith("Workspace checkpoint failed:") && (
        <p>
          {t(
            "This turn's changes could not be fully recorded. Fix the reported error before starting a new turn. Refresh only checks the saved checkpoint.",
          )}
        </p>
      )}
      <Button
        variant="ghost"
        type="button"
        onClick={load}
        loading={refreshing}
        disabled={refreshing}
      >
        {t(error.startsWith("Workspace checkpoint failed:") ? "Refresh" : "Retry")}
      </Button>
    </Alert>
  ) : null;
  if (files.length === 0) return errorNotice;

  const disabled = acting != null || statusStale;
  const canUndoAll = !statusStale && !undoLockReason && files.every((file) => file.undoable);
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
    if (actingRef.current) return undefined;
    actingRef.current = true;
    const generation = ++request.current;
    setActing(action);
    setError(null);
    const op =
      action === "keep" ? keepSessionChanges(sessionId, cwd) : undoSessionChanges(sessionId, cwd);
    const previous = filesRef.current.map((file) => file.path);
    return op
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
      <Surface variant="quiet" padding="none" className="overflow-hidden" data-session-review>
        {errorNotice}
        <div className="flex min-w-0 items-center gap-2.5 px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <Text as="div" weight="medium" truncate>
              {t("Changed ")}
              {files.length} {files.length === 1 ? t("file") : t("files")}
            </Text>
            <DiffStat
              additions={totals.additions}
              deletions={totals.deletions}
              showZero
              size="micro"
              weight="medium"
              className="flex font-sans -mt-0.5"
            />
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              variant="ghost"
              type="button"
              tooltip={t("Keep all session changes and dismiss this card")}
              disabled={disabled}
              loading={acting === "keep"}
              onClick={() => void run("keep")}
            >
              {t("Keep")}
            </Button>
            <Button
              variant="secondary"
              type="button"
              onClick={() => onOpenDiff(undefined, { sessionId, cwd })}
            >
              {t("Review")}
            </Button>
            <Tooltip
              label={
                canUndoAll
                  ? t("Undo all session changes")
                  : undoLockReason === "session"
                    ? t("Undo is unavailable while another session is running in this project")
                    : undoLockReason === "orchestration"
                      ? t("Undo is unavailable while an orchestration run is active or paused")
                      : t("Undo is unavailable because a file changed outside this session")
              }
              asChild
            >
              <span className="ms-1.5 border-s border-(--color-stroke) ps-1.5">
                <ConfirmMorph
                  label={t("Undo")}
                  prompt={t("Undo all session changes")}
                  confirmLabel={t("Undo")}
                  pendingLabel={t("Restoring…")}
                  disabled={disabled || !canUndoAll}
                  onConfirm={() => run("undo")}
                />
              </span>
            </Tooltip>
          </div>
        </div>
        <ScrollArea
          as="ul"
          scrollbar="hidden"
          className={`border-t border-(--ui-tone-neutral-border) py-1 ${
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
        </ScrollArea>
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
              <ChevronDown className="icon-sm" strokeWidth={1.75} />
            ) : (
              <ChevronRight className="icon-sm" strokeWidth={1.75} />
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
      </Surface>
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
  const {
    menu,
    openFrom: _openFrom,
    isOpen: _isOpen,
    ...menuHandlers
  } = useChangedFileMenu({
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
        tooltip={file.relative}
        tooltipWhen="overflow"
        onClick={() => onOpenDiff(file.path, { sessionId, cwd })}
        className="w-full min-w-0 text-left"
      >
        <FileTypeIcon name={name} isDir={false} size="md" />
        <Text size="caption" tone="inherit" truncate className="min-w-0 flex-1 font-mono">
          {file.relative}
        </Text>
        <DiffCounts file={file} />
      </Button>
      {menu}
    </>
  );
}

function DiffCounts({ file }: { file: CheckpointFile }) {
  const t = useT();
  if (!file.exact) {
    return (
      <Text size="micro" tone="warning" weight="medium" className="shrink-0">
        {t("Mixed changes")}
      </Text>
    );
  }
  return (
    <DiffStat
      additions={file.additions}
      deletions={file.deletions}
      showZero
      size="micro"
      weight="medium"
      className="flex shrink-0 font-sans"
    />
  );
}
