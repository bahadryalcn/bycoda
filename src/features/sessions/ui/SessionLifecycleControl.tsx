import { presentRemoteError } from "../../connections/public/remoteFailure";
import { useState, type ReactNode } from "react";
import { useT } from "../../../shared/i18n";
import { toast } from "../../../shared/ui/ToastRegion";
import type { ExpandingButtonGroupItem } from "../../../shared/ui/ButtonGroup";
import { CheckCheck, Link2, Undo2 } from "../../../shared/ui/icons";
import { remoteRequest } from "../../connections/public/connections";
import { readMachineAvailability } from "../../connections/public/machineAvailability";
import { isProjectLocked } from "../../group-lock/public/projectLock";
import { useLocalLifecycleMachine } from "../hooks/useLocalLifecycleMachine";
import { useRemoteSessionLifecycleLists, useSessionLifecycle } from "../hooks/useSessionLifecycle";
import { sessionLifecycleClient, setSessionLifecycle } from "../model/sessionLifecycleClient";
import { isSettledSession } from "../model/sessionLifecycle";
import { SessionTaskLinkDialog, type LinkableTask } from "./SessionTaskLinkDialog";

type LinkDialog = { tasks: LinkableTask[]; linkedTaskId?: string };

const folderName = (cwd: string) => cwd.split(/[/]/).filter(Boolean).pop() ?? "";

export type SessionLifecycleActions = {
  /** Settle, Un-settle or Cancel settle: a frequent header button. */
  settle: ExpandingButtonGroupItem | null;
  /** Link to a task: an occasional action for the overflow menu. */
  link: ExpandingButtonGroupItem | null;
  /** The task link dialog while it is open. */
  dialog: ReactNode;
};

export type RemoteLifecycleTarget = {
  machineId: string;
  sessionId: string;
  projectKey: string;
  lastActivityAt?: number;
};

/**
 * Settle follows the session's owning Host. The local header also offers task linking.
 */
export function useSessionLifecycleActions({
  sessionId,
  cwd,
  local,
  hasMessages,
  running = false,
  remoteTarget,
}: {
  sessionId: string;
  cwd: string;
  local: boolean;
  hasMessages: boolean;
  running?: boolean;
  remoteTarget?: RemoteLifecycleTarget;
}): SessionLifecycleActions {
  const t = useT();
  const localMachineId = useLocalLifecycleMachine();
  const localView = useSessionLifecycle(sessionId, local);
  const remote = useRemoteSessionLifecycleLists(
    remoteTarget ? JSON.stringify([remoteTarget.machineId]) : "",
  );
  const [dialog, setDialog] = useState<LinkDialog>();
  const machineId = remoteTarget?.machineId ?? localMachineId;
  const remoteViews = remoteTarget && remote.lists.get(remoteTarget.machineId);
  const view = remoteTarget ? remoteViews?.get(remoteTarget.sessionId) : localView;
  if (!machineId || (remoteTarget ? !remoteViews : !localView))
    return { settle: null, link: null, dialog: null };
  const report = (cause: unknown) =>
    toast.show({
      tone: "danger",
      message:
        cause instanceof Error
          ? presentRemoteError(cause, { explicit: true })
          : t("Could not update the session."),
    });
  // A pending settle is withdrawn the same way a settled session comes back.
  const settled =
    view?.state === "settling" || isSettledSession(view, remoteTarget?.lastActivityAt);
  const label =
    view?.state === "settling" ? t("Cancel settle") : settled ? t("Un-settle") : t("Settle");
  const Icon = settled ? Undo2 : CheckCheck;
  return {
    settle: {
      id: "settle",
      label,
      icon: <Icon aria-hidden className="icon-sm" strokeWidth={1.75} />,
      disabled: !hasMessages && !settled,
      onSelect: () => {
        const checkOwner = () => {
          if (isProjectLocked(remoteTarget?.projectKey ?? cwd))
            throw new Error("Project is locked.");
          if (remoteTarget && !readMachineAvailability(remoteTarget.projectKey).available)
            throw new Error(t("Connect this project’s machine to load its sessions."));
        };
        try {
          checkOwner();
        } catch (cause) {
          report(cause);
          return;
        }
        (remoteTarget
          ? remote.change(machineId, remoteTarget.sessionId, settled, running, checkOwner)
          : (settled
              ? sessionLifecycleClient(machineId, true, checkOwner).unsettle(sessionId)
              : sessionLifecycleClient(machineId, true, checkOwner).settle(sessionId, running)
            ).then(setSessionLifecycle)
        ).catch(report);
      },
    },
    link: remoteTarget
      ? null
      : {
          id: "link-task",
          label: t("Link to a task"),
          icon: <Link2 aria-hidden className="icon-sm" strokeWidth={1.75} />,
          onSelect: () => {
            Promise.all([
              remoteRequest<LinkableTask[]>(machineId, "tasks.list", {}),
              sessionLifecycleClient(machineId).taskFor(sessionId),
            ]).then(
              ([tasks, linkedTaskId]) =>
                setDialog({
                  tasks: tasks.map(({ id, title }) => ({ id, title })),
                  ...(linkedTaskId ? { linkedTaskId } : {}),
                }),
              report,
            );
          },
        },
    dialog:
      dialog && !remoteTarget ? (
        <SessionTaskLinkDialog
          sessionTitle={folderName(cwd)}
          tasks={dialog.tasks}
          linkedTaskId={dialog.linkedTaskId}
          onClose={() => setDialog(undefined)}
          onLink={async (taskId) =>
            void (await sessionLifecycleClient(machineId).link(sessionId, taskId))
          }
          onUnlink={async () => void (await sessionLifecycleClient(machineId).unlink(sessionId))}
        />
      ) : null,
  };
}
