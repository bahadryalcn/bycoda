import type { ReactNode } from "react";
import { Text } from "../../../shared/ui/Text";
import { isUserConversation } from "../../../shared/model/host-contracts/delegation";
import { useT } from "../../../shared/i18n";
import { Laptop, MonitorSmartphone } from "../../../shared/ui/icons";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { WorkingIndicator } from "../../../shared/ui/WorkingIndicator";
import type { Session } from "../model/session";

const STARTED = "Started from a remote connection";
const RUNNING =
  "This conversation is running in the background on this computer. New messages appear automatically.";

/** Where a conversation came from: `running` while this computer's host is still answering a
 * remote request, `idle` once it settled, undefined for one started here (and for delegated work). */
export function remoteOrigin(session: Session): "running" | "idle" | undefined {
  if (!isUserConversation(session)) return undefined;
  if (session.continuingElsewhere && !session.busy) return "running";
  return session.continuingElsewhere || session.adoptedBase ? "idle" : undefined;
}

/**
 * Shows where a remotely started conversation runs now, with its origin on hover and focus.
 * @use Composer workspace row in the machine slot.
 */
export function RemoteOriginMark({
  origin,
  children,
}: {
  origin: "running" | "idle";
  children?: ReactNode;
}) {
  const t = useT();
  const running = origin === "running";
  const location = t("This computer");
  const details = [t(STARTED), location];
  if (running) details.push(t(RUNNING));
  return (
    <Tooltip
      label={
        <span className="inline-flex items-center gap-1.5">
          <MonitorSmartphone className="icon-sm shrink-0" aria-hidden />
          {t("Connection history")}
        </span>
      }
      details={details}
      asChild
    >
      <Text
        as="div"
        tabIndex={children ? undefined : 0}
        data-no-drag
        className="inline-flex min-w-0 items-center gap-1.5"
      >
        {children ?? (
          <>
            <Laptop className="icon-xs" aria-hidden />
            {location}
          </>
        )}
        {running ? <WorkingIndicator size="xs" label={t(RUNNING)} /> : null}
      </Text>
    </Tooltip>
  );
}
