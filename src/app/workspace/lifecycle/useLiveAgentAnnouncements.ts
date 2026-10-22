import { useEffect } from "react";
import type { useRemoteRailProjects } from "../bridges/useRemoteRailProjects";
import { listenForWindowLiveAgent } from "../../model/useWindowLiveAgents";
import { announceSessionIssue } from "../../../features/notifications/model/notifications";
import { newSession } from "../../../features/sessions/model/session";

export interface LiveAgentAnnouncementDeps {
  onOpenApprovalSession: (sessionId: string) => void;
  unopenedRemote: ReturnType<typeof useRemoteRailProjects>["unopenedRemote"];
}

/** Window live-agent listener, and announcements for remote sessions that are not open in this window. */
export function useLiveAgentAnnouncements({
  onOpenApprovalSession,
  unopenedRemote,
}: LiveAgentAnnouncementDeps): void {
  useEffect(() => {
    let disposed = false;
    let release: (() => void) | undefined;
    void listenForWindowLiveAgent(onOpenApprovalSession)
      .then((unlisten) => {
        if (disposed) unlisten();
        else release = unlisten;
      })
      .catch((error) => {
        console.warn("App operation failed", error);
      });
    return () => {
      disposed = true;
      release?.();
    };
  }, [onOpenApprovalSession]);

  // Sessions for the rail's "Last sessions". Kept referentially stable so the
  // rail only refetches when a title or status really changed.
  useEffect(() => {
    for (const { session: host, project, fresh } of unopenedRemote) {
      if (!fresh || !host.issue) continue;
      const session = {
        ...newSession(host.harness, project),
        id: host.id,
        title: host.title,
        busy: host.status === "running",
        retryMessage: host.issue === "retrying" ? host.issueMessage || "Retrying" : undefined,
      };
      session.blocks = [{ id: host.issueTurnId || host.runId || host.id, role: "user", text: "" }];
      if (host.issue === "failed")
        session.blocks.push({
          id: "issue",
          role: "system",
          notice: "error",
          text: host.issueMessage || "Failed",
        });
      void announceSessionIssue(session, host.issue, false);
    }
  }, [unopenedRemote]);
}
