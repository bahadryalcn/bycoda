import { useT } from "../../../shared/i18n";
import { StatusText, type StatusTextTone } from "../../../shared/ui/StatusText";
import type { HostSprint } from "../model/hostSprints";

const STATE_TONE: Record<HostSprint["state"], StatusTextTone> = {
  planned: "idle",
  active: "running",
  completed: "done",
  archived: "idle",
};

/** One status vocabulary for the sprint list, header and reports: a labelled status, never colour alone. */
export function SprintStatusBadge({ state }: { state: HostSprint["state"] }) {
  const t = useT();
  const label = t(
    {
      planned: "Planned",
      active: "Active",
      completed: "Completed",
      archived: "Archived",
    }[state],
  );
  return (
    <StatusText tone={STATE_TONE[state]} data-sprint-state={state}>
      {label}
    </StatusText>
  );
}
