import type { VoiceWorkEntry, VoiceWorkLedger } from "./voiceWorkLedger";

/** One tool call as the work ledger records it. */
export type VoiceWorkCall = {
  tool: string;
  action?: string;
  requestId?: string;
  args: Record<string, unknown>;
  projectPath?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : undefined);

/**
 * The ledger view of a voice tool call. `app_tool_call` records its input without request ids,
 * so a call retried by a fresh provider session with a new request id still matches its first
 * attempt. `submit_work` carries the bound session so the entry links to it.
 */
export function voiceWorkCall(
  name: string,
  args: Record<string, unknown>,
  context: { sessionId?: string; projectPath?: string } = {},
): VoiceWorkCall {
  if (name === "app_tool_call") {
    const input = isRecord(args.input) ? args.input : {};
    const { requestId: innerRequestId, ...rest } = input;
    const requestId = text(args.requestId) ?? text(innerRequestId);
    const projectPath =
      text(input.projectPath) ?? text(args.projectPath) ?? text(context.projectPath);
    return {
      tool: name,
      ...(text(args.action) ? { action: text(args.action) } : {}),
      ...(requestId ? { requestId } : {}),
      args: rest,
      ...(projectPath ? { projectPath } : {}),
    };
  }
  const { requestId, ...rest } = args;
  const projectPath = text(context.projectPath);
  return {
    tool: name,
    ...(text(requestId) ? { requestId: text(requestId) } : {}),
    args:
      name === "submit_work" && context.sessionId
        ? { ...rest, sessionId: context.sessionId }
        : rest,
    ...(projectPath ? { projectPath } : {}),
  };
}

/** Calls that create new work: the only calls the duplicate guard applies to. */
export function voiceWorkCreates(call: VoiceWorkCall): boolean {
  if (call.tool === "give_jobs" || call.tool === "submit_work") return true;
  if (call.tool !== "app_tool_call") return false;
  return (
    call.action === "workspace.sessions.submit" ||
    (call.action === "workspace.sessions.create" && call.args.submit === true)
  );
}

/** The answer to a repeated call: what already exists, never a second dispatch. */
export function voiceWorkAlreadyStarted(entry: VoiceWorkEntry) {
  return {
    status: "already_started" as const,
    workId: entry.id,
    state: entry.status,
    ...(entry.title ? { title: entry.title } : {}),
    ...(entry.sessionIds.length ? { sessionIds: entry.sessionIds } : {}),
    ...(entry.jobIds.length ? { jobIds: entry.jobIds } : {}),
    ...(entry.projectPath ? { projectPath: entry.projectPath } : {}),
    ...(entry.progress ? { progress: entry.progress } : {}),
    next: "This exact request already started this work; nothing new was dispatched. Tell the owner it is already underway and report its state. Read assistant_status or workspace.sessions.list for current progress.",
  };
}

/**
 * Records a work call in the ledger around `execute`. The entry settles from the tool promise
 * itself, so it settles even after the provider socket or voice generation that asked for it is
 * gone.
 */
export function recordVoiceWork<T>(
  ledger: VoiceWorkLedger,
  call: VoiceWorkCall,
  request: string,
  execute: () => Promise<T>,
): Promise<T> {
  const id = ledger.start({ ...call, request });
  let result: Promise<T>;
  try {
    result = execute();
  } catch (error) {
    result = Promise.reject(error);
  }
  if (id)
    void result
      .then(
        (value) => void ledger.settle(id, value),
        (error: unknown) => void ledger.settle(id, undefined, error ?? "The tool did not finish."),
      )
      .catch(() => {
        // A ledger listener failure must not surface as the tool's own failure.
      });
  return result;
}

/**
 * `recordVoiceWork` behind the duplicate guard: an identical work-creating call for the same
 * owner request returns `already_started` instead of executing again. Every other call runs
 * normally.
 *
 * `connectedAt` limits the guard to work started before the current voice connection: only a
 * fresh provider session has forgotten what it dispatched. Within one connection the model still
 * holds the tool result, and a repeat there keeps the tool's own idempotent replay.
 */
export function runVoiceWork<T>(
  ledger: VoiceWorkLedger,
  call: VoiceWorkCall,
  request: string,
  execute: () => Promise<T>,
  connectedAt?: number,
): Promise<T | ReturnType<typeof voiceWorkAlreadyStarted>> {
  if (voiceWorkCreates(call)) {
    const duplicate = ledger.findDuplicate({
      tool: call.tool,
      action: call.action,
      args: call.args,
      request,
    });
    if (duplicate && (connectedAt === undefined || duplicate.startedAt < connectedAt))
      return Promise.resolve(voiceWorkAlreadyStarted(duplicate));
  }
  return recordVoiceWork(ledger, call, request, execute);
}
