import { useRef, useState } from "react";
import { HARNESS_TITLE, type Session } from "../model/session";
import { isSessionGoal, type SessionGoal } from "../model/providerGoal";
import { useFormat, useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Popover } from "../../../shared/ui/Popover";
import { InlineError } from "../../../shared/ui/InlineError";
import { Text, type TextTone } from "../../../shared/ui/Text";
import { CircleDot, Pause, Play } from "../../../shared/ui/icons";

export type SessionProviderGoalCommand = "/goal pause" | "/goal resume" | "/goal clear";

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
  onCommand: (command: SessionProviderGoalCommand) => boolean | void;
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
  const active = goal.status === "active";
  const run = (command: SessionProviderGoalCommand) => {
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
        onClick={() => {
          setFailed(false);
          setOpen(!open);
        }}
      >
        {t(goal.status === "active" ? "Goal" : status.label)}
      </Button>
      {open ? (
        <Popover
          anchor={anchor}
          side="top"
          align="end"
          size="lg"
          kind="dialog"
          frosted
          flow="scroll"
          aria-label={t("Goal")}
          initialFocus="[data-goal-toggle]"
          onDismiss={() => setOpen(false)}
          className="flex min-w-0 flex-col gap-3 p-3"
        >
          <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1">
            <CircleDot className="icon-sm" aria-hidden />
            <Text as="span" size="caption" weight="medium" tone={status.tone} wrap="anywhere">
              {t(status.label)}
            </Text>
            {usage.length ? (
              <Text as="span" size="caption" tone="secondary" className="col-start-2 tabular-nums">
                {usage.join(" · ")}
              </Text>
            ) : null}
          </div>
          <Text size="secondary" tone="secondary" leading="relaxed" wrap="anywhere">
            {goal.objective}
          </Text>
          {goal.status === "blocked" ? (
            <Text size="caption" tone="muted">
              {t("{p0} did not provide a reason for this goal's blocked state.", {
                p0: HARNESS_TITLE[session.harness],
              })}
            </Text>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={!!disabledReason}
              disabledReason={disabledReason}
              onClick={() => run("/goal clear")}
            >
              {t("Clear goal")}
            </Button>
            {goal.status !== "complete" ? (
              <Button
                data-goal-toggle
                variant="secondary"
                size="sm"
                startIcon={active ? <Pause aria-hidden /> : <Play aria-hidden />}
                disabled={!!disabledReason}
                disabledReason={disabledReason}
                onClick={() => run(active ? "/goal pause" : "/goal resume")}
              >
                {t(active ? "Pause" : "Resume goal")}
              </Button>
            ) : null}
          </div>
          {failed ? (
            <InlineError>
              {t("Goal action was not sent. Try again when the conversation is ready.")}
            </InlineError>
          ) : null}
        </Popover>
      ) : null}
    </>
  );
}
