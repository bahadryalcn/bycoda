import { randomUUID } from "node:crypto";
import { runLimitBreach } from "../src/features/automations/model/automationLimits";
import type { RemoteProvider } from "../src/features/connections/model/protocol";
import { sessionNeedsInput, type RuntimeMode } from "../src/features/sessions/model/session";
import type { HostEngine } from "./engine";
import type { HostStore } from "./store";

export const STOPPED_BY_USER = "Stopped by you.";
export const HOST_INTERRUPTED = "The host stopped during this run.";

export type SessionRunEngine = Pick<HostEngine, "command" | "updateSession">;

/** What an unattended run needs to start: one prompt in a fresh session. */
export type SessionRunSpec = {
  /** Optional durable launch identity; explicit retries reuse host receipts. */
  requestId?: string;
  projectId: string;
  harness: RemoteProvider;
  providerAccountId?: string;
  model: string;
  modelSettings: Record<string, string>;
  runtimeMode: RuntimeMode;
  title: string;
  prompt: string;
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
  | { state: "running"; needsInput: boolean }
  /** Past its time limit: save `error`, then cancel the turn. */
  | { state: "overLimit"; error: string }
  | {
      state: "finished";
      status: "succeeded" | "failed" | "cancelled";
      error?: string;
    };

/** Starts the prompt in a new session. A failure is returned, not thrown, with
 * the session when one was already created. */
export async function launchSessionRun(
  store: HostStore,
  engine: SessionRunEngine,
  spec: SessionRunSpec,
  admitted: () => boolean = () => true,
): Promise<{ sessionId?: string; runId?: string; error?: string; deferred?: boolean }> {
  let sessionId: string | undefined;
  try {
    if (!admitted()) return { deferred: true };
    sessionId = (
      await engine.command({
        type: "create",
        commandId: spec.requestId ? `${spec.requestId}:create` : randomUUID(),
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
    if (!admitted()) return { sessionId, deferred: true };
    await engine.updateSession(sessionId, { title: spec.title });
    if (!admitted()) return { sessionId, deferred: true };
    await engine.command({
      type: "send",
      commandId: spec.requestId ? `${spec.requestId}:send` : randomUUID(),
      sessionId,
      text: spec.prompt,
    });
    return { sessionId, runId: (await store.session(sessionId)).runId };
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
    const breach = run.error
      ? null
      : runLimitBreach({ maxRunMinutes, maxRunsPerDay: 0 }, { startedAt: run.startedAt, now });
    return breach
      ? { state: "overLimit", error: breach }
      : { state: "running", needsInput: sessionNeedsInput(session.session) };
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
  return { state: "finished", status: "failed", error: note };
}

export async function cancelSessionRun(
  engine: SessionRunEngine,
  run: Pick<SessionRun, "sessionId" | "runId">,
): Promise<void> {
  await engine.command({
    type: "cancel",
    commandId: randomUUID(),
    sessionId: run.sessionId ?? "",
    runId: run.runId,
  });
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
