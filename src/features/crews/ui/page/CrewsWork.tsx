import type { ReactNode } from "react";
import type { BackgroundSessionTarget } from "../../../tasks";
import type { useProjectCrews } from "../../model/crewClient";
import type { OpenCrewSession } from "../CrewDialogHost";
import { CrewWorkManager } from "../CrewWorkManager";

/** The Work tab: the same work manager as the Crew work dialog, embedded in the page. */
export function CrewsWork({
  cwd,
  state,
  definitionId,
  initialRunId,
  onOpenSession,
  renderCoordinator,
}: {
  cwd: string;
  state: ReturnType<typeof useProjectCrews>;
  definitionId?: string;
  initialRunId?: string;
  onOpenSession?: OpenCrewSession;
  renderCoordinator?: (target: BackgroundSessionTarget) => ReactNode;
}) {
  return (
    <CrewWorkManager
      layout="page"
      cwd={cwd}
      state={state}
      definitionId={definitionId}
      initialRunId={initialRunId}
      onOpen={onOpenSession}
      renderCoordinator={renderCoordinator}
    />
  );
}
