import { useSyncExternalStore } from "react";
import { loadCrewSceneEnabled, subscribeCrewSceneEnabled } from "../../settings/model/settings";
import { CrewScene } from "./crewSurface";
import "./BycodaSession.css";
import type { Session } from "../model/session";

/** Kept outside transcript scrolling so the gathering stays behind the work. */
export function CrewBackdrop({
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
      variant="background"
      className="bycoda-session-backdrop"
    />
  );
}
