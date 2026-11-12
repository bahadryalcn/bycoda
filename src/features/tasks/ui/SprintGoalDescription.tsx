import { Text } from "../../../shared/ui/Text";
import { useT } from "../../../shared/i18n";
import { Disclosure } from "../../../shared/ui/Disclosure";
import "./sprints.css";

export function SprintGoalDescription({ goal }: { goal: string }) {
  const t = useT();
  if (goal.length <= 180 && !/\n\s*\n/.test(goal))
    return (
      <Text as="p" size="inherit" tone="secondary" className="sprint-goal-copy">
        {goal}
      </Text>
    );
  return (
    <Disclosure summary={t("Sprint goal")} className="sprint-goal-disclosure">
      <Text
        as="p"
        size="inherit"
        tone="secondary"
        className="sprint-goal-copy sprint-goal-scroll"
        role="region"
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Scrollable goal text must remain keyboard-focusable.
        tabIndex={0}
        aria-label={t("Sprint goal")}
      >
        {goal}
      </Text>
    </Disclosure>
  );
}
