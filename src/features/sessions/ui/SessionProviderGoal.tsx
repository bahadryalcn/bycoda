import { useRef, useState } from "react";
import type { Session } from "../model/session";
import { isSessionGoal, type SessionGoal } from "../model/providerGoal";
import { useFormat, useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Popover } from "../../../shared/ui/Popover";
import { InlineError } from "../../../shared/ui/InlineError";
import { Text, type TextTone } from "../../../shared/ui/Text";
import { CircleDot, Pause, Play } from "../../../shared/ui/icons";

export type SessionProviderGoalCommand = "/goal pause" | "/goal resume" | "/goal clear";

const GOAL_TONE: Record<SessionGoal["status"], TextTone> = {
  active: "primary",
  paused: "secondary",
  blocked: "warning",
  usageLimited: "warning",
  budgetLimited: "warning",
  complete: "success",
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
  const statusLabels: Record<SessionGoal["status"], string> = {
    active: t("Pursuing goal"),
    paused: t("Goal paused"),
    blocked: t("Goal blocked"),
    usageLimited: t("Goal hit a usage limit"),
    budgetLimited: t("Goal reached its token budget"),
    complete: t("Goal complete"),
  };
  const statusLabel = statusLabels[goal.status];
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
        aria-label={statusLabel}
        startIcon={<CircleDot className="icon-sm" aria-hidden />}
        onClick={() => {
          setFailed(false);
          setOpen(!open);
        }}
      >
        {goal.status === "active" ? t("Goal") : statusLabel}
      </Button>
      {open ? (
        <Popover
          anchor={anchor}
          side="top"
          align="end"
          size="lg"
          kind="dialog"
          flow="scroll"
          aria-label={t("Goal")}
          initialFocus="[data-goal-toggle]"
          onDismiss={() => setOpen(false)}
          variant="panel"
          className="flex min-w-0 flex-col gap-3"
        >
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Text
              as="span"
              size="caption"
              weight="medium"
              tone={GOAL_TONE[goal.status]}
              wrap="anywhere"
            >
              {statusLabel}
            </Text>
            {usage.length ? (
              <Text as="span" size="caption" tone="secondary" className="tabular-nums">
                {usage.join(" · ")}
              </Text>
            ) : null}
          </div>
          <Text size="secondary" tone="secondary" leading="relaxed" wrap="anywhere">
            {goal.objective}
          </Text>
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
                {active ? t("Pause") : t("Resume goal")}
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
