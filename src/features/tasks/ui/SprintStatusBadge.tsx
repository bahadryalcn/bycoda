import { useLocale } from "../../../shared/i18n";
import { StatusText, type StatusTextTone } from "../../../shared/ui/StatusText";
import type { HostSprint } from "../model/hostSprints";
import { sprintStateLabel } from "../model/statusLabels";

const STATE_TONE: Record<HostSprint["state"], StatusTextTone> = {
  planned: "idle",
  active: "running",
  completed: "done",
  archived: "idle",
};

/** One status vocabulary for the sprint list, header and reports: a labelled status, never colour alone. */
export function SprintStatusBadge({ state }: { state: HostSprint["state"] }) {
  useLocale();
  const label = sprintStateLabel(state);
  return (
    <StatusText tone={STATE_TONE[state]} data-sprint-state={state}>
      {label}
    </StatusText>
  );
}
