/** The background-wait fields of a session; structural so this layer stays below features. */
type BackgroundWaitFields = {
  backgroundTasks?: string[];
  backgroundAgents?: number;
  backgroundSince?: number;
};

/** Background work a yielded turn still waits on; `backgroundSince` marks when the wait began. */
export function applyBackgroundUpdate<T extends BackgroundWaitFields>(
  session: T,
  event: { tasks: string[]; agents?: number },
  now = Date.now(),
): T {
  if (event.tasks.length === 0) {
    if (!session.backgroundTasks) return session;
    return withoutBackgroundWait(session);
  }
  if (
    session.backgroundAgents === event.agents &&
    session.backgroundTasks?.length === event.tasks.length &&
    session.backgroundTasks.every((task, index) => task === event.tasks[index])
  )
    return session;
  return {
    ...session,
    backgroundTasks: event.tasks,
    backgroundAgents: event.agents,
    backgroundSince: session.backgroundSince ?? now,
  };
}

export function withoutBackgroundWait<T extends BackgroundWaitFields>(session: T): T {
  const {
    backgroundTasks: _tasks,
    backgroundAgents: _agents,
    backgroundSince: _since,
    ...rest
  } = session;
  return rest as T;
}
