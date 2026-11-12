import { Text } from "../../../../shared/ui/Text";
import type {
  AssistantJob,
  AssistantRequest,
} from "../../../../shared/model/host-contracts/assistant";
import { t } from "../../../../shared/i18n";
import { InlineError } from "../../../../shared/ui/InlineError";
import { assistantRequest as ownerRequest, operationId } from "../../model/assistantClient";
import {
  AssistantJobBatch,
  assistantJobProjectIds,
  assistantJobVisible,
} from "../../model/assistantJobs";
import { verifiedAssistantJobDeleteReview } from "../../model/assistantJobDeletion";
import styles from "../AssistantView.module.css";
import jobStyles from "./Jobs.module.css";
import {
  finished,
  matches,
  commitJobIntents,
  type JobDraft,
  type PreparedJobReview,
} from "./assistantRoomHelpers";
import type { AssistantRoomCore } from "./useAssistantRoomState";

export function useAssistantRoomJobs(core: AssistantRoomCore) {
  const {
    environmentId,
    assistantRequest,
    projects,
    privacy,
    snapshot,
    visibility,
    canSeeProject,
    view,
    query,
    filter,
    jobProjectFilter,
    jobDateFilter,
    error,
    setConfirm,
    setUndo,
    selected,
    setSelected,
    detail,
    jobText,
    setJobText,
    jobReview,
    setJobReview,
    jobBatch,
    jobReviewFrozen,
    setJobReviewFrozen,
    jobReviewEnvironment,
    jobIntents,
    defaultProjectId,
    jobKey,
    reviewIntent,
    reviewedDraft,
    visibleDraft,
    run,
    mutate,
    refresh,
    props,
  } = core;

  function control(job: AssistantJob, action: "pause" | "resume" | "stop" | "delete" | "keep") {
    if (!assistantJobVisible(job, canSeeProject)) return;
    if (action === "keep") {
      run(job.id, t("Keeping job and tasks..."), async () => {
        const result = await assistantRequest({
          op: "jobs.deleteAbort",
          id: job.id,
          expectedVersion: job.version,
        });
        if (
          !result.job ||
          result.job.id !== job.id ||
          result.job.status !== "paused" ||
          result.job.pendingTaskDeletion ||
          result.job.awaitingOwnerRestart !== true ||
          result.job.projectId !== job.projectId ||
          JSON.stringify(assistantJobProjectIds(result.job)) !==
            JSON.stringify(assistantJobProjectIds(job))
        )
          throw new Error("Job status is unknown. Check the Room before retrying.");
      });
      return;
    }
    if (action === "delete") {
      run(`deleteReview:${job.id}`, t("Loading..."), async () => {
        const sourcePrivacy = privacy.key;
        let review: ReturnType<typeof verifiedAssistantJobDeleteReview>,
          reviewError = "";
        if (job.kind !== "quick" && job.goalId) {
          try {
            const response = await assistantRequest({
              op: "jobs.deleteReview",
              id: job.id,
              expectedVersion: job.version,
            });
            review = verifiedAssistantJobDeleteReview(job, response.deleteReview, canSeeProject);
            if (!review)
              throw new Error(
                "The task deletion scope could not be verified. You can still delete only the job.",
              );
          } catch (cause) {
            reviewError = cause instanceof Error ? cause.message : String(cause);
          }
        }
        if (
          sourcePrivacy !== visibility.current.privacy.key ||
          !assistantJobVisible(job, canSeeProject)
        )
          return;
        let frozenInput: Extract<AssistantRequest, { op: "jobs.control" }> | undefined;
        setConfirm({
          title: t("Delete job?"),
          message: job.title,
          confirmLabel: (state) =>
            t(state.acknowledged ? "Delete job and tasks" : "Delete job only"),
          acknowledge: review
            ? {
                label: t("Also delete the reviewed tasks"),
                defaultChecked: false,
                required: false,
              }
            : undefined,
          body: review ? (
            <>
              <p>
                {t("{p0} tasks in the canonical deletion scope", {
                  p0: review.tasks.length,
                })}
              </p>
              <Text as="ul" tone="inherit" leading="inherit" className={jobStyles.deleteTasks}>
                {review.tasks.map((task) => (
                  <li key={task.id}>
                    <Text
                      as="strong"
                      size="inherit"
                      tone="inherit"
                      weight="medium"
                      leading="inherit"
                    >
                      {task.title}
                    </Text>
                    <span>· {projectName(task.projectId)}</span>
                  </li>
                ))}
              </Text>
            </>
          ) : reviewError ? (
            <InlineError>{t(reviewError)}</InlineError>
          ) : undefined,
          consequences: (state) => [
            t(
              state.acknowledged
                ? "The job and reviewed task metadata stop first and move to Recently deleted. Sessions, branches, worktrees and working files remain."
                : job.kind === "quick"
                  ? "Deleting this job keeps its saved note or automation."
                  : "The job stops first. Tasks, sessions, worktrees and changes remain.",
            ),
            t("You can restore this job from Recently deleted for seven days."),
            ...(state.acknowledged
              ? [
                  t(
                    "Restoring keeps the goal and tasks stopped. Review them in the task board before restarting.",
                  ),
                ]
              : []),
          ],
          onConfirm: async ({ acknowledged }) => {
            if (!assistantJobVisible(job, canSeeProject))
              throw new Error("The selected project is no longer visible.");
            if (acknowledged && !verifiedAssistantJobDeleteReview(job, review, canSeeProject))
              throw new Error(
                "The task deletion scope could not be verified. You can still delete only the job.",
              );
            const input: Extract<AssistantRequest, { op: "jobs.control" }> = {
              op: "jobs.control",
              id: job.id,
              expectedVersion: job.version,
              action,
              ...(acknowledged ? { deleteTasks: true, taskDeleteToken: review!.sourceToken } : {}),
            };
            if (frozenInput && JSON.stringify(input) !== JSON.stringify(frozenInput))
              throw new Error(
                "The deletion is pending. Keep its original task selection while checking its status.",
              );
            frozenInput ??= input;
            try {
              const result = await assistantRequest(frozenInput);
              if (
                !result.job ||
                result.job.id !== job.id ||
                result.job.status !== "cancelled" ||
                result.job.projectId !== job.projectId ||
                JSON.stringify(assistantJobProjectIds(result.job)) !==
                  JSON.stringify(assistantJobProjectIds(job))
              )
                throw new Error("Job status is unknown. Check the Room before retrying.");
            } catch (cause) {
              await refresh();
              throw cause;
            }
            setUndo({
              id: `jobs:${job.id}`,
              label: job.title,
              projectId: job.projectId ?? undefined,
              projectIds: assistantJobProjectIds(job),
              environmentId,
            });
          },
        });
      });
    } else
      mutate(
        job.id,
        t(action === "stop" ? "Stopping..." : action === "pause" ? "Pausing..." : "Resuming..."),
        {
          op: "jobs.control",
          id: job.id,
          expectedVersion: job.version,
          action,
        },
      );
  }
  function reviewJobTasks(job: AssistantJob) {
    run(`tasks:${job.id}`, t("Loading..."), async () => {
      if (
        job.kind === "quick" ||
        !job.goalId ||
        !environmentId ||
        !assistantJobVisible(job, canSeeProject) ||
        !props.onReviewJobTasks
      )
        throw new Error("The selected project is no longer visible.");
      await props.onReviewJobTasks({
        jobId: job.id,
        goalId: job.goalId,
        projectId: job.projectId,
        projectIds: assistantJobProjectIds(job),
        environmentId,
      });
    });
  }
  /**
   * Builds the reviewed rows for the composer text: a retained frozen review for the same text
   * wins, so a failed start retries with its original idempotency keys. Resets the batch ref;
   * no review dialog state is touched.
   */
  function prepareJobReview(source: string): PreparedJobReview {
    jobBatch.current = null;
    try {
      const saved = JSON.parse(localStorage.getItem("bycoda.assistant.job-review") ?? "null");
      if (
        saved?.source === source &&
        Array.isArray(saved.rows) &&
        saved.rows.every(
          (row: JobDraft) =>
            typeof row.id === "string" &&
            typeof row.key === "string" &&
            typeof row.request === "string" &&
            typeof row.title === "string" &&
            typeof row.projectId === "string" &&
            Array.isArray(row.projectIds),
        )
      )
        return {
          rows: saved.rows as JobDraft[],
          frozen: saved.frozen === true,
          environmentId: typeof saved.environmentId === "string" ? saved.environmentId : undefined,
        };
    } catch {
      /* Review the retained source text. */
    }
    return {
      rows: source
        .split(/\r?\n/)
        .filter((request) => request.trim())
        .map((request) => ({
          id: operationId(),
          title: request.trim().slice(0, 300),
          request,
          projectId: defaultProjectId,
          projectIds: defaultProjectId ? [defaultProjectId] : [],
          key: jobKey(request, defaultProjectId),
        })),
      frozen: false,
      environmentId: undefined,
    };
  }
  /** Opens the review dialog on prepared rows. */
  function openJobReview(prepared: PreparedJobReview) {
    jobReviewEnvironment.current = prepared.environmentId;
    setJobReviewFrozen(prepared.frozen);
    setJobReview(prepared.rows);
  }
  /**
   * The single start path. The review dialog calls it with its state; a direct start (no
   * `confirmJobs`) passes the prepared rows itself.
   */
  async function submitJobs(prepared?: PreparedJobReview) {
    const rows = prepared ? prepared.rows : jobReview;
    const frozen = prepared ? prepared.frozen : jobReviewFrozen;
    if (!rows?.length) return;
    const savedEnvironment = prepared ? prepared.environmentId : jobReviewEnvironment.current;
    const sourceEnvironment = frozen ? savedEnvironment : environmentId;
    setJobReviewFrozen(true);
    jobReviewEnvironment.current = sourceEnvironment;
    if (!jobBatch.current)
      jobBatch.current = new AssistantJobBatch(async (request) => {
        if (request.op === "jobs.create") {
          if (request.kind !== "quick" && !assistantJobVisible(request, canSeeProject))
            throw new Error("The selected project is no longer visible.");
          if (
            request.kind === "quick" &&
            (request.quickAction.kind === "note"
              ? visibility.current.canonicalSnapshot?.capabilities.quickNotes !== true
              : visibility.current.canonicalSnapshot?.capabilities.quickAutomations !== true ||
                !canSeeProject(request.quickAction.projectId))
          )
            throw new Error(
              request.quickAction.kind === "note"
                ? "Quick note jobs are unavailable on this Host."
                : "Quick automation jobs are unavailable for this project.",
            );
        }
        if (!sourceEnvironment)
          throw new Error(
            "The original Host could not be verified. Keep this draft and reconnect its original computer.",
          );
        return ownerRequest(request, sourceEnvironment);
      });
    const result = await run("jobs.create", t("Starting jobs..."), async () => {
      localStorage.setItem(
        "bycoda.assistant.job-review",
        JSON.stringify({
          source: jobText,
          rows,
          frozen: true,
          environmentId: sourceEnvironment,
        }),
      );
      if (!sourceEnvironment)
        throw new Error(
          "The original Host could not be verified. Keep this draft and reconnect its original computer.",
        );
      if (!rows.every(visibleDraft)) throw new Error("The selected project is no longer visible.");
      await jobBatch.current!.start(rows.map(reviewedDraft));
      await refresh();
    });
    if (result) {
      localStorage.removeItem("bycoda.assistant.job-review");
      commitJobIntents(jobIntents, (intents) => {
        for (const draft of rows) delete intents[reviewIntent(draft)];
      });
      jobBatch.current = null;
      jobReviewEnvironment.current = undefined;
      setJobReviewFrozen(false);
      setJobReview(null);
      setJobText("");
    }
  }
  function bulk(action: "stop" | "delete") {
    if (!snapshot) return;
    const jobs = snapshot.jobs.filter((job) => selected.has(job.id));
    const execute = async () => {
      for (const job of jobs)
        if (assistantJobVisible(job, canSeeProject))
          await assistantRequest({
            op: "jobs.control",
            id: job.id,
            expectedVersion: job.version,
            action,
          });
      setSelected(new Set());
    };
    if (action === "delete")
      setConfirm({
        title: t("Delete selected jobs?"),
        message: t("The selected jobs stop first. Tasks, sessions and worktrees remain."),
        confirmLabel: t("Delete"),
        onConfirm: execute,
      });
    else run("bulk", t("Stopping..."), execute);
  }
  const openJob = snapshot?.jobs.find((job) => job.id === detail);
  const visibleSelectedCount = snapshot?.jobs.filter((job) => selected.has(job.id)).length ?? 0;
  const jobDraftVisible =
    !jobReview ||
    jobReview.every(
      (draft) => (draft.kind !== "quick" && !draft.projectIds.length) || visibleDraft(draft),
    );
  const reviewHasAutomation = !!jobReview?.some(
    (row) => row.kind === "quick" && row.quickAction?.kind === "automation",
  );
  const active = snapshot?.jobs.filter((job) => !finished(job)) ?? [];
  const workingJobs = active.filter((job) =>
    ["planning", "running", "stalled"].includes(job.status),
  );
  const allJobs = (view === "Today" ? active : (snapshot?.jobs ?? [])).filter(
    (job) =>
      matches(query, job.title, job.request, job.summary) &&
      (!filter || job.status === filter) &&
      (view !== "Jobs" ||
        ((!jobProjectFilter || assistantJobProjectIds(job).includes(jobProjectFilter)) &&
          (jobDateFilter === "all" ||
            job.createdAt >=
              (jobDateFilter === "today"
                ? new Date().setHours(0, 0, 0, 0)
                : Date.now() - 7 * 86400000)))),
  );
  const projectName = (id: string) =>
    projects.find((project) => (project.id ?? project.path) === id)?.name ??
    t("Project unavailable");
  const errorFor = (key: string) =>
    error?.key === key ? <InlineError className={styles.error}>{error.text}</InlineError> : null;
  const empty = (text: string) => (
    <Text as="p" size="caption" tone="secondary" leading="inherit" className={styles.empty}>
      {t(text)}
    </Text>
  );
  function clearHistory() {
    setConfirm({
      title: t("Clear history?"),
      message: t("Your activity records move to Recently deleted. Running work is unaffected."),
      confirmLabel: t("Clear"),
      onConfirm: async () => {
        await assistantRequest({ op: "activity.clear" });
      },
    });
  }

  return {
    control,
    reviewJobTasks,
    prepareJobReview,
    openJobReview,
    submitJobs,
    bulk,
    openJob,
    visibleSelectedCount,
    jobDraftVisible,
    reviewHasAutomation,
    active,
    workingJobs,
    allJobs,
    projectName,
    errorFor,
    empty,
    clearHistory,
  };
}
