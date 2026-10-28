import type { ReactNode } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { ChevronRight } from "../../../shared/ui/icons";
import { WorkingIndicator } from "../../../shared/ui/WorkingIndicator";
import type { HostModelCatalog } from "../../connections/model/protocol";
import { taskSessionIds } from "../../tasks/model/backgroundSession";
import type { CrewRole } from "../model/crew";
import type { CrewRunView } from "../model/crewClient";
import {
  crewReviewLabel,
  crewRunMember,
  crewRunRoleMember,
  crewTaskReview,
  crewTaskStatusLabel,
} from "../model/crewPresentation";
import { memberModelSummary } from "../model/crewRoster";
import { roleLabel } from "./CrewMemberForm";
import { CrewRoleIcon } from "./CrewRoleIcon";

export function crewSessionCount(run: CrewRunView) {
  return new Set(
    [
      run.coordinatorSessionId,
      ...run.tasks.flatMap((task) => Object.values(taskSessionIds(task))),
    ].filter(Boolean),
  ).size;
}

function modelName(catalog: HostModelCatalog, harness: string, model: string) {
  return (
    catalog.models[harness as keyof typeof catalog.models]?.find((item) => item.id === model)
      ?.name ?? model
  );
}

/** One conversation: the member's cue and name, its task and model, and its state. */
function SessionRow({
  role,
  name,
  roleText,
  task,
  model,
  status,
  working,
  disabled,
  loading,
  title,
  onClick,
}: {
  role: CrewRole;
  name: string;
  /** Responsibility, shown when the member's name does not already say it. */
  roleText?: string;
  task?: string;
  model?: string;
  status: ReactNode;
  working?: boolean;
  disabled: boolean;
  loading: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <Button
      variant="item"
      motion="none"
      className="w-full min-w-0"
      disabled={disabled}
      loading={loading}
      onClick={onClick}
      title={title}
    >
      <CrewRoleIcon role={role} className="icon-md shrink-0" />
      <span className="min-w-0 flex-1 text-start">
        <span className="block truncate font-medium">{name}</span>
        {roleText || task ? (
          <span className="block truncate text-ui-caption text-(--ui-text-secondary)">
            {[roleText, task].filter(Boolean).join(" · ")}
          </span>
        ) : null}
        {model ? (
          <span className="block truncate text-ui-caption text-(--ui-text-secondary)">{model}</span>
        ) : null}
      </span>
      <span className="inline-flex max-w-[38%] shrink-0 items-center gap-1 text-end text-ui-caption text-(--ui-text-secondary)">
        {working ? <WorkingIndicator size="xs" /> : null}
        <span>{status}</span>
      </span>
      <ChevronRight className="icon-sm shrink-0" />
    </Button>
  );
}

/**
 * Conversations attached to a work. Names, roles and models come from this run's
 * team snapshot and its own task records (CR-W05); an automatic member shows its
 * candidate pool, never a guessed selection. The current reviewer and an earlier
 * review are told apart, and opening a conversation never resumes work.
 */
export function CrewWorkSessions({
  run,
  catalog,
  canOpen,
  pending,
  pendingAction,
  onOpen,
}: {
  run: CrewRunView;
  catalog: HostModelCatalog;
  canOpen: boolean;
  pending: boolean;
  pendingAction: string | null;
  onOpen: (id: string, source?: string) => void;
}) {
  useLocale();
  const coordinator = crewRunRoleMember(run, "coordinator");
  const reviewer = crewRunRoleMember(run, "reviewer");
  const coordinatorName = coordinator?.name.trim() || roleLabel("coordinator");
  const reviewerName = reviewer?.name.trim() || roleLabel("reviewer");
  const same = (name: string, role: CrewRole) =>
    name.trim().toLocaleLowerCase() === roleLabel(role).toLocaleLowerCase();
  return (
    <>
      <h4 className="pb-2 pt-4 text-ui-caption font-medium text-(--ui-text-secondary)">
        {t("Sessions ({p0})", { p0: crewSessionCount(run) })}
      </h4>
      <div
        role="list"
        aria-label={t("Sessions")}
        className="flex min-w-0 flex-col divide-y divide-(--ui-tone-neutral-border)"
      >
        <div role="listitem">
          <SessionRow
            role="coordinator"
            name={coordinatorName}
            roleText={same(coordinatorName, "coordinator") ? undefined : roleLabel("coordinator")}
            model={
              run.coordinatorCandidate
                ? modelName(
                    catalog,
                    run.coordinatorCandidate.harness,
                    run.coordinatorCandidate.model,
                  )
                : coordinator
                  ? memberModelSummary(catalog, coordinator)
                  : undefined
            }
            working={run.coordinatorStatus === "running"}
            status={
              !run.coordinatorSessionId
                ? t("Session unavailable")
                : run.coordinatorStatus === "running"
                  ? t("Working")
                  : run.coordinatorStatus === "interrupted"
                    ? t("Interrupted")
                    : run.status === "paused" && run.coordinatorStatus === "idle"
                      ? t("Nothing running")
                      : t("Conversation")
            }
            disabled={!run.coordinatorSessionId || !canOpen || pending}
            loading={pendingAction === "open:coordinator"}
            onClick={() =>
              run.coordinatorSessionId && onOpen(run.coordinatorSessionId, "coordinator")
            }
          />
        </div>
        {run.tasks.map((task) => {
          const assignment = run.assignments.find((item) => item.taskId === task.id);
          const agent = crewRunMember(run, assignment?.memberId);
          const ids = taskSessionIds(task);
          const review = crewTaskReview(task, ids.review);
          const workerName = agent?.name.trim() || roleLabel("specialist");
          return (
            <div key={task.id} role="listitem" className="min-w-0 py-1">
              <SessionRow
                role={agent?.role ?? "specialist"}
                name={workerName}
                roleText={
                  agent && !same(workerName, agent.role) && agent.role !== "specialist"
                    ? roleLabel(agent.role)
                    : undefined
                }
                task={task.title}
                model={modelName(catalog, task.harness, task.model)}
                working={task.status === "running"}
                status={crewTaskStatusLabel(task.status)}
                disabled={!ids.worker || !canOpen || pending}
                loading={pendingAction === `open:worker:${task.id}`}
                title={`${task.title}\n${task.harness} · ${task.model}\n${assignment?.reason ?? ""}`}
                onClick={() => ids.worker && onOpen(ids.worker, `worker:${task.id}`)}
              />
              {ids.review ? (
                <SessionRow
                  role="reviewer"
                  name={reviewerName}
                  roleText={same(reviewerName, "reviewer") ? undefined : roleLabel("reviewer")}
                  task={task.title}
                  model={
                    task.reviewerConfig
                      ? modelName(catalog, task.reviewerConfig.harness, task.reviewerConfig.model)
                      : undefined
                  }
                  working={review.current}
                  status={crewReviewLabel(review.state)}
                  disabled={!canOpen || pending}
                  loading={pendingAction === `open:review:${task.id}`}
                  title={task.title}
                  onClick={() => onOpen(ids.review!, `review:${task.id}`)}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </>
  );
}
