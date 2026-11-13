import type { Session } from "../model/session";
import { isSessionGoal, type SessionGoal } from "../model/providerGoal";
import { useT } from "../../../shared/i18n";
import { Badge, type BadgeTone } from "../../../shared/ui/Badge";
import { ClampText } from "../../../shared/ui/ClampText";
import { Heading } from "../../../shared/ui/Heading";

const GOAL_STATUS: Record<SessionGoal["status"], { label: string; tone: BadgeTone }> = {
  active: { label: "Active", tone: "accent" },
  paused: { label: "Paused", tone: "neutral" },
  blocked: { label: "Blocked", tone: "warning" },
  usageLimited: { label: "Usage limit reached", tone: "warning" },
  budgetLimited: { label: "Budget reached", tone: "warning" },
  complete: { label: "Completed", tone: "success" },
};

/** Show the last reported native state only for this exact conversation. */
export function SessionProviderGoal({
  session,
}: {
  session: Pick<Session, "harness" | "providerSessionId" | "providerGoal">;
}) {
  const t = useT();
  const goal = session.providerGoal;
  if (
    !isSessionGoal(goal) ||
    goal.provider !== session.harness ||
    goal.providerSessionId !== session.providerSessionId
  )
    return null;
  const status = GOAL_STATUS[goal.status];
  return (
    <div
      data-provider-goal={goal.status}
      className="min-h-0 max-h-[30%] shrink-0 overflow-y-auto px-3 py-2"
    >
      <div className="mb-1 flex min-w-0 flex-wrap items-center gap-2">
        <Heading size="caption">{t("Codex Goal")}</Heading>
        <Badge size="xs" tone={status.tone}>
          {t(status.label)}
        </Badge>
      </div>
      <ClampText
        key={`${goal.providerSessionId}:${goal.objective}`}
        lines={2}
        size="caption"
        tone="primary"
        wrap="anywhere"
      >
        {goal.objective}
      </ClampText>
    </div>
  );
}
