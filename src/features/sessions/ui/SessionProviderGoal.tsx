import { useRef, useState } from "react";
import { HARNESS_TITLE, type Session } from "../model/session";
import { isSessionGoal, type SessionGoal } from "../model/providerGoal";
import { useFormat, useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Popover } from "../../../shared/ui/Popover";
import { InlineError } from "../../../shared/ui/InlineError";
import { Text, type TextTone } from "../../../shared/ui/Text";
import { CircleDot } from "../../../shared/ui/icons";

const GOAL_STATUS: Record<SessionGoal["status"], { label: string; tone: TextTone }> = {
  active: { label: "Pursuing goal", tone: "primary" },
  paused: { label: "Goal paused", tone: "secondary" },
  blocked: { label: "Goal blocked", tone: "warning" },
  usageLimited: { label: "Goal hit a usage limit", tone: "warning" },
  budgetLimited: { label: "Goal reached its token budget", tone: "warning" },
  complete: { label: "Goal complete", tone: "success" },
};

/** Native goal state and owner actions beside the current work, independent of the draft. */
export function SessionProviderGoal({
  session,
  onCommand,
  blockedReason,
}: {
  session: Pick<Session, "harness" | "providerSessionId" | "providerGoal" | "busy">;
  onCommand: (command: "/goal resume" | "/goal clear") => boolean | void;
  blockedReason?: string;
}) {
  const t = useT();
  const format = useFormat();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const goal = session.providerGoal;
  if (
    !isSessionGoal(goal) ||
    goal.provider !== session.harness ||
    goal.providerSessionId !== session.providerSessionId
  )
    return null;
  const status = GOAL_STATUS[goal.status];
  const usage: string[] = [];
  if (goal.tokensUsed !== undefined && goal.tokensUsed > 0) {
    usage.push(
      goal.tokenBudget == null
        ? t("{p0} tokens", { p0: format.formatNumber(goal.tokensUsed) })
        : t("{p0} / {p1} tokens", {
            p0: format.formatNumber(goal.tokensUsed),
            p1: format.formatNumber(goal.tokenBudget),
          }),
    );
  }
  if (goal.timeUsedSeconds !== undefined && goal.timeUsedSeconds >= 60)
    usage.push(format.formatDuration(goal.timeUsedSeconds * 1000));
  const disabledReason =
    blockedReason ||
    (session.busy ? t("Wait for the current work to finish before changing the goal.") : undefined);
  const run = (command: "/goal resume" | "/goal clear") => {
    if (disabledReason) return;
    try {
      setFailed(onCommand(command) === false);
    } catch {
      setFailed(true);
    }
  };
  return (
    <>
      <Button
        ref={anchor}
        data-provider-goal={goal.status}
        className="ms-auto"
        variant="ghost"
        size="xs"
        expanded={open}
        opens="up"
        aria-haspopup="dialog"
        aria-label={t(status.label)}
        startIcon={<CircleDot className="icon-sm" aria-hidden />}
        onClick={() => setOpen(!open)}
      >
        {t(goal.status === "active" ? "Goal" : status.label)}
      </Button>
      {open ? (
        <Popover
          anchor={anchor}
          side="top"
          align="end"
          width={356}
          kind="dialog"
          solid
          aria-label={t("Goal")}
          onDismiss={() => setOpen(false)}
        >
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <Text
                as="span"
                size="caption"
                weight="medium"
                tone={status.tone}
                className="flex items-center gap-2"
              >
                <CircleDot className="icon-sm shrink-0" aria-hidden />
                {t(status.label)}
              </Text>
              {usage.length ? (
                <Text as="span" size="caption" tone="muted">
                  {usage.join(" · ")}
                </Text>
              ) : null}
            </div>
            <Text size="caption" tone="secondary" wrap="anywhere">
              {goal.objective}
            </Text>
            <div className="flex flex-wrap justify-end gap-1">
              {goal.status !== "active" && goal.status !== "complete" && !session.busy ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!!disabledReason}
                  disabledReason={disabledReason}
                  onClick={() => run("/goal resume")}
                >
                  {t("Resume goal")}
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                disabled={!!disabledReason}
                disabledReason={disabledReason}
                onClick={() => run("/goal clear")}
              >
                {t("Clear goal")}
              </Button>
            </div>
            {goal.status === "blocked" ? (
              <Text size="caption" tone="muted">
                {t("{p0} did not provide a reason for this goal's blocked state.", {
                  p0: HARNESS_TITLE[session.harness],
                })}
              </Text>
            ) : null}
            {failed ? (
              <InlineError>
                {t("Goal action was not sent. Try again when the conversation is ready.")}
              </InlineError>
            ) : null}
          </div>
        </Popover>
      ) : null}
    </>
  );
}
