import { useEffect, useRef } from "react";
import { isLiveAgentSession } from "../model/liveAgents";
import type { Session } from "../model/session";
import { nextUnseenFinishedSessions } from "../model/sessionDone";
import { sessionIssue } from "../model/sessionIssue";
import { publishUnseenFinished } from "../model/unseenFinishedStore";

export function useUnseenFinishedSessions(
  sessions: Session[],
  busySessionIds: ReadonlySet<string>,
  activeSessionId?: string,
): Set<string> {
  const busyForDoneRef = useRef(busySessionIds);
  const focusedForDoneRef = useRef(activeSessionId);
  const failedForDoneRef = useRef<ReadonlySet<string>>(new Set());
  const sessionsForDoneRef = useRef<Session[] | undefined>(undefined);
  const unseenFinishedRef = useRef<Set<string>>(new Set());
  if (
    busyForDoneRef.current !== busySessionIds ||
    focusedForDoneRef.current !== activeSessionId ||
    sessionsForDoneRef.current !== sessions
  ) {
    const failedIds = new Set(
      sessions.filter((session) => sessionIssue(session) === "failed").map((session) => session.id),
    );
    const nextUnseen = nextUnseenFinishedSessions({
      previousBusyIds: busyForDoneRef.current,
      busyIds: busySessionIds,
      previousUnseenIds: unseenFinishedRef.current,
      focusedSessionId: activeSessionId,
      untrackedIds: new Set(
        sessions.filter((session) => !isLiveAgentSession(session)).map((session) => session.id),
      ),
      previousFailedIds: failedForDoneRef.current,
      failedIds,
    });
    const previousUnseen = unseenFinishedRef.current;
    // Keep the reference while the content is unchanged, so streaming renders do not churn consumers.
    if (
      nextUnseen.size !== previousUnseen.size ||
      [...nextUnseen].some((id) => !previousUnseen.has(id))
    ) {
      unseenFinishedRef.current = nextUnseen;
    }
    busyForDoneRef.current = busySessionIds;
    focusedForDoneRef.current = activeSessionId;
    failedForDoneRef.current = failedIds;
    sessionsForDoneRef.current = sessions;
  }
  const unseen = unseenFinishedRef.current;
  // Publishes to the shared store so the taskbar reads the same set as the sidebar.
  useEffect(() => {
    publishUnseenFinished(unseen);
  }, [unseen]);
  return unseen;
}
