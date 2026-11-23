import { Text } from "../../../shared/ui/Text";
import { useT } from "../../../shared/i18n";
import { Disclosure } from "../../../shared/ui/Disclosure";
import "./sprints.css";

/** The sprint goal: one short paragraph, or a closed disclosure when it is long. */
export function SprintGoalDescription({ goal }: { goal: string }) {
  const t = useT();
  if (goal.length <= 180 && !/\n\s*\n/.test(goal))
    return (
      <Text as="p" size="inherit" tone="secondary" wrap="preserve-lines">
        {goal}
      </Text>
    );
  return (
    <Disclosure summary={t("Goal")} variant="compact">
      <Text
        as="p"
        size="inherit"
        tone="secondary"
        wrap="preserve-lines"
        className="sprint-goal-scroll"
        role="region"
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Scrollable goal text must remain keyboard-focusable.
        tabIndex={0}
        aria-label={t("Goal")}
      >
        {goal}
      </Text>
    </Disclosure>
  );
}
