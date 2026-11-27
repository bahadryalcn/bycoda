import { presentRemoteError } from "../../connections/public/remoteFailure";
import { useT } from "../../../shared/i18n";
import { invoke } from "@tauri-apps/api/core";
import { InlineAction } from "../../../shared/ui/ActionHost";
import { toast } from "../../../shared/ui/ToastRegion";
import { CheckCheck, Undo2 } from "../../../shared/ui/icons";
import { isProjectLocked } from "../../group-lock/public/projectLock";
import type { SessionSummary } from "../data/sessionStore";
import { useLocalLifecycleMachine } from "../hooks/useLocalLifecycleMachine";
import { isSettledSession } from "../model/sessionLifecycle";
import {
  sessionLifecycleClient,
  setSessionLifecycle,
  useSessionLifecycleSupported,
  useSessionLifecycleView,
} from "../model/sessionLifecycleClient";

export function useSessionSettleCommand(
  session: Pick<SessionSummary, "id" | "lastActivityAt"> & { cwd?: string },
  running = false,
) {
  const t = useT();
  const machineId = useLocalLifecycleMachine();
  const supported = useSessionLifecycleSupported();
  const view = useSessionLifecycleView(session.id);
  const settled = view?.state === "settling" || isSettledSession(view, session.lastActivityAt);
  return {
    available: Boolean(machineId && supported),
    settled,
    label: view?.state === "settling" ? t("Cancel settle") : settled ? t("Un-settle") : t("Settle"),
    run: async () => {
      if (session.cwd && isProjectLocked(session.cwd)) return;
      const target =
        machineId ??
        (await invoke<{ id: string } | null>("local_host_connect").catch(() => null))?.id;
      if (!target) {
        toast.show({
          tone: "warning",
          message: t("The local Host is unavailable. Reconnect and retry."),
        });
        return;
      }
      const client = sessionLifecycleClient(target, true, () => {
        if (session.cwd && isProjectLocked(session.cwd)) throw new Error("Project is locked.");
      });
      const request = settled ? client.unsettle(session.id) : client.settle(session.id, running);
      await request.then(setSessionLifecycle).catch((cause: unknown) => {
        toast.show({
          tone: "danger",
          message:
            cause instanceof Error
              ? presentRemoteError(cause, { explicit: true })
              : t("Could not update the session."),
        });
      });
    },
  };
}

/**
 * Sidebar row action that settles a session of this computer's Host or brings it back, the same
 * request as the session header's Settle control. Nothing renders before the Host's lifecycle list
 * arrived (another machine, or a Host without settle support).
 */
export function SessionSettleAction({
  session,
  title,
  running,
}: {
  session: Pick<SessionSummary, "id" | "cwd" | "lastActivityAt">;
  title: string;
  running: boolean;
}) {
  const command = useSessionSettleCommand(session, running);
  return command.available ? <SessionSettleButton command={command} title={title} /> : null;
}

export type SessionSettleCommand = Pick<
  ReturnType<typeof useSessionSettleCommand>,
  "settled" | "label" | "run"
>;

export function SessionSettleButton({
  command: { settled, label, run },
  title,
}: {
  command: SessionSettleCommand;
  title: string;
}) {
  const Icon = settled ? Undo2 : CheckCheck;
  return (
    <InlineAction
      label={`${label} ${title}`}
      tooltip={label}
      motion="none"
      type="button"
      data-no-drag
      data-tauri-drag-region="false"
      onClick={() => void run().catch(() => {})}
    >
      <Icon aria-hidden className="icon-xs shrink-0" strokeWidth={1.75} />
    </InlineAction>
  );
}
