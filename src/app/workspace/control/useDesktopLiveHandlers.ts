import type { MutableRefObject } from "react";
import type { DesktopLiveHandlers } from "../../../features/connections/model/desktopLive";
import { isRemoteProjectPath, sameProjectPath } from "../../../features/projects/model/recents";
import { getSession } from "../../../features/sessions/data/sessionStore";
import { sessionsRef } from "../../../features/sessions/model/sessionsStore";
import { noteRemoteActivity } from "../../../features/sessions/model/remoteActivityNotice";
import {
  approvalRequestDispatchStarted,
  captureApprovalRequest,
} from "../../../features/sessions/model/approvalIntents";
import { orchestrator } from "../../../features/orchestration/model/orchestration";
import type { useHistorySessionDelete } from "../sessions/useHistorySessionDelete";

export interface DesktopLiveHandlersDeps {
  desktopLiveHandlers: MutableRefObject<DesktopLiveHandlers>;
  onDeleteHistorySessionNow: ReturnType<
    typeof useHistorySessionDelete
  >["onDeleteHistorySessionNow"];
  onStop: (sessionId: string, managed?: boolean, current?: () => boolean) => void;
  onApproval: DesktopLiveHandlers["approve"];
  onQuestionReply: DesktopLiveHandlers["answer"];
}

/** Assigns the desktop live-channel handler table on every render; the table closes over workspace state. */
export function useDesktopLiveHandlers({
  desktopLiveHandlers,
  onDeleteHistorySessionNow,
  onStop,
  onApproval,
  onQuestionReply,
}: DesktopLiveHandlersDeps): void {
  desktopLiveHandlers.current = {
    delete: async (sessionId, cwd, requestedBy) => {
      const stored = await getSession(sessionId);
      const open = sessionsRef.current.find((session) => session.id === sessionId);
      if (!stored || isRemoteProjectPath(stored.cwd) || !sameProjectPath(stored.cwd, cwd))
        throw new Error("Session does not belong to this local project");
      if (stored.busy || open?.busy || orchestrator.forSession(sessionId)?.status === "active")
        throw new Error("Stop this session before deleting it");
      let deleted = false;
      try {
        deleted = await onDeleteHistorySessionNow(sessionId, true);
      } finally {
        // Another device asked for this: say so here too, not only on that device.
        noteRemoteActivity({ scope: { cwd }, kind: "deleted", device: requestedBy, ok: deleted });
      }
      if (!deleted) throw new Error("The conversation could not be deleted");
    },
    stop: (sessionId, current) => onStop(sessionId, false, current),
    captureApproval: captureApprovalRequest,
    approvalDispatchStarted: approvalRequestDispatchStarted,
    approve: onApproval,
    answer: onQuestionReply,
  };
}
