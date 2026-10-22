/**
 * Which of Claude Code's tasks a stop request from the UI means.
 *
 * Claude runs every subagent, backgrounded shell and monitor as a task, and a
 * `stop_task` control request ends one by id without touching the turn. The
 * UI only knows transcript tool-call ids, so this maps one to the other.
 */

/** The slice of the live session the lookup reads. */
export type StopTaskState = {
  agentTasks: ReadonlyMap<string, { toolUseId?: string; description: string }>;
  backgroundTasks: ReadonlyMap<string, { toolUseId?: string }>;
  /** Task id to the call id of the row shown for a command left running. */
  backgroundRows: ReadonlyMap<string, string>;
};

export type StopTarget = {
  taskId: string;
  /** Every transcript call that stands for this task. */
  callIds: string[];
};

/** The call id a subagent row has when its task started before its call. */
export function agentFallbackCallId(description: string): string {
  return `agent:${description}`;
}

/**
 * The tasks to stop: the one behind `callId`, or every running task when no
 * call is given. A call that matches nothing (the task already ended) stops
 * nothing.
 */
export function resolveStopTargets(state: StopTaskState, callId?: string): StopTarget[] {
  const taskIds = new Set([...state.backgroundTasks.keys(), ...state.agentTasks.keys()]);
  const targets: StopTarget[] = [];
  for (const taskId of taskIds) {
    const agent = state.agentTasks.get(taskId);
    const callIds = [
      agent ? (agent.toolUseId ?? agentFallbackCallId(agent.description)) : undefined,
      state.backgroundTasks.get(taskId)?.toolUseId,
      state.backgroundRows.get(taskId),
    ].filter((id): id is string => !!id);
    if (callId !== undefined && !callIds.includes(callId)) continue;
    targets.push({ taskId, callIds: [...new Set(callIds)] });
  }
  return targets;
}

/**
 * What a settled task reads as. Claude reports a task the user stopped as
 * `killed` or `stopped`; only then is it "stopped by you". A task that
 * finished a moment before the request keeps its own outcome.
 */
export function settledTaskStatus(status: string, stoppedByUser: boolean) {
  const key = status.toLowerCase();
  return stoppedByUser && (key === "killed" || key === "stopped") ? "stopped" : status;
}
