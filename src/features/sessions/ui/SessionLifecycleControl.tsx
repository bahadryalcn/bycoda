import { useState } from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { toast } from "../../../shared/ui/ToastRegion";
import { CheckCheck, Link2, Undo2 } from "../../../shared/ui/icons";
import { remoteRequest } from "../../connections/public/connections";
import { useLocalLifecycleMachine } from "../hooks/useLocalLifecycleMachine";
import { useSessionLifecycle } from "../hooks/useSessionLifecycle";
import { sessionLifecycleClient, setSessionLifecycle } from "../model/sessionLifecycleClient";
import { SessionTaskLinkDialog, type LinkableTask } from "./SessionTaskLinkDialog";

type LinkDialog = { tasks: LinkableTask[]; linkedTaskId?: string };

const folderName = (cwd: string) => cwd.split(/[/]/).filter(Boolean).pop() ?? "";

/**
 * Header actions of a session on this computer's Host: Settle or Un-settle, and Link to a task.
 * Settling only files the session on the sidebar's Settled shelf; it stays writable and its next
 * message makes it active again. Nothing renders for other Hosts or a Host without settle support.
 */
export function SessionLifecycleControl({
  sessionId,
  cwd,
  local,
  hasMessages,
}: {
  sessionId: string;
  cwd: string;
  local: boolean;
  hasMessages: boolean;
}) {
  const t = useT();
  const machineId = useLocalLifecycleMachine();
  const view = useSessionLifecycle(sessionId, local);
  const [dialog, setDialog] = useState<LinkDialog>();
  const [busy, setBusy] = useState(false);
  if (!machineId || !view) return null;
  const client = sessionLifecycleClient(machineId);
  const report = (cause: unknown) =>
    toast.show({
      tone: "danger",
      message: cause instanceof Error ? cause.message : t("Could not update the session."),
    });
  // A pending settle is withdrawn the same way a settled session comes back.
  const settled = view.state !== "active";
  const label =
    view.state === "settling" ? t("Cancel settle") : settled ? t("Un-settle") : t("Settle");
  const Icon = settled ? Undo2 : CheckCheck;
  return (
    <>
      <Button
        variant="ghost"
        iconOnly
        label={label}
        loading={busy}
        disabled={!hasMessages && !settled}
        onClick={() => {
          setBusy(true);
          (settled ? client.unsettle(sessionId) : client.settle(sessionId))
            .then(setSessionLifecycle)
            .catch(report)
            .finally(() => setBusy(false));
        }}
      >
        <Icon aria-hidden className="icon-sm" strokeWidth={1.75} />
      </Button>
      <Button
        variant="ghost"
        iconOnly
        label={t("Link to a task")}
        onClick={() => {
          Promise.all([
            remoteRequest<LinkableTask[]>(machineId, "tasks.list", {}),
            client.taskFor(sessionId),
          ]).then(
            ([tasks, linkedTaskId]) =>
              setDialog({
                tasks: tasks.map(({ id, title }) => ({ id, title })),
                ...(linkedTaskId ? { linkedTaskId } : {}),
              }),
            report,
          );
        }}
      >
        <Link2 aria-hidden className="icon-sm" strokeWidth={1.75} />
      </Button>
      {dialog ? (
        <SessionTaskLinkDialog
          sessionTitle={folderName(cwd)}
          tasks={dialog.tasks}
          linkedTaskId={dialog.linkedTaskId}
          onClose={() => setDialog(undefined)}
          onLink={async (taskId) => void (await client.link(sessionId, taskId))}
          onUnlink={async () => void (await client.unlink(sessionId))}
        />
      ) : null}
    </>
  );
}
