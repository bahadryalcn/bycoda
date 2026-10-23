import { Button } from "../../../shared/ui/Button";
import { t, useLocale, getLocale } from "../../../shared/i18n";
import { LoaderCircle } from "../../../shared/ui/icons";
import { Timeline } from "../../../shared/ui/Timeline";
import {
  TASK_INPUT_REQUIRED,
  canTakeOverBlockedTask,
  taskRequiresInstructions,
  type HostTask,
} from "../model/hostTasks";

export function repairStopLabel(task: HostTask): string | undefined {
  if (canTakeOverBlockedTask(task)) return t("AI takeover pending");
  if (task.blockedTakeover && ["queued", "running", "verifying"].includes(task.status))
    return t("Independent AI completing blocked work");
  if (taskRequiresInstructions(task)) return t("Waiting for your instructions");
  if (task.repairStop?.reason === "external") return t("Waiting for external verification");
  if (task.repairStop?.reason === "no_progress")
    return t("Correction stopped · findings unchanged");
  if (
    task.repairStop?.reason === "limit" ||
    (!task.continueUntilDone && task.status === "blocked" && (task.repairAttempts ?? 0) >= 3)
  )
    return t("Correction stopped · attempt limit reached");
  return undefined;
}

export function TaskAttemptHistory({
  task,
  onOpenSession,
  isOpeningSession = () => false,
}: {
  task: HostTask;
  onOpenSession: (sessionId: string) => void;
  isOpeningSession?: (sessionId: string) => boolean;
}) {
  useLocale();
  const stop = repairStopLabel(task);
  if (!stop && !task.attemptHistory?.length) return null;
  return (
    <section
      aria-label={t("Attempt history")}
      className="space-y-2 border-t border-(--ui-tone-neutral-border) pt-3"
    >
      {stop ? (
        <div className="space-y-1 text-ui-caption text-(--ui-tone-warning-fg)">
          <p className="font-medium">{stop}</p>
          <p className="whitespace-pre-wrap break-words">
            {canTakeOverBlockedTask(task)
              ? t(
                  "A fresh AI session will inspect the previous attempts and continue the retained work automatically when capacity is available.",
                )
              : task.blockedTakeover && task.status !== "blocked"
                ? t("The recovery agent must pass the original checks and review before delivery.")
                : (task.repairStop?.message ??
                  t("Inspect the previous worker and review before retrying."))}
          </p>
          <p className="text-(--ui-text-secondary)">
            {taskRequiresInstructions(task) ? `${TASK_INPUT_REQUIRED} ` : ""}
            {t(
              "Dependent tasks stay queued until this task passes its checks and is delivered. Independent queued tasks can continue.",
            )}
          </p>
        </div>
      ) : null}
      {task.attemptHistory?.length ? (
        <>
          <h3 className="text-ui-caption font-medium text-(--ui-text-secondary)">
            {t("Attempt outcomes")}
          </h3>
          <p className="text-ui-micro text-(--ui-text-secondary)">
            {t(
              "Worker summaries describe what the agent reported. The review below records verification.",
            )}
          </p>
          <Timeline
            label={t("Attempt outcomes")}
            events={task.attemptHistory.map((entry) => ({
              id: [entry.reviewerSessionId, entry.at, String(entry.attempt)].join(":"),
              at: entry.at,
              title: [
                entry.reviewOnly
                  ? t("Review recheck")
                  : entry.attempt
                    ? t("Correction {p0}", { p0: entry.attempt })
                    : t("Initial attempt"),
                entry.verdict === "pass" ? t("Review passed") : t("Review failed"),
              ].join(" · "),
              tone: entry.verdict === "pass" ? ("success" as const) : ("danger" as const),
              meta: new Date(entry.at).toLocaleString(getLocale()),
              detail: (
                <>
                  <p className="whitespace-pre-wrap break-words text-(--ui-text-secondary)">
                    {entry.workerSummary}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap break-words text-(--ui-text-secondary)">
                    {t("Review: ")}
                    {entry.note}
                  </p>
                </>
              ),
              actions: (
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-ui-micro text-(--ui-tone-info-fg)">
                  {entry.workerSessionId ? (
                    <Button
                      variant="ghost"
                      type="button"

                      disabled={isOpeningSession(entry.workerSessionId)}
                      onClick={() => onOpenSession(entry.workerSessionId!)}
                    >
                      {isOpeningSession(entry.workerSessionId) ? (
                        <LoaderCircle className="icon-xs animate-spin" />
                      ) : null}
                      {t("Open worker session")}
                    </Button>
                  ) : null}
                  {entry.reviewerSessionId ? (
                    <Button
                      variant="ghost"
                      type="button"

                      disabled={isOpeningSession(entry.reviewerSessionId)}
                      onClick={() => onOpenSession(entry.reviewerSessionId)}
                    >
                      {isOpeningSession(entry.reviewerSessionId) ? (
                        <LoaderCircle className="icon-xs animate-spin" />
                      ) : null}
                      {t("Open review session")}
                    </Button>
                  ) : null}
                </div>
              ),
            }))}
          />
        </>
      ) : null}
    </section>
  );
}
