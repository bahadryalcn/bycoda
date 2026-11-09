import { memo, useSyncExternalStore } from "react";
import { loadCrewSceneEnabled, subscribeCrewSceneEnabled } from "../../settings/public/settings";
import { CrewScene } from "./crewSurface";
import "./BycodaSession.css";
import type { Session } from "../model/session";

/** Whether the session's latest assistant reply is still streaming in. */
export function isReplyStreaming(session?: Session): boolean {
  const last = session?.blocks[session.blocks.length - 1];
  return !!session?.busy && last?.role === "assistant" && !!last.streaming;
}

/** Kept outside transcript scrolling so the gathering stays behind the work.
 * Memoized: the pane passes a session that keeps its identity across streamed text. */
export const CrewBackdrop = memo(function CrewBackdrop({
  visible = true,
  session,
}: {
  visible?: boolean;
  session?: Session;
}) {
  const enabled = useSyncExternalStore(subscribeCrewSceneEnabled, loadCrewSceneEnabled, () => true);
  if (!visible || !enabled) return null;
  return (
    <CrewScene
      sessionId={session?.id}
      session={session}
      paused={isReplyStreaming(session)}
      variant="background"
      className="bycoda-session-backdrop"
    />
  );
});
