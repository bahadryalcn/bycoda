import { useMemo, type ReactNode } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Eye } from "../../../shared/ui/icons";
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
import type { MemberAvatarTraits } from "../model/memberAvatarTraits";
import { teamTraits } from "../model/memberAvatars";
import { MemberAvatar } from "./MemberAvatar";
import { roleLabel } from "./CrewMemberForm";
import { CrewModelTag } from "./CrewModelTag";
import { CrewRoleIcon } from "./CrewRoleIcon";

export function crewSessionCount(run: CrewRunView) {
  return new Set(
    [
      run.coordinatorSessionId,
      ...run.tasks.flatMap((task) => Object.values(taskSessionIds(task))),
    ].filter(Boolean),
  ).size;
}

/** One conversation: the member's cue, name and role, then its task and model, and its state. */
function SessionRow({
  role,
  traits,
  name,
  roleText,
  task,
  model,
  status,
  working,
  disabled,
  loading,
  title,
  details,
  onClick,
}: {
  role: CrewRole;
  /** The member's pixel look; the role glyph stands in when the member is unknown. */
  traits?: MemberAvatarTraits;
  name: string;
  /** Responsibility, shown when the member's name does not already say it. */
  roleText?: string;
  task?: string;
  model?: ReactNode;
  /** Only what is worth saying: a live, interrupted or unavailable state; omitted when plain. */
  status?: ReactNode;
  working?: boolean;
  disabled: boolean;
  loading: boolean;
  title?: string;
  details?: readonly ReactNode[];
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
      tooltip={title ?? t("View conversation")}
      tooltipWhen={title ? "overflow" : "always"}
      tooltipDetails={details}
    >
      {traits ? (
        <MemberAvatar traits={traits} size={24} className="shrink-0" />
      ) : (
        <CrewRoleIcon role={role} className="icon-sm shrink-0" />
      )}
      <span className="flex min-w-0 flex-1 flex-col text-start">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate text-ui-secondary font-medium">{name}</span>
          {roleText ? (
            <span className="shrink-0 text-ui-caption text-(--ui-text-secondary)">{roleText}</span>
          ) : null}
        </span>
        {task || model ? (
          <span className="flex min-w-0 items-center gap-1.5 text-ui-caption text-(--ui-text-secondary)">
            {task ? <span className="min-w-0 truncate">{task}</span> : null}
            {task && model ? <span aria-hidden="true">·</span> : null}
            {model}
          </span>
        ) : null}
      </span>
      {working || status ? (
        <span className="inline-flex max-w-[38%] shrink-0 items-center gap-1 text-end text-ui-caption text-(--ui-text-secondary)">
          {working ? <WorkingIndicator size="xs" /> : null}
          {status ? <span>{status}</span> : null}
        </span>
      ) : null}
      <Eye aria-hidden="true" className="icon-sm shrink-0 text-(--ui-text-muted)" />
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
  const looks = useMemo(() => teamTraits(run.definition.agents), [run.definition.agents]);
  const coordinator = crewRunRoleMember(run, "coordinator");
  const reviewer = crewRunRoleMember(run, "reviewer");
  const coordinatorName = coordinator?.name.trim() || roleLabel("coordinator");
  const reviewerName = reviewer?.name.trim() || roleLabel("reviewer");
  const same = (name: string, role: CrewRole) =>
    name.trim().toLocaleLowerCase() === roleLabel(role).toLocaleLowerCase();
  return (
    <>
      {crewSessionCount(run) > 1 ? (
        <h4 className="pb-1 pt-4 text-ui-caption font-medium text-(--ui-text-secondary)">
          {t("Sessions")}
        </h4>
      ) : (
        <div className="pt-3" />
      )}
      <div role="list" aria-label={t("Sessions")} className="flex min-w-0 flex-col gap-px">
        <div role="listitem">
          <SessionRow
            role="coordinator"
            traits={coordinator && looks.get(coordinator.id)}
            name={coordinatorName}
            roleText={same(coordinatorName, "coordinator") ? undefined : roleLabel("coordinator")}
            model={
              run.coordinatorCandidate || coordinator ? (
                <CrewModelTag
                  catalog={catalog}
                  candidate={run.coordinatorCandidate}
                  agent={coordinator}
                  className="shrink-0"
                />
              ) : undefined
            }
            working={run.coordinatorStatus === "running"}
            status={
              !run.coordinatorSessionId
                ? t("Session unavailable")
                : run.coordinatorStatus === "running"
                  ? t("Working")
                  : run.coordinatorStatus === "interrupted"
                    ? t("Interrupted")
                    : undefined
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
            <div key={task.id} role="listitem" className="flex min-w-0 flex-col gap-px">
              <SessionRow
                role={agent?.role ?? "specialist"}
                traits={agent && looks.get(agent.id)}
                name={workerName}
                roleText={
                  agent && !same(workerName, agent.role) && agent.role !== "specialist"
                    ? roleLabel(agent.role)
                    : undefined
                }
                task={task.title}
                model={<CrewModelTag catalog={catalog} candidate={task} className="shrink-0" />}
                working={task.status === "running"}
                status={crewTaskStatusLabel(task.status)}
                disabled={!ids.worker || !canOpen || pending}
                loading={pendingAction === `open:worker:${task.id}`}
                title={task.title}
                details={[`${task.harness} · ${task.model}`, assignment?.reason].filter(
                  (value): value is string => !!value,
                )}
                onClick={() => ids.worker && onOpen(ids.worker, `worker:${task.id}`)}
              />
              {ids.review ? (
                <SessionRow
                  role="reviewer"
                  traits={reviewer && looks.get(reviewer.id)}
                  name={reviewerName}
                  roleText={same(reviewerName, "reviewer") ? undefined : roleLabel("reviewer")}
                  task={task.title}
                  model={
                    task.reviewerConfig ? (
                      <CrewModelTag
                        catalog={catalog}
                        candidate={task.reviewerConfig}
                        className="shrink-0"
                      />
                    ) : undefined
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
