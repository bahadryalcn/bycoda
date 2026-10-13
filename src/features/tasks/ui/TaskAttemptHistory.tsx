import { t, useLocale, getLocale } from "../../../shared/i18n";
import { LoaderCircle } from "../../../shared/ui/icons";
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
    <section aria-label={t("Attempt history")} className="space-y-2 border-t border-stroke pt-3">
      {stop ? (
        <div className="space-y-1 text-[12px] text-amber-400">
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
          <p className="text-content/55">
            {taskRequiresInstructions(task) ? `${TASK_INPUT_REQUIRED} ` : ""}
            {t(
              "Dependent tasks stay queued until this task passes its checks and is delivered. Independent queued tasks can continue.",
            )}
          </p>
        </div>
      ) : null}
      {task.attemptHistory?.length ? (
        <>
          <h3 className="text-[12px] font-medium text-content/80">{t("Attempt outcomes")}</h3>
          <p className="text-[11px] text-content/45">
            {t(
              "Worker summaries describe what the agent reported. The review below records verification.",
            )}
          </p>
          {[...task.attemptHistory].reverse().map((entry) => (
            <div
              key={`${entry.reviewerSessionId}:${entry.at}:${entry.attempt}`}
              className="rounded-md border border-content/10 p-2 text-[12px]"
            >
              <details>
                <summary className="cursor-pointer text-content/80">
                  {entry.reviewOnly
                    ? t("Review recheck")
                    : entry.attempt
                      ? t("Correction {p0}", { p0: entry.attempt })
                      : t("Initial attempt")}{" "}
                  · {entry.verdict === "pass" ? t("Review passed") : t("Review failed")} ·{" "}
                  {new Date(entry.at).toLocaleString(getLocale())}
                </summary>
                <p className="mt-2 whitespace-pre-wrap break-words text-content/70">
                  {entry.workerSummary}
                </p>
                <p className="mt-2 whitespace-pre-wrap break-words text-content/70">
                  {t("Review: ")}
                  {entry.note}
                </p>
              </details>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-sky-400">
                {entry.workerSessionId ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 disabled:cursor-wait disabled:opacity-60"
                    disabled={isOpeningSession(entry.workerSessionId)}
                    onClick={() => onOpenSession(entry.workerSessionId!)}
                  >
                    {isOpeningSession(entry.workerSessionId) ? (
                      <LoaderCircle className="size-3 animate-spin" />
                    ) : null}
                    {t("Open worker session")}
                  </button>
                ) : null}
                {entry.reviewerSessionId ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 disabled:cursor-wait disabled:opacity-60"
                    disabled={isOpeningSession(entry.reviewerSessionId)}
                    onClick={() => onOpenSession(entry.reviewerSessionId)}
                  >
                    {isOpeningSession(entry.reviewerSessionId) ? (
                      <LoaderCircle className="size-3 animate-spin" />
                    ) : null}
                    {t("Open review session")}
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </>
      ) : null}
    </section>
  );
}
