import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { Button } from "../../../shared/ui/Button";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Plus } from "../../../shared/ui/icons";
import { useT } from "../../../shared/i18n";

/** First use: what Tasks is for, the one way to start, and the three steps.
 * Limits, summary, stewards and filters stay out of the way until there is work. */
export function TasksEmptyState({
  onCreate,
  disabled,
}: {
  onCreate: () => void;
  disabled: boolean;
}) {
  const t = useT();
  const steps = [
    { title: t("Write the task"), detail: t("Say what should get done.") },
    {
      title: t("An agent works"),
      detail: t("It runs in the background while you do other things."),
    },
    { title: t("Review the result"), detail: t("Accept it, or send it back with notes.") },
  ];
  return (
    <div className="task-onboarding">
      <EmptyState
        context="page"
        kind="empty"
        title={t("No tasks yet")}
        description={t(
          "Give an agent a task. It works in the background and you follow its progress here.",
        )}
        action={
          <Button variant="primary" type="button" disabled={disabled} onClick={onCreate}>
            <Plus className="icon-sm" strokeWidth={1.75} />
            {t("New task")}
          </Button>
        }
      />
      <ol className="task-onboarding-steps" aria-label={t("How it works")}>
        {steps.map((step, index) => (
          <li key={step.title}>
            <Text
              tone="secondary"
              size="caption"
              leading="inherit"
              {...surfaceAttributes(
                { frame: "pane", edge: "all", radius: "pill" },
                "task-onboarding-number",
              )}
              aria-hidden="true"
            >
              {index + 1}
            </Text>
            <span className="task-onboarding-copy">
              <Text
                as="span"
                size="secondary"
                tone="primary"
                weight="medium"
                leading="inherit"
                className="task-onboarding-title"
              >
                {step.title}
              </Text>
              <Text
                size="caption"
                tone="secondary"
                leading="inherit"
                className="task-onboarding-detail"
              >
                {step.detail}
              </Text>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
