import { useRef, type MutableRefObject } from "react";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { t } from "../../../shared/i18n";
import { toast } from "../../../shared/ui/ToastRegion";
import {
  loadRemoteCapabilities,
  remoteSessionFor,
} from "../../../features/connections/model/connections";
import { PROJECTLESS_SESSIONS_CAPABILITY } from "../../../shared/model/host-contracts/projectless-sessions";
import { remoteCreateIntent } from "../../../features/connections/model/remoteCreateIntent";
import { readDurableRemoteCommand } from "../../../features/connections/model/remoteOutbox";
import { parseRemotePath } from "../../../features/connections/model/remoteProjects";
import { hostSessionBinding } from "../../../features/connections/model/sessionExecutionBinding";
import {
  remoteExecutionEnvironment,
  remoteSessionProjectKey,
} from "../../../features/connections/model/sessionMachineTarget";
import { withRoomPrivacyMutation } from "../../../features/group-lock/model/roomPrivacyProjection";
import { isBlankSession } from "../../../features/projects/model/projectReturn";
import { hasActiveSubmit } from "../../../features/sessions/model/activeSubmits";
import { newDefaultSession, type Session } from "../../../features/sessions/model/session";
import { setSessions } from "../../../features/sessions/model/sessionsStore";
import { isSendStarting } from "../sessions/submit/submitStarting";
import type { useWorkspaceDirectoryActions } from "./useWorkspaceDirectoryActions";

function canRetarget(session: Session): boolean {
  return (
    isBlankSession(session) &&
    !session.inboxAsk &&
    !session.providerSessionId &&
    !session.historyLoading &&
    !session.historyPartial &&
    !session.worktreePreparing &&
    !session.queuedMessages?.length &&
    !hostSessionBinding(session) &&
    !remoteSessionFor(session.id) &&
    !remoteCreateIntent(session.id) &&
    !hasActiveSubmit(session.id) &&
    !isSendStarting(session.id)
  );
}

export function useSessionMachineActions({
  sessionsRef,
  onCwdChange,
  chooseProject,
}: {
  sessionsRef: MutableRefObject<Session[]>;
  onCwdChange: ReturnType<typeof useWorkspaceDirectoryActions>["onCwdChange"];
  /** The folder to work in on that machine, given the folder the session is in now. */
  chooseProject?: (environmentId: string | undefined, cwd: string) => Promise<string | undefined>;
}) {
  const pendingChoices = useRef(new Map<string, symbol>());
  return useStableCallback((sessionId: string, environmentId: string | undefined) => {
    const source = sessionsRef.current.find((session) => session.id === sessionId);
    if (!source || !canRetarget(source)) return;
    pendingChoices.current.delete(sessionId);
    const originalEnvironment = remoteExecutionEnvironment(source);
    if (originalEnvironment === environmentId) return;
    const choice = Symbol();
    pendingChoices.current.set(sessionId, choice);
    const stillCurrent = () => {
      const current = sessionsRef.current.find((session) => session.id === sessionId);
      return (
        current &&
        pendingChoices.current.get(sessionId) === choice &&
        current.cwd === source.cwd &&
        remoteExecutionEnvironment(current) === originalEnvironment &&
        canRetarget(current)
      );
    };
    const change = async () => {
      if (source.cwd === "~" && environmentId) {
        const capabilities = await loadRemoteCapabilities(environmentId);
        if (!stillCurrent()) return;
        if (capabilities && !capabilities.includes(PROJECTLESS_SESSIONS_CAPABILITY)) {
          toast.show({
            tone: "warning",
            message: t(
              "This host cannot start sessions without a project. Update it and try again.",
            ),
          });
          return;
        }
      }
      const cwd = source.cwd === "~" ? "~" : await chooseProject?.(environmentId, source.cwd);
      if (!cwd || !stillCurrent()) return;
      if (cwd !== "~" && parseRemotePath(cwd)?.environmentId !== environmentId)
        throw new Error("The folder belongs to a different machine");
      if (originalEnvironment) {
        const pending = await readDurableRemoteCommand(
          remoteSessionProjectKey(source),
          originalEnvironment,
          null,
          source.id,
        );
        if (pending.command)
          throw new Error("The original machine still owns an unfinished request");
      }
      await withRoomPrivacyMutation((token) => {
        if (!stillCurrent()) return;
        if (cwd !== "~") {
          onCwdChange(sessionId, cwd, token);
          return;
        }
        setSessions((sessions) =>
          sessions.map((session) => {
            if (session.id !== sessionId) return session;
            const { harness, model, modelSettings, providerAccountId } = newDefaultSession(
              "~",
              session.runtimeMode,
            );
            return {
              ...session,
              harness,
              model,
              modelSettings,
              providerAccountId: environmentId ? undefined : providerAccountId,
              scratchWorkspace: true,
              remoteExecutionEnvironmentId: environmentId,
            };
          }),
        );
      });
    };
    void change()
      .finally(() => {
        if (pendingChoices.current.get(sessionId) === choice)
          pendingChoices.current.delete(sessionId);
      })
      .catch(() =>
        toast.show({ tone: "warning", message: t("Couldn’t change the session machine.") }),
      );
  });
}
