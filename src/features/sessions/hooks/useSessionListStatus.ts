import { useMemo } from "react";

/** Keep list status inputs stable until their source changes. */
export function useSessionListStatus(
  remote: boolean,
  sessions: readonly { id: string; status: string; needsInput?: boolean }[],
  busyIds: Set<string>,
  approvalIds: Set<string>,
) {
  return useMemo(
    () => ({
      listedBusySessionIds: remote
        ? new Set(
            sessions
              .filter((session) => session.status === "running" && !session.needsInput)
              .map((session) => session.id),
          )
        : busyIds,
      listedApprovalSessionIds: remote
        ? new Set(sessions.filter((session) => session.needsInput).map((session) => session.id))
        : approvalIds,
    }),
    [remote, sessions, busyIds, approvalIds],
  );
}
