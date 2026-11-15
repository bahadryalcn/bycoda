import { useT } from "../../../shared/i18n";
import { StatusText, type StatusTextTone } from "../../../shared/ui/StatusText";
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
const TONES: Record<GoalStatus, StatusTextTone> = {
  planning: "running",
  "awaiting-approval": "needs-you",
  running: "running",
  done: "done",
  blocked: "failed",
  cancelled: "idle",
};

export function GoalStatusBadge({ status }: { status: GoalStatus }) {
  const t = useT();
  return (
    <StatusText
      tone={TONES[status]}
      className="shrink-0"
      icon={status === "running" ? <WorkingIndicator /> : undefined}
    >
      {t(LABELS[status])}
    </StatusText>
  );
}
