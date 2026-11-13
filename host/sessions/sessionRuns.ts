import { randomUUID } from "node:crypto";
import type { WorkSource, WorkWait } from "../../src/shared/model/host-contracts/work";
import { submitSessionWork } from "../work/session-adapter";
import type { BudgetRunRegistration } from "../tasks/task-budgets";
import { runLimitBreach } from "../../src/features/automations/model/automationLimits";
import type { RemoteProvider } from "../../src/features/connections/model/protocol";
import {
  sessionNeedsInput,
  type RuntimeMode,
  type SessionMessageAuthor,
  type UsageLimit,
} from "../../src/features/sessions/model/session";
import type { HostEngine } from "../engine";
import type { HostStore } from "../store";
import { confirmedRunProgress } from "../execution/run-duration";
import { newRequestId } from "../../src/shared/lib/id/requestId";

export const STOPPED_BY_USER = "Stopped by you.";
export const HOST_INTERRUPTED = "The host stopped during this run.";

export type SessionRunEngine = Pick<HostEngine, "command" | "updateSession"> &
  Partial<Pick<HostEngine, "withMessageAuthor" | "withCommandAdmission">>;

/** What an unattended run needs to start: one prompt in a fresh session. */
export type SessionRunSpec = {
  work?: WorkSource;
  workRootWorkId?: string;
  workBudgetScope?: Pick<BudgetRunRegistration, "taskId" | "parentTaskId" | "goalId" | "role">;
  /** Continue an existing, producer-validated conversation through Work admission. */
  resumeSessionId?: string;
  author?: SessionMessageAuthor;
  /** Optional durable launch identity; explicit retries reuse host receipts. */
  requestId?: string;
  /** Internal queue receipts; IDs also become filesystem-backed user block IDs. */
  commandIds?: { create: string; send: string };
  projectId: string;
  harness: RemoteProvider;
  providerAccountId?: string;
  model: string;
  modelSettings: Record<string, string>;
  runtimeMode: RuntimeMode;
  title: string;
  prompt: string;
  /** Plan intent asks a harness with plan mode to answer without editing. */
  intent?: "default" | "plan";
  /** The Host derives execution identity from the authoritative registry. */
  workspaceId?: string;
  workspaceMode?: "current" | "worktree";
  /** A worktree of the project to run in, instead of the project folder. */
  worktreeCwd?: string;
};

/** The session turn an unattended run started, as its owner recorded it. */
export type SessionRun = {
  sessionId?: string;
  runId?: string;
  startedAt: number;
  /** Why the run is being stopped, saved before its turn was cancelled. */
  error?: string;
};

export type SessionRunState =
  | { state: "running"; needsInput: boolean; lastActivityAt?: number; durationUncertain?: boolean }
  /** Past its time limit: save `error`, then cancel the turn. */
  | { state: "overLimit"; error: string }
  | {
      state: "finished";
      status: "succeeded" | "failed" | "cancelled";
      error?: string;
      /** The provider usage limit that ended the turn, read from the session itself. */
      usageLimit?: UsageLimit;
    };

/** Starts the prompt in a new session. A failure is returned, not thrown, with
 * the session when one was already created. */
export async function launchSessionRun(
  store: HostStore,
  engine: SessionRunEngine,
  spec: SessionRunSpec,
  admitted: () => boolean | Promise<boolean> = () => true,
): Promise<{
  sessionId?: string;
  runId?: string;
  error?: string;
  deferred?: boolean;
  wait?: WorkWait;
}> {
  if (spec.work)
    return submitSessionWork(store, engine, spec, admitted, (accepted, workAdmitted) =>
      launchSessionRun(store, engine, { ...accepted, work: undefined }, workAdmitted ?? admitted),
    );
  let sessionId: string | undefined = spec.resumeSessionId;
  try {
    if (!(await admitted())) return { deferred: true };
    if (!sessionId)
      sessionId = (
        await engine.command({
          type: "create",
          commandId:
            spec.commandIds?.create ?? (spec.requestId ? `${spec.requestId}:create` : randomUUID()),
          projectId: spec.projectId,
          ...(spec.workspaceId ? { workspaceId: spec.workspaceId } : {}),
          ...(spec.workspaceMode ? { workspaceMode: spec.workspaceMode } : {}),
          ...(spec.worktreeCwd ? { worktreeCwd: spec.worktreeCwd } : {}),
          harness: spec.harness,
          ...(spec.providerAccountId === undefined
            ? {}
            : { providerAccountId: spec.providerAccountId }),
          model: spec.model,
          modelSettings: spec.modelSettings,
          runtimeMode: spec.runtimeMode,
        })
      ).sessionId;
    if (!(await admitted())) return { sessionId, deferred: true };
    await engine.updateSession(sessionId, { title: spec.title });
    if (!(await admitted())) return { sessionId, deferred: true };
    const send = () =>
      engine.command({
        type: "send",
        commandId:
          spec.commandIds?.send ?? (spec.requestId ? `${spec.requestId}:send` : randomUUID()),
        sessionId,
        text: spec.prompt,
        ...(spec.intent ? { intent: spec.intent } : {}),
      });
    const receipt =
      spec.author && engine.withMessageAuthor
        ? await engine.withMessageAuthor(spec.author, send)
        : await send();
    return { sessionId, runId: receipt.runId ?? (await store.session(sessionId)).runId };
  } catch (error) {
    return { sessionId, error: errorMessage(error) };
  }
}

/** Where a started run stands. `maxRunMinutes` of zero means no time limit. */
export async function sessionRunState(
  store: HostStore,
  run: SessionRun,
  maxRunMinutes: number,
  now: number,
): Promise<SessionRunState> {
  let session;
  try {
    session = await store.session(run.sessionId ?? "");
  } catch {
    return {
      state: "finished",
      status: "failed",
      error: "The run's session was deleted.",
    };
  }
  if (session.status === "running" && session.runId === run.runId) {
    const progress =
      run.sessionId && run.runId && maxRunMinutes > 0
        ? await confirmedRunProgress(store, run.sessionId, run.runId, now)
        : { elapsed: 0, uncertain: maxRunMinutes > 0 };
    const breach = run.error
      ? null
      : runLimitBreach(
          { maxRunMinutes, maxRunsPerDay: 0 },
          { startedAt: 0, now: progress.elapsed },
        );
    const activity = session.runActivity;
    const lastActivityAt =
      activity &&
      activity.runId === run.runId &&
      Number.isSafeInteger(activity.lastActivityAt) &&
      activity.lastActivityAt >= run.startedAt &&
      activity.lastActivityAt <= now
        ? activity.lastActivityAt
        : undefined;
    return breach
      ? { state: "overLimit", error: breach }
      : {
          state: "running",
          needsInput: sessionNeedsInput(session.session),
          ...(progress.uncertain ? { durationUncertain: true } : {}),
          ...(lastActivityAt === undefined ? {} : { lastActivityAt }),
        };
  }
  if (run.error) return { state: "finished", status: "failed", error: run.error };
  if (session.status === "interrupted")
    return {
      state: "finished",
      status: "failed",
      error: HOST_INTERRUPTED,
    };
  // The host ends a failed or stopped turn with a system note.
  const last = session.session.blocks.at(-1);
  const note = last?.role === "system" ? last.text.trim() : "";
  if (!note) return { state: "finished", status: "succeeded" };
  if (note === STOPPED_BY_USER) return { state: "finished", status: "cancelled" };
  const usageLimit = session.session.usageLimit;
  return {
    state: "finished",
    status: "failed",
    error: note,
    ...(usageLimit ? { usageLimit } : {}),
  };
}

export async function cancelSessionRun(
  engine: SessionRunEngine,
  run: Pick<SessionRun, "sessionId" | "runId">,
): Promise<void> {
  await engine.command({
    type: "cancel",
    commandId: newRequestId(),
    sessionId: run.sessionId ?? "",
    runId: run.runId,
  });
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
