import { useLocale } from "../../../shared/i18n";
import { StatusText, type StatusTextTone } from "../../../shared/ui/StatusText";
import { WorkingIndicator } from "../../../shared/ui/WorkingIndicator";
import type { GoalStatus } from "../model/hostGoals";
import { goalStatusLabel } from "../model/statusLabels";

const TONES: Record<GoalStatus, StatusTextTone> = {
  planning: "running",
  "awaiting-approval": "needs-you",
  running: "running",
  done: "done",
  blocked: "failed",
  cancelled: "idle",
};

export function GoalStatusBadge({ status }: { status: GoalStatus }) {
  useLocale();
  return (
    <StatusText
      tone={TONES[status]}
      className="shrink-0"
      icon={status === "running" ? <WorkingIndicator /> : undefined}
    >
      {goalStatusLabel(status)}
    </StatusText>
  );
}
