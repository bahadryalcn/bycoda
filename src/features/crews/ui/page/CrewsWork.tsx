import type { ReactNode } from "react";
import type { BackgroundSessionTarget } from "../../../tasks";
import type { useProjectCrews } from "../../model/crewClient";
import { CrewWorkManager, type OpenCrewSession } from "../CrewWorkManager";

/** The Work tab: the one place to read and manage a crew's work. */
export function CrewsWork({
  cwd,
  state,
  definitionId,
  initialRunId,
  onOpenSession,
  onCrewChange,
  renderCoordinator,
}: {
  cwd: string;
  state: ReturnType<typeof useProjectCrews>;
  definitionId?: string;
  initialRunId?: string;
  onOpenSession?: OpenCrewSession;
  onCrewChange?: (crewId: string | undefined) => void;
  renderCoordinator?: (target: BackgroundSessionTarget) => ReactNode;
}) {
  return (
    <CrewWorkManager
      cwd={cwd}
      state={state}
      definitionId={definitionId}
      initialRunId={initialRunId}
      onOpen={onOpenSession}
      onCrewChange={onCrewChange}
      renderCoordinator={renderCoordinator}
    />
  );
}
