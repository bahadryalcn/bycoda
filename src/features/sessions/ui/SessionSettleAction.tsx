import { useState } from "react";
import { useT } from "../../../shared/i18n";
import { InlineAction } from "../../../shared/ui/ActionHost";
import { toast } from "../../../shared/ui/ToastRegion";
import { CheckCheck, Undo2 } from "../../../shared/ui/icons";
import type { SessionSummary } from "../data/sessionStore";
import { useLocalLifecycleMachine } from "../hooks/useLocalLifecycleMachine";
import { isSettledSession } from "../model/sessionLifecycle";
import {
  sessionLifecycleClient,
  setSessionLifecycle,
  useSessionLifecycleSupported,
  useSessionLifecycleView,
} from "../model/sessionLifecycleClient";

/**
 * Sidebar row action that settles a session of this computer's Host or brings it back, the same
 * request as the session header's Settle control. Nothing renders before the Host's lifecycle list
 * arrived (another machine, or a Host without settle support).
 */
export function SessionSettleAction({
  session,
  title,
}: {
  session: Pick<SessionSummary, "id" | "lastActivityAt">;
  title: string;
}) {
  const t = useT();
  const machineId = useLocalLifecycleMachine();
  const supported = useSessionLifecycleSupported();
  const view = useSessionLifecycleView(session.id);
  const [busy, setBusy] = useState(false);
  if (!machineId || !supported) return null;
  // A pending settle is withdrawn the same way a settled session comes back.
  const settled = view?.state === "settling" || isSettledSession(view, session.lastActivityAt);
  const label =
    view?.state === "settling" ? t("Cancel settle") : settled ? t("Un-settle") : t("Settle");
  const Icon = settled ? Undo2 : CheckCheck;
  return (
    <InlineAction
      label={`${label} ${title}`}
      tooltip={label}
      tooltipDetails={[title]}
      motion="none"
      type="button"
      data-no-drag
      data-tauri-drag-region="false"
      loading={busy}
      onClick={() => {
        const client = sessionLifecycleClient(machineId);
        setBusy(true);
        (settled ? client.unsettle(session.id) : client.settle(session.id))
          .then(setSessionLifecycle)
          .catch((cause: unknown) =>
            toast.show({
              tone: "danger",
              message: cause instanceof Error ? cause.message : t("Could not update the session."),
            }),
          )
          .finally(() => setBusy(false));
      }}
    >
      <Icon aria-hidden className="icon-xs shrink-0" strokeWidth={1.75} />
    </InlineAction>
  );
}
