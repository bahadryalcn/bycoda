import { Text } from "../../../shared/ui/Text";
import { isUserConversation } from "../../../shared/model/host-contracts/delegation";
import { useT } from "../../../shared/i18n";
import { MonitorSmartphone } from "../../../shared/ui/icons";
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
 * Marks a conversation started from another device, so its requests are not mistaken for
 * local ones. A passive mark (no action); the tooltip adds what the icon cannot say.
 * @use Composer workspace row (`labelled`, beside the checkout and branch).
 */
export function RemoteOriginMark({
  origin,
  labelled = false,
}: {
  origin: "running" | "idle" | undefined;
  labelled?: boolean;
}) {
  const t = useT();
  if (!origin) return null;
  const running = origin === "running";
  const label = t(STARTED);
  return (
    <Tooltip label={label} details={running ? [t(RUNNING)] : undefined} asChild>
      <Text
        role="img"
        aria-label={running ? `${label}. ${t(RUNNING)}` : label}
        data-no-drag
        size="caption"
        tone="muted"
        className="inline-flex shrink-0 items-center gap-1"
      >
        <MonitorSmartphone aria-hidden className="icon-sm" strokeWidth={1.75} />
        {labelled ? <span aria-hidden>{t("Remote connection")}</span> : null}
        {running ? <WorkingIndicator size="xs" /> : null}
      </Text>
    </Tooltip>
  );
}
