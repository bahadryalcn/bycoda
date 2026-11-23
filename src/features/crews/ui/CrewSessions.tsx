import { useEffect } from "react";
import { taskSessionIds } from "../../tasks/model/backgroundSession";
import { useProjectCrews } from "../model/crewClient";
import { classifyRemoteError, isConnectionFailure } from "../../connections/model/remoteFailure";
import { reportRemoteConnection } from "../../connections/model/remoteHealth";
import { useRemoteConnectionFeedback } from "../../connections/ui/RemoteConnectionFeedback";

type CrewState = ReturnType<typeof useProjectCrews>;

/** Only query transport failures belong to the machine notice; mutations keep their own outcomes. */
function useCrewConnectionFeedback(cwd: string, state: CrewState) {
  const failure = state.error ? classifyRemoteError(state.error) : undefined;
  const connectionFailure = failure && isConnectionFailure(failure);
  // Registers this query's failure with the shared machine notice.
  useRemoteConnectionFeedback(cwd, failure);
  // Keyed on values, not the data object: a report re-renders the sidebar, so an
  // effect that ran on every new object looped forever (React #185).
  const loaded = state.isSuccess && !!state.data;
  useEffect(() => {
    if (state.error && connectionFailure) reportRemoteConnection(cwd, "crews", state.error);
    else if (loaded) reportRemoteConnection(cwd, "crews");
  }, [cwd, state.error, loaded, connectionFailure]);
}

/**
 * Renders nothing. Keeps the Sessions list informed about the conversations a live crew manages
 * (they are read there, managed from the Crews page) and reports the crew query's connection
 * health. Crew work itself is listed in the Crews page, not in the sidebar.
 */
export function CrewSidebar({
  cwd,
  onManagedChange,
}: {
  cwd: string;
  onManagedChange: (cwd: string, ids: string[]) => void;
}) {
  const state = useProjectCrews(cwd);
  useCrewConnectionFeedback(cwd, state);
  // The managed ids as one value, so the parent hears only real changes; a new
  // data object on each render must not set parent state on each render.
  const managed = state.data
    ? JSON.stringify(
        state.data.runs
          .flatMap((run) => [
            run.coordinatorSessionId,
            ...run.tasks.flatMap((task) => Object.values(taskSessionIds(task))),
          ])
          .filter((id): id is string => !!id),
      )
    : undefined;
  // Tells the parent which sessions this project's crews manage, once per real change.
  useEffect(() => {
    if (managed === undefined) return;
    onManagedChange(cwd, JSON.parse(managed) as string[]);
  }, [cwd, managed, onManagedChange]);
  return null;
}
