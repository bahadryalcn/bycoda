import { LoadingText } from "../../../shared/ui/LoadingText";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { DiffStat } from "../../../shared/ui/DiffStat";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { ScrollArea } from "../../../shared/ui/ScrollArea";
import { Text } from "../../../shared/ui/Text";
import { Surface } from "../../../shared/ui/Surface";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { Button } from "../../../shared/ui/Button";
import { ConfirmMorph } from "../../../shared/ui/ConfirmMorph";
import { useLocale, useT } from "../../../shared/i18n";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import {
  keepSessionChanges,
  sessionCheckpointStatus,
  subscribeReviewChanged,
  undoSessionChanges,
  type CheckpointFile,
} from "../model/checkpoint";
import {
  classifyCheckpointFailure,
  RECORDING_POLL,
  recordingPollDelay,
  type RecordingPhase,
} from "../model/checkpointRecording";
import {
  classifyRemoteError,
  isTransientTransportError,
} from "../../connections/public/remoteFailure";
import { useRemoteSupports } from "../../connections/public/remoteCapabilities";
import { looksLikeProject } from "../../projects/public/recents";
import { isProjectlessCwd } from "../model/recentSessions";
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

/** Review uses the execution checkout, but applies only to a logical project. */
export function useSessionReviewEligibility(projectCwd: string, workCwd: string) {
  const reviewCwd = looksLikeProject(projectCwd) && !isProjectlessCwd(projectCwd) ? workCwd : "";
  const supported = useRemoteSupports(reviewCwd, "sessions.checkpoint-review");
  return !!reviewCwd && supported === true;
}

/** True while an active or paused orchestration run leads or dispatched this session. */
export function orchestrationLocksUndo(runs: readonly UndoLockingRun[], sessionId: string) {
  return runs.some(
    (run) =>
      (run.status === "active" || run.status === "paused") &&
      (run.leadId === sessionId || run.tasks.some((task) => task.sessionId === sessionId)),
  );
}

type ReviewError = "recordingFailed" | "loadFailed" | "retryableLoad" | "keep" | "undo";
type LoadOutcome = "loaded" | "recording" | "failed" | "retry" | "skipped";


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
  const [error, setError] = useState<ReviewError | null>(null);
  const [recording, setRecording] = useState<RecordingPhase>("idle");
  const [refreshing, setRefreshing] = useState(false);
  const [statusStale, setStatusStale] = useState(false);
  const request = useRef(0);
  // Mirrors `recording` for async callbacks; the poll count survives phase changes within one wait.
  const recordingRef = useRef<RecordingPhase>("idle");
  const pollAttempts = useRef(0);
  const setPhase = useStableCallback((next: RecordingPhase) => {
    recordingRef.current = next;
    setRecording(next);
  });
  const actingRef = useRef(false);
  const filesRef = useRef(files);
  useLayoutEffect(() => {
    filesRef.current = files;
  }, [files]);
  // A running turn owns the workspace: drop the previous result, and a short list cannot stay expanded.
  if (busy && files.length > 0) setFiles([]);
  if (expanded && files.length <= 3) setExpanded(false);

  /** `restart` is an explicit refresh: it starts a fresh bounded wait even after one stalled. */
  const load = useCallback(
    (options?: { restart?: boolean; retryOnFailure?: boolean }): Promise<LoadOutcome> => {
      if (actingRef.current) return Promise.resolve("skipped");
      const generation = ++request.current;
      if (!cwd || cwd === "~") {
        setFiles([]);
        return Promise.resolve("skipped");
      }
      setRefreshing(true);
      return sessionCheckpointStatus(sessionId, cwd)
        .then((status): LoadOutcome => {
          if (generation !== request.current) return "skipped";
          setFiles(status.files);
          setStatusStale(false);
          setError(null);
          setPhase("idle");
          pollAttempts.current = 0;
          return "loaded";
        })
        .catch((cause: unknown): LoadOutcome => {
          if (generation !== request.current) return "skipped";
          setStatusStale(true);
          const checkpointFailure = classifyCheckpointFailure(cause);
          if (checkpointFailure === "recording") {
            setError(null);
            if (options?.restart || recordingRef.current === "idle") {
              pollAttempts.current = 0;
              setPhase("waiting");
            }
            return "recording";
          }
          setPhase("idle");
          console.warn("Session change review status failed", cause);
          const failure = classifyRemoteError(cause);
          if (checkpointFailure === "failed") {
            setError("recordingFailed");
          } else if (
            /not a directory|no such file or directory|\bENOENT\b|\bENOTDIR\b/i.test(failure.message)
          ) {
            setFiles([]);
            setError(null);
          } else {
            const retryable =
              isTransientTransportError(cause) ||
              (failure.kind === "other" &&
                /\b(?:EBUSY|EAGAIN|ETIMEDOUT|busy|locked|timed out|temporarily unavailable)\b/i.test(
                  failure.message,
                ));
            if (retryable && options?.retryOnFailure) return "retry";
            setError(retryable ? "retryableLoad" : "loadFailed");
          }
          return "failed";
        })
        .finally(() => {
          if (generation === request.current) setRefreshing(false);
        });
    },
    [sessionId, cwd, setPhase],
  );

  // Refresh settled review status and cancel debounced work when the checkout leaves this view.
  useEffect(() => {
    if (!enabled || busy) return;
    pollAttempts.current = 0;
    let active = true;
    let timer: number | null = null;
    const schedule = () => {
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        void load();
      }, 200);
    };
    void load({ retryOnFailure: true })
      .then((outcome) => {
        if (!active || outcome !== "retry" || timer != null) return;
        timer = window.setTimeout(() => {
          timer = null;
          void load();
        }, RECORDING_POLL.baseMs);
      })
      .catch((cause: unknown) => console.warn("Session change review refresh failed", cause));
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
      active = false;
      request.current += 1;
      if (timer != null) window.clearTimeout(timer);
      window.removeEventListener("focus", onResume);
      document.removeEventListener("visibilitychange", onResume);
      unsubReview();
      unsubGit();
    };
  }, [enabled, load, sessionId, busy]);

  // While the Host records the turn, poll with backoff, a capped attempt count and no polling
  // while the page is hidden; after the cap the card stalls until an explicit refresh or a return
  // to the visible window starts a new bounded wait.
  useEffect(() => {
    if (recording === "idle" || !enabled || busy) return;
    let cancelled = false;
    let timer: number | null = null;
    const stop = () => {
      if (timer != null) window.clearTimeout(timer);
      timer = null;
    };
    const arm = () => {
      stop();
      if (cancelled || document.hidden) return;
      timer = window.setTimeout(tick, recordingPollDelay(pollAttempts.current));
    };
    function tick() {
      timer = null;
      pollAttempts.current += 1;
      void load().then(() => {
        // `load` settled the phase unless the checkpoint is still recording (or the poll was superseded).
        if (cancelled || recordingRef.current !== "waiting") return;
        if (pollAttempts.current >= RECORDING_POLL.maxAttempts) setPhase("stalled");
        else arm();
      });
    }
    const onVisibility = () => {
      if (document.hidden) stop();
      else if (recordingRef.current === "stalled") void load({ restart: true });
      else if (timer == null) arm();
    };
    document.addEventListener("visibilitychange", onVisibility);
    if (recording === "waiting") arm();
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [recording, enabled, busy, load, setPhase]);

  // The card represents the result of a turn. Keep it out of the live turn,
  // then refresh and reveal it once the turn has settled.
  if (!enabled || busy || (files.length === 0 && !error && recording === "idle")) return null;
  if (recording === "waiting") {
    return (
      <LoadingText delay={false} inset="row">
        {t("Loading changes…")}
      </LoadingText>
    );
  }
  if (recording === "stalled") {
    return (
      <InlineMessage
        tone="neutral"
        inset="row"
        retry={{
          label: t("Refresh"),
          onRetry: () => void load({ restart: true }),
          pending: refreshing,
        }}
      >
        {t("Still recording this turn's changes…")}
      </InlineMessage>
    );
  }

  const errorNotice = error ? (
    <InlineError
      inset="row"
      retry={
        error === "retryableLoad"
          ? { label: t("Retry"), onRetry: () => void load({ restart: true }), pending: refreshing }
          : undefined
      }
    >
      {error === "recordingFailed"
        ? t("Could not record this turn's changes.")
        : error === "keep"
          ? t("Could not keep session changes.")
          : error === "undo"
            ? t("Could not undo session changes.")
            : t("Could not load the changes.")}
    </InlineError>
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
        console.warn("Session change review action failed", cause);
        if (generation === request.current) setError(action);
      })
      .finally(() => {
        actingRef.current = false;
        setActing(null);
      });
  };

  return (
    <div className="pt-1 pb-2 font-sans" data-session-review-shell>
      <Surface variant="card" padding="none" className="overflow-hidden" data-session-review>
        {errorNotice}
        <div className="flex min-w-0 items-center gap-2.5 px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <Text as="div" tone="inherit" weight="medium" truncate>
              {t(files.length === 1 ? "{p0} file changed" : "{p0} files changed", {
                p0: files.length,
              })}
            </Text>
            <DiffStat
              additions={totals.additions}
              deletions={totals.deletions}
              showZero
              size="micro"
              weight="medium"
              className="flex font-sans"
            />
          </div>
          <div className="flex shrink-0 items-center gap-0.5" data-session-review-actions>
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
              <span>
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
          {...surfaceAttributes(
            { frame: "pane", edge: "top" },
            `py-1 ${expanded ? "max-h-64 overflow-y-auto" : ""}`,
          )}
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
            expanded={expanded}
            chevron="start"
            onClick={() => setExpanded((open) => !open)}
            className="w-full text-left"
          >
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
