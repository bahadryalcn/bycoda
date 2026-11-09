import { useT } from "../../../shared/i18n";
import { Badge, type BadgeTone } from "../../../shared/ui/Badge";
import { Spinner } from "../../../shared/ui/Spinner";
import { WorkingIndicator } from "../../../shared/ui/WorkingIndicator";
import type { GoalStatus } from "../model/hostGoals";

const LABELS: Record<GoalStatus, string> = {
  planning: "Planning",
  "awaiting-approval": "Plan ready",
  running: "Running",
  done: "Done",
  blocked: "Blocked",
  cancelled: "Cancelled",
};
const TONES: Record<GoalStatus, BadgeTone> = {
  planning: "accent",
  "awaiting-approval": "warning",
  running: "accent",
  done: "success",
  blocked: "danger",
  cancelled: "neutral",
};

export function GoalStatusBadge({ status }: { status: GoalStatus }) {
  const t = useT();
  return (
    <Badge
      tone={TONES[status]}
      appearance="subtle"
      size="sm"
      className="shrink-0"
      icon={
        status === "planning" ? (
          <Spinner size="xs" />
        ) : status === "running" ? (
          <WorkingIndicator />
        ) : undefined
      }
    >
      {t(LABELS[status])}
    </Badge>
  );
}
