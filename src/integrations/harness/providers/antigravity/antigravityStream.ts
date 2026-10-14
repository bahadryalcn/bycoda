import { nativeModelId } from "../../../../features/sessions/model/models";
import { additionalDirsFor } from "../../core/additionalDirs";
import { killChild, spawnChild, unwatchChild, watchChild, writeChild } from "../../core/child";
import type { HarnessEvent, SendTurnInput } from "../../core/types";
import {
  antigravityStreamArgs,
  antigravityStreamUserLine,
  beginStreamTurn,
  createStreamState,
  handleStreamLine,
  streamModeRefusal,
  type StreamState,
} from "./antigravityStreamProtocol";

/**
 * The stream-json transport: one `agy` process per Bycoda session, one NDJSON
 * line on stdin per turn, `result` ends the turn. Cancel kills the process; the
 * conversation id is kept so the next turn resumes it with `--conversation`.
 * See antigravityStreamProtocol.ts for what agy was observed to do.
 */

type Turn = {
  resolve: () => void;
  reject: (error: Error) => void;
  onAccepted?: () => void;
};

type Live = {
  sessionId: string;
  /** Generation-scoped child id: output of a retired process never reaches a
   *  newer one, whatever order the events arrive in. */
  childKey: string;
  cwd: string;
  /** Everything fixed at spawn; a turn that wants different values recycles. */
  launchKey: string;
  state: StreamState;
  onEvent: (event: HarnessEvent) => void;
  turn?: Turn;
  initialized: boolean;
  /** Spawned with `--conversation`; a failed start then drops the binding. */
  resumed: boolean;
  retired: boolean;
  ready: { resolve: () => void; reject: (error: Error) => void };
  stderr: string[];
};

type Resume = { conversationId: string; cwd: string };

const READY_TIMEOUT_MS = 60_000;
const STDERR_TAIL = 4;

const liveBySession = new Map<string, Live>();
const resumeBySession = new Map<string, Resume>();
// Cancel, stop and forget bump the epoch: a send already waiting at that moment
// is dropped, one that arrives later captures the new epoch and runs.
const epochBySession = new Map<string, number>();
const turnsBySession = new Map<string, Promise<void>>();
let childSeq = 0;

const epochOf = (sessionId: string) => epochBySession.get(sessionId) ?? 0;
const bumpEpoch = (sessionId: string) => epochBySession.set(sessionId, epochOf(sessionId) + 1);

export async function sendAntigravityStreamTurn(
  input: SendTurnInput,
  binary: { path: string },
): Promise<void> {
  const refusal = streamModeRefusal(input.runtimeMode, input.intent);
  if (refusal) throw new Error(refusal);
  const line = antigravityStreamUserLine(input.text, input.attachments);
  if (!line) return;

  const epoch = epochOf(input.sessionId);
  const cancelled = () => epochOf(input.sessionId) !== epoch;
  // Turns serialize per session: a queued send must not run against a process
  // the previous turn is still using.
  const run = (turnsBySession.get(input.sessionId) ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => runTurn(input, binary.path, line, cancelled));
  turnsBySession.set(input.sessionId, run);
  try {
    await run;
  } finally {
    if (turnsBySession.get(input.sessionId) === run) {
      turnsBySession.delete(input.sessionId);
    }
  }
}

async function runTurn(
  input: SendTurnInput,
  path: string,
  line: string,
  cancelled: () => boolean,
): Promise<void> {
  if (cancelled()) return;
  const live = await ensureLive(input, path, cancelled);
  if (!live || cancelled()) return;
  live.onEvent = input.onEvent;
  beginStreamTurn(live.state);
  await new Promise<void>((resolve, reject) => {
    live.turn = { resolve, reject, onAccepted: input.onAccepted };
    writeChild(live.childKey, line).catch((error: unknown) =>
      finishTurn(live, error instanceof Error ? error : new Error(String(error))),
    );
  });
}

function launchFor(input: SendTurnInput) {
  const model = nativeModelId(input.model);
  return {
    model: model || undefined,
    addDirs: additionalDirsFor(input.sessionId),
    runtimeMode: input.runtimeMode,
  };
}

async function ensureLive(
  input: SendTurnInput,
  path: string,
  cancelled: () => boolean,
): Promise<Live | undefined> {
  const sessionId = input.sessionId;
  const launch = launchFor(input);
  // Keyed on the flags, not the mode: two modes that launch alike share one.
  const launchKey = JSON.stringify([input.cwd, antigravityStreamArgs(launch)]);
  const existing = liveBySession.get(sessionId);
  if (existing?.launchKey === launchKey) return existing;
  if (existing) await teardown(existing);
  if (cancelled()) return undefined;

  let resume = resumeBySession.get(sessionId);
  if (resume && resume.cwd !== input.cwd) {
    resumeBySession.delete(sessionId);
    resume = undefined;
  }
  const args = antigravityStreamArgs({
    ...launch,
    conversationId: resume?.conversationId,
  });
  const childKey = `${sessionId}#${childSeq++}`;
  let ready!: Live["ready"];
  const readiness = new Promise<void>((resolve, reject) => {
    ready = { resolve, reject };
  });
  // Nothing awaits this until the spawn returns; an early rejection must not
  // surface as an unhandled one.
  readiness.catch(() => undefined);
  const live: Live = {
    sessionId,
    childKey,
    cwd: input.cwd,
    launchKey,
    state: createStreamState(),
    onEvent: input.onEvent,
    initialized: false,
    resumed: resume != null,
    retired: false,
    ready,
    stderr: [],
  };
  liveBySession.set(sessionId, live);
  watchChild(
    childKey,
    (text) => onLine(live, text),
    (code) => onExit(live, code),
    (text) => {
      live.stderr = [...live.stderr, text].slice(-STDERR_TAIL);
      console.debug("[bycoda] antigravity stderr", text);
    },
  );

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await spawnChild(childKey, path, args, input.cwd, undefined, "antigravity");
    await Promise.race([
      readiness,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Antigravity did not start in time.")),
          READY_TIMEOUT_MS,
        );
      }),
    ]);
  } catch (error) {
    const wasRetired = live.retired;
    await teardown(live);
    if (wasRetired && cancelled()) return undefined;
    throw error;
  } finally {
    clearTimeout(timer);
  }
  if (cancelled() || live.retired) {
    await teardown(live);
    return undefined;
  }
  if (resume && live.state.conversationId !== resume.conversationId) {
    // agy only warns about an unknown id and quietly opens a new conversation.
    resumeBySession.delete(sessionId);
    input.onEvent({
      type: "status",
      text: "Antigravity could not restore the previous conversation — starting a new one.",
    });
  }
  if (live.state.conversationId) {
    input.onEvent({
      type: "session.providerBound",
      providerSessionId: live.state.conversationId,
    });
  }
  input.onEvent({ type: "session.started" });
  return live;
}

function onLine(live: Live, line: string): void {
  if (live.retired) return;
  const outcome = handleStreamLine(live.state, line);
  if (outcome.initialized) {
    live.initialized = true;
    live.ready.resolve();
  }
  if (outcome.userAccepted) {
    // Only now does the conversation certainly exist, so only now is it
    // something a later process can resume.
    const conversationId = live.state.conversationId;
    if (conversationId) {
      resumeBySession.set(live.sessionId, { conversationId, cwd: live.cwd });
    }
    const accepted = live.turn?.onAccepted;
    if (live.turn) live.turn.onAccepted = undefined;
    accepted?.();
  }
  if (!live.turn) {
    // A result before init is a launch that agy refused (bad model, no login).
    if (outcome.result && !live.initialized) {
      live.ready.reject(new Error(startFailure(live, outcome.result.error)));
    }
    return;
  }
  for (const event of outcome.events) live.onEvent(event);
  if (!outcome.result) return;
  if (!outcome.result.ok) {
    live.onEvent({
      type: "session.error",
      message: outcome.result.error ?? "Antigravity turn failed.",
    });
  }
  finishTurn(live);
}

function onExit(live: Live, code: number | null): void {
  unwatchChild(live.childKey);
  if (liveBySession.get(live.sessionId) === live) {
    liveBySession.delete(live.sessionId);
  }
  const wasRetired = live.retired;
  live.retired = true;
  if (!live.initialized) {
    live.ready.reject(new Error(startFailure(live, `Antigravity exited (code ${code ?? "?"}).`)));
  }
  if (live.turn) {
    const tail = lastStderr(live);
    finishTurn(
      live,
      new Error(`Antigravity exited unexpectedly (code ${code ?? "?"}).${tail ? ` ${tail}` : ""}`),
    );
  }
  if (!wasRetired) live.onEvent({ type: "session.ended", code });
}

function lastStderr(live: Live): string | undefined {
  return live.stderr[live.stderr.length - 1];
}

/** Why the process never became ready, with the resume binding it cost. */
function startFailure(live: Live, reason?: string): string {
  const detail = reason ?? lastStderr(live) ?? "Antigravity failed to start.";
  if (!live.resumed) return detail;
  // The id may be gone from agy's store; keeping it would fail every retry.
  if (resumeBySession.get(live.sessionId)?.cwd === live.cwd) {
    resumeBySession.delete(live.sessionId);
  }
  return `${detail}\n\nThe previous Antigravity conversation could not be resumed; your next message starts a new one.`;
}

function finishTurn(live: Live, error?: Error): void {
  const turn = live.turn;
  if (!turn) return;
  live.turn = undefined;
  if (error) turn.reject(error);
  else turn.resolve();
}

/** Retire exactly this generation: no later output, no session.ended. */
async function teardown(live: Live): Promise<void> {
  if (liveBySession.get(live.sessionId) === live) {
    liveBySession.delete(live.sessionId);
  }
  live.retired = true;
  unwatchChild(live.childKey);
  live.ready.reject(new Error("Antigravity session stopped."));
  // A cancelled turn settles quietly; the caller already knows.
  finishTurn(live);
  await killChild(live.childKey).catch(() => undefined);
}

export async function cancelAntigravityStreamTurn(sessionId: string): Promise<void> {
  bumpEpoch(sessionId);
  const live = liveBySession.get(sessionId);
  // An idle process stays warm. One mid-turn (or mid-start) cannot be asked to
  // stop, so it is killed and the next turn resumes the conversation.
  if (live && (live.turn || !live.initialized)) await teardown(live);
}

export async function stopAntigravityStreamSession(sessionId: string): Promise<void> {
  bumpEpoch(sessionId);
  const live = liveBySession.get(sessionId);
  if (live) await teardown(live);
}

export async function forgetAntigravityStreamSession(sessionId: string): Promise<void> {
  resumeBySession.delete(sessionId);
  await stopAntigravityStreamSession(sessionId);
}

export function bindAntigravityStreamSession(
  threadId: string,
  conversationId: string,
  cwd: string,
): void {
  const id = conversationId.trim();
  if (!threadId || !id || !cwd.trim()) return;
  resumeBySession.set(threadId, { conversationId: id, cwd });
}
