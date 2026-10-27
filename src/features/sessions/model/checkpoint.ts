import { invokeWorkspace } from "../../../platform/tauri/fs";
import { remoteSessionFor } from "../../connections/model/connections";
import type { HarnessFileChange } from "../../../integrations/harness/core/types";

function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (
    typeof args?.cwd === "string" &&
    args.cwd.startsWith("remote://") &&
    typeof args.sessionId === "string"
  ) {
    args = { ...args, sessionId: remoteSessionFor(args.sessionId) ?? args.sessionId };
  }
  return invokeWorkspace<T>(command, args);
}
import {
  startPerformanceSpan,
  sessionPerformanceTrace,
} from "../../../shared/lib/performanceTrace";

import type {
  CheckpointStatus,
  CheckpointFileDiff,
  CheckpointApplyResult,
} from "./checkpoint-types";
export type {
  CheckpointFile,
  CheckpointStatus,
  CheckpointFileDiff,
  CheckpointApplyResult,
} from "./checkpoint-types";

const REVIEW_CHANGED = "bycoda-review-changed";
const checkpointQueues = new Map<string, Promise<void>>();

function enqueueCheckpoint<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
  const previous = checkpointQueues.get(sessionId) ?? Promise.resolve();
  const traceId = sessionPerformanceTrace(sessionId);
  const finishWait = startPerformanceSpan("checkpoint", { phase: 1 }, traceId);
  const run = () => {
    finishWait();
    const finishOperation = startPerformanceSpan("checkpoint", { phase: 2 }, traceId);
    return operation().finally(finishOperation);
  };
  const result = previous.then(run, run);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  checkpointQueues.set(sessionId, tail);
  void tail.then(() => {
    if (checkpointQueues.get(sessionId) === tail) {
      checkpointQueues.delete(sessionId);
    }
  });
  return result;
}

/** Wait until every queued checkpoint write for this session is durable. */
export function flushSessionCheckpoint(sessionId: string): Promise<void> {
  return checkpointQueues.get(sessionId) ?? Promise.resolve();
}

export function notifyReviewChanged(sessionId?: string) {
  window.dispatchEvent(new CustomEvent(REVIEW_CHANGED, { detail: sessionId ?? "" }));
}

export function subscribeReviewChanged(listener: (sessionId: string) => void): () => void {
  const handler = (event: Event) => {
    listener((event as CustomEvent<string>).detail ?? "");
  };
  window.addEventListener(REVIEW_CHANGED, handler);
  return () => window.removeEventListener(REVIEW_CHANGED, handler);
}

export function ensureSessionCheckpoint(sessionId: string, cwd: string): Promise<void> {
  return enqueueCheckpoint(sessionId, async () => {
    const finish = startPerformanceSpan(
      "checkpoint",
      { phase: 3 },
      sessionPerformanceTrace(sessionId),
    );
    try {
      const timings = await invoke<{ checkpointWaitMs: number; gitMs: number; diskMs: number }>(
        "session_checkpoint_ensure",
        { sessionId, cwd },
      );
      finish(timings);
    } catch (error) {
      finish();
      throw error;
    }
  });
}

/** Begin bounded per-message file history; whole-tree capture requires explicit opt-in. */
export async function beginSessionTurn(
  sessionId: string,
  cwd: string,
  turnId = crypto.randomUUID(),
  userBlockId: string = turnId,
  experimentalExactGitRewind = false,
): Promise<void> {
  if (!cwd || cwd === "~") return;
  await enqueueCheckpoint(sessionId, () =>
    invoke<void>("session_checkpoint_begin_turn", {
      sessionId,
      cwd,
      turnId,
      userBlockId,
      experimentalExactGitRewind,
    }),
  );
  notifyReviewChanged(sessionId);
}

export function finishSessionTurn(
  sessionId: string,
  cwd: string,
  turnId: string,
  interrupted = false,
): Promise<void> {
  return enqueueCheckpoint(sessionId, () =>
    invoke<void>("session_checkpoint_finish_turn", { sessionId, cwd, turnId, interrupted }),
  ).finally(() => notifyReviewChanged(sessionId));
}

/** Capture a file immediately before a structured edit starts. */
export function prepareSessionCheckpoint(
  sessionId: string,
  cwd: string,
  paths: string[],
): Promise<void> {
  if (paths.length === 0) return Promise.resolve();
  return enqueueCheckpoint(sessionId, () =>
    invoke<void>("session_checkpoint_prepare", {
      sessionId,
      cwd,
      paths,
    }),
  );
}

export function captureSessionCheckpoint(
  sessionId: string,
  cwd: string,
  paths: string[],
): Promise<void> {
  if (paths.length === 0) return Promise.resolve();
  return enqueueCheckpoint(sessionId, () =>
    invoke<void>("session_checkpoint_capture", {
      sessionId,
      cwd,
      paths,
    }),
  );
}

/** Record successful post-write provider evidence without sampling a late baseline. */
export function captureSessionFileChanges(
  sessionId: string,
  cwd: string,
  callId: string,
  changes: HarnessFileChange[],
): Promise<void> {
  // Empty evidence on a completed post-write edit means the runtime must mark
  // its history unavailable, rather than infer ownership from a disk baseline.
  if (!cwd || cwd === "~") return Promise.resolve();
  return enqueueCheckpoint(sessionId, () =>
    invoke<void>("session_checkpoint_file_changes", { sessionId, cwd, callId, changes }),
  );
}

export function sessionCheckpointStatus(sessionId: string, cwd: string): Promise<CheckpointStatus> {
  return enqueueCheckpoint(sessionId, () =>
    invoke<CheckpointStatus>("session_checkpoint_status", {
      sessionId,
      cwd,
    }),
  );
}

/** Apply one isolated worker's captured delta to its lead checkout. */
export function applySessionCheckpoint(
  sessionId: string,
  fromCwd: string,
  toCwd: string,
): Promise<CheckpointApplyResult> {
  return enqueueCheckpoint(sessionId, () =>
    invoke<CheckpointApplyResult>("session_checkpoint_apply", {
      sessionId,
      fromCwd,
      toCwd,
    }),
  );
}

/** True only when the checkout still matches its seeded, pre-worker state. */
export function sessionCheckpointCleanupSafe(sessionId: string, cwd: string): Promise<boolean> {
  return enqueueCheckpoint(sessionId, () =>
    invoke<boolean>("session_checkpoint_cleanup_safe", { sessionId, cwd }),
  );
}

export function forgetSessionCheckpoint(sessionId: string): Promise<void> {
  return enqueueCheckpoint(sessionId, () =>
    invoke<void>("session_checkpoint_forget", { sessionId }),
  );
}

/** The exact before/after contents captured for one session-owned file. */
export function sessionCheckpointFileDiff(
  sessionId: string,
  cwd: string,
  relative: string,
): Promise<CheckpointFileDiff> {
  return enqueueCheckpoint(sessionId, () =>
    invoke<CheckpointFileDiff>("session_checkpoint_file_diff", {
      sessionId,
      cwd,
      relative,
    }),
  );
}

export function undoSessionChanges(
  sessionId: string,
  cwd: string,
  relative?: string,
): Promise<CheckpointStatus> {
  return enqueueCheckpoint(sessionId, () =>
    invoke<CheckpointStatus>("session_checkpoint_undo", {
      sessionId,
      cwd,
      relative: relative ?? null,
    }),
  );
}

export function keepSessionChanges(
  sessionId: string,
  cwd: string,
  relative?: string,
): Promise<CheckpointStatus> {
  return enqueueCheckpoint(sessionId, () =>
    invoke<CheckpointStatus>("session_checkpoint_keep", {
      sessionId,
      cwd,
      relative: relative ?? null,
    }),
  );
}
