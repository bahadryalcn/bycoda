import { t } from "../../../shared/i18n";
import type { VoiceAssistantControlPorts } from "./voiceAssistantControls";
/** Presentation only. The broker has already verified owner intent and the canonical scope. */
export function voiceAssistantControlChoice(
  target: Parameters<VoiceAssistantControlPorts["confirm"]>[0],
  names: readonly (string | undefined)[],
) {
  const ids = target.projectIds ?? (target.projectId ? [target.projectId] : []);
  if (names.length !== ids.length || names.some((name) => !name)) return;
  const verb = target.deleteReview
    ? t("Delete job and tasks")
    : t(
        (
          {
            pause: "Pause",
            resume: "Resume",
            stop: "Stop",
            delete: "Delete job only",
            keep: "Keep job and tasks",
          } as const
        )[target.action],
      );
  const description = [
    target.deleteReview
      ? t("{p0} tasks. Sessions, branches and working files remain.", {
          p0: target.deleteReview.tasks.length,
        })
      : "",
    ids.length ? t("Project: {p0}", { p0: names.join(", ") }) : t("Personal assistant notebook"),
  ]
    .filter(Boolean)
    .join(" ");
  if (description.length > 500)
    throw new Error("Review this job and its tasks in the Room before deleting them.");
  return {
    question: t("{p0}: {p1}?", { p0: verb, p1: target.title }),
    kind: "confirm" as const,
    allowCustom: false,
    timeoutSec: 60,
    options: [
      { id: "confirm", label: verb, description },
      { id: "cancel", label: t("Cancel") },
    ],
  };
}
