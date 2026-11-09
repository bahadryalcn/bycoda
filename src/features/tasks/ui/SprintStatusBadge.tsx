import { useT } from "../../../shared/i18n";
import { Badge, type BadgeTone } from "../../../shared/ui/Badge";
import type { HostSprint } from "../model/hostSprints";

const STATE_TONE: Record<HostSprint["state"], BadgeTone> = {
  planned: "neutral",
  active: "accent",
  completed: "success",
  archived: "neutral",
};

/** One status vocabulary for the sprint list, header and reports: a labelled badge, never colour alone. */
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
    <Badge tone={STATE_TONE[state]} size="xs" data-sprint-state={state}>
      {label}
    </Badge>
  );
}
