import { useShellSessions } from "../../../features/sessions/model/sessionsStore";
import { useKeepAwake } from "../../../features/settings/model/keepAwake";
import { useInputNotifications } from "../../../features/notifications/hooks/useInputNotifications";
import { useAttentionNotifications } from "../../../features/notifications/hooks/useAttentionNotifications";

/**
 * Effect-only bridges that read every session (keep-awake, input and attention
 * notifications). They render nothing, so owning the shell subscription here
 * keeps a status, tool or approval change from re-rendering the root `App`.
 */
export function SessionNotificationBridges({
  activeSessionId,
}: {
  activeSessionId: string | undefined;
}) {
  const sessions = useShellSessions();
  useKeepAwake(sessions);
  useInputNotifications(sessions, activeSessionId);
  useAttentionNotifications(sessions, activeSessionId);
  return null;
}
