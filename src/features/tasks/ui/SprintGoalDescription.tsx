import { useT } from "../../../shared/i18n";
import { Disclosure } from "../../../shared/ui/Disclosure";
import "./sprints.css";

export function SprintGoalDescription({ goal }: { goal: string }) {
  const t = useT();
  if (goal.length <= 180 && !/\n\s*\n/.test(goal))
    return <p className="sprint-goal-copy">{goal}</p>;
  return (
    <Disclosure summary={t("Sprint goal")} className="sprint-goal-disclosure">
      <p
        className="sprint-goal-copy sprint-goal-scroll"
        role="region"
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Scrollable goal text must remain keyboard-focusable.
        tabIndex={0}
        aria-label={t("Sprint goal")}
      >
        {goal}
      </p>
    </Disclosure>
  );
}
