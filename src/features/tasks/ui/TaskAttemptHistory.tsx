import { Text } from "../../../shared/ui/Text";
import { Button } from "../../../shared/ui/Button";
import { t, useLocale, getLocale } from "../../../shared/i18n";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { Timeline } from "../../../shared/ui/Timeline";
import { firstSentence } from "../model/taskStatusLine";
import { ClampedMarkdown } from "./TaskStatusLine";
import {
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
  if (!task.attemptHistory?.length) return null;
  // The current stop reason lives in the detail panel's status alert.
  return (
    <section aria-label={t("Attempt history")} className="grid min-w-0 gap-2">
      {task.attemptHistory?.length ? (
        <>
          <SectionLabel as="h3" count={task.attemptHistory.length}>
            {t("Attempt outcomes")}
          </SectionLabel>
          <Text as="p" size="micro" tone="muted">
            {t(
              "Worker summaries describe what the agent reported. The review below records verification.",
            )}
          </Text>
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
              detail: <AttemptDetail summary={entry.workerSummary} note={entry.note} />,
              actions: (
                <Text
                  as="div"
                  size="micro"
                  tone="info"
                  className="mt-2 flex flex-wrap gap-x-3 gap-y-1"
                >
                  {entry.workerSessionId ? (
                    <Button
                      variant="ghost"
                      type="button"

                      disabled={isOpeningSession(entry.workerSessionId)}
                      loading={isOpeningSession(entry.workerSessionId)}
                      onClick={() => onOpenSession(entry.workerSessionId!)}
                    >
                      {t("Open worker session")}
                    </Button>
                  ) : null}
                  {entry.reviewerSessionId ? (
                    <Button
                      variant="ghost"
                      type="button"

                      disabled={isOpeningSession(entry.reviewerSessionId)}
                      loading={isOpeningSession(entry.reviewerSessionId)}
                      onClick={() => onOpenSession(entry.reviewerSessionId)}
                    >
                      {t("Open review session")}
                    </Button>
                  ) : null}
                </Text>
              ),
            }))}
          />
        </>
      ) : null}
    </section>
  );
}

/** A worker's markdown summary and the review note, short until expanded. */
function AttemptDetail({ summary, note }: { summary: string; note: string }) {
  useLocale();
  const shortNote = firstSentence(note, 160) ?? "";
  const noteLine = (text: string) => (
    <Text as="p" size="caption" tone="secondary" className="mt-1.5 whitespace-pre-wrap break-words">
      {t("Review: ")}
      {text}
    </Text>
  );
  return (
    <ClampedMarkdown
      text={summary.trim() || t("No summary.")}
      long={shortNote !== note.replace(/\s+/g, " ").trim()}
      collapsedExtra={noteLine(shortNote)}
      extra={noteLine(note)}
    />
  );
}
