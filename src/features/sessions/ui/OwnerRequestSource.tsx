import { useT } from "../../../shared/i18n";
import { Text } from "../../../shared/ui/Text";
import { useSession } from "../model/sessionsStore";
import { sessionDisplayTitle } from "../model/session";
import { HarnessIcon } from "./HarnessIcon";
import { NotificationProjectLabel } from "./NotificationHistoryItem";

/**
 * Who asked an owner request: the project and conversation, or the project and the Assistant Room.
 * Renders nothing when the request names neither.
 */
export function OwnerRequestSource({
  sessionId,
  threadId,
  cwd,
  className = "",
}: {
  sessionId?: string;
  threadId?: string;
  cwd?: string;
  className?: string;
}) {
  const t = useT();
  const session = useSession(sessionId);
  const project = session?.cwd ?? cwd;
  const label = session
    ? sessionDisplayTitle(session.title, session.harness)
    : threadId
      ? t("Assistant")
      : undefined;
  if (!project && !label) return null;
  return (
    <span className={`notification-request-source flex min-w-0 items-center gap-2 ${className}`}>
      {project ? <NotificationProjectLabel cwd={project} /> : null}
      {project && label ? <span aria-hidden>·</span> : null}
      {session ? <HarnessIcon harness={session.harness} className="size-3.5 shrink-0" /> : null}
      {label ? (
        <Text as="span" size="inherit" tone="inherit" truncate className="min-w-0 flex-1">
          {label}
        </Text>
      ) : null}
    </span>
  );
}
