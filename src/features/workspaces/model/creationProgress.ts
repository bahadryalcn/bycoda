import { useEffect, useRef, useState } from "react";
import { errorText } from "../../../shared/lib/errors";
import type {
  WorkspaceCreationPhase,
  WorkspaceCreationProgress,
  WorkspaceCreationStage,
} from "./contracts";
import {
  WorkspaceCapabilityError,
  workspacePrepareCancel,
  workspacePrepareStatus,
  type WorkspaceContext,
} from "./workspaceClient";

const POLL_INTERVAL_MS = 400;
const POLL_RETRY_MAX_MS = 5_000;
/** Consecutive failed polls (about 35 s with backoff) after which polling gives up. */
export const MAX_POLL_FAILURES = 10;

export type CreationProgressView = {
  /** Null until the first poll answers; `agent` is set client-side when the turn starts. */
  phase: WorkspaceCreationPhase | null;
  stages: WorkspaceCreationStage[];
  /** Last poll failure; polling retries with backoff and gives up after `MAX_POLL_FAILURES` in a row. */
  error?: string;
};

/** A fresh client-chosen id for one `workspaces.prepare` call and its status/cancel polls. */
export function newCreationProgressId(): string {
  return crypto.randomUUID();
}

const STAGE_ORDER: WorkspaceCreationStage["id"][] = [
  "fetch",
  "checkout",
  "submodules",
  "setup",
  "agent",
];

/**
 * The Host sets every stage but `agent`; the turn starts as soon as the prepare resolves, so a
 * finished creation shows its stages (and `agent`) as done.
 */
export function finishedStages(stages: WorkspaceCreationStage[]): WorkspaceCreationStage[] {
  const byId = new Map(stages.map((stage) => [stage.id, stage]));
  return STAGE_ORDER.flatMap((id) => {
    const stage = byId.get(id);
    if (stage)
      return [
        stage.status === "pending" || stage.status === "running"
          ? { ...stage, status: "done" as const }
          : stage,
      ];
    return id === "agent" ? [{ id, status: "done" as const }] : [];
  });
}

/** Whether a creation in this phase still needs polling. */
export const isCreationRunning = (phase: WorkspaceCreationPhase | null): boolean =>
  phase === null || phase === "running";

type Snapshot = { progressId: string; progress?: WorkspaceCreationProgress; error?: string };

/**
 * Polls `workspaces.prepare.status` for `progressId` (every 400 ms) while `progressId` is set
 * and the creation runs; stops on done, failed or cancelled, and for good on a Host without the
 * creation capability. A null id means idle. A poll that fails (including "not found" before
 * the prepare request registered) keeps the last snapshot and is retried with backoff; after
 * `MAX_POLL_FAILURES` in a row (Host restarted, entry expired) it stops and keeps `error`.
 */
export function useCreationProgress(
  progressId: string | null,
  context?: WorkspaceContext,
): CreationProgressView {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const contextRef = useRef(context);
  // The poll loop must read the latest context without restarting on every render.
  useEffect(() => {
    contextRef.current = context;
  });
  // One poll loop per progress id; the cleanup stops it when the id changes or clears.
  useEffect(() => {
    if (!progressId) return;
    let stopped = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = () => {
      workspacePrepareStatus(progressId, contextRef.current).then(
        (progress) => {
          if (stopped) return;
          failures = 0;
          setSnapshot({ progressId, progress });
          if (progress.phase === "running") timer = setTimeout(poll, POLL_INTERVAL_MS);
        },
        (error: unknown) => {
          if (stopped) return;
          setSnapshot((previous) => ({
            progressId,
            progress: previous?.progressId === progressId ? previous.progress : undefined,
            error: errorText(error),
          }));
          failures += 1;
          if (!(error instanceof WorkspaceCapabilityError) && failures < MAX_POLL_FAILURES)
            timer = setTimeout(
              poll,
              Math.min(POLL_INTERVAL_MS * 2 ** (failures - 1), POLL_RETRY_MAX_MS),
            );
        },
      );
    };
    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [progressId]);
  const current = progressId && snapshot?.progressId === progressId ? snapshot : undefined;
  const progress = current?.progress;
  return {
    phase: progress?.phase ?? null,
    stages: progress
      ? progress.phase === "done"
        ? finishedStages(progress.stages)
        : progress.stages
      : [],
    ...(current?.error ? { error: current.error } : {}),
  };
}

/** Requests `workspaces.prepare.cancel`; resolves with the final snapshot. */
export function cancelCreation(
  progressId: string,
  context?: WorkspaceContext,
): Promise<WorkspaceCreationProgress> {
  return workspacePrepareCancel(progressId, context);
}
