/**
 * Pure "Waiting" rules shared by the renderer and the Host session list. No i18n,
 * no UI: the Host imports this file to stamp `waiting` on session summaries.
 *
 * - `commands`: only background commands hold the turn open.
 * - `agents`: subagents still run for the turn.
 * - `tasks`: background work the provider cannot split into commands and agents.
 * - `delegated`: the turn ended; delegated child sessions still run.
 * - `pull-request`: the session is idle; a Host pull request watch will wake it.
 */
export type SessionWaitKind = "commands" | "agents" | "tasks" | "delegated" | "pull-request";

export type SessionWait = {
  kind: SessionWaitKind;
  count: number;
  since?: number;
  /** What is awaited, for wake sources (for example "acme/app#12"). */
  label?: string;
};

/** Something the Host holds that will send the idle session a message later. */
export type SessionWakeSource = {
  kind: "pull-request";
  label: string;
  since?: number;
  /** After this time the source is stale and never shown, even if the list lags. */
  until?: number;
};

/** The turn yielded but background work it started still runs. Null while the agent itself works. */
export function backgroundWait(session: {
  backgroundTasks?: readonly string[];
  backgroundAgents?: number;
  backgroundSince?: number;
}): SessionWait | null {
  const tasks = session.backgroundTasks?.length ?? 0;
  if (tasks === 0) return null;
  const agents = session.backgroundAgents;
  const kind = agents === undefined ? "tasks" : agents === 0 ? "commands" : "agents";
  return { kind, count: tasks, since: session.backgroundSince };
}

/** The turn ended while delegated children still run, from the earliest child start. */
export function delegatedWait(
  children: readonly { running: boolean; startedAt?: number }[],
): SessionWait | null {
  const running = children.filter((child) => child.running);
  if (running.length === 0) return null;
  const starts = running.map((child) => child.startedAt).filter((at): at is number => at != null);
  return {
    kind: "delegated",
    count: running.length,
    since: starts.length ? Math.min(...starts) : undefined,
  };
}

/** Wake sources still pending at `now`; one past its `until` is ignored. */
export function activeWakeSources(
  sources: readonly SessionWakeSource[] | undefined,
  now: number,
): SessionWakeSource[] {
  return (sources ?? []).filter((source) => source.until === undefined || source.until > now);
}

/** An idle session waits on its pending wake sources. */
export function wakeSourceWait(
  sources: readonly SessionWakeSource[] | undefined,
  now: number,
): SessionWait | null {
  const active = activeWakeSources(sources, now);
  if (active.length === 0) return null;
  const starts = active.map((source) => source.since).filter((at): at is number => at != null);
  return {
    kind: "pull-request",
    count: active.length,
    since: starts.length ? Math.min(...starts) : undefined,
    label: active.map((source) => source.label).join(", "),
  };
}
