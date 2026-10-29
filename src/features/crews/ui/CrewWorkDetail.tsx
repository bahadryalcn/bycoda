import { t, useLocale } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { useConfirm } from "../../../shared/ui/ConfirmDialog";
import { MessageSquare, Pause, Play, Square, Trash2 } from "../../../shared/ui/icons";
import type { HostModelCatalog } from "../../connections/model/protocol";
import { CREW_LIST_MESSAGE_LIMIT, type CrewDefinition } from "../model/crew";
import type { CrewRunView } from "../model/crewClient";
import {
  crewActivityKnown,
  crewCanStop,
  crewHasRunningWork,
  crewMessageMayBeClipped,
  crewProgressLabel,
  crewRequestInfo,
  crewSavedTeamChanged,
} from "../model/crewPresentation";
import { crewRunTitle, memberModelSummary } from "../model/crewRoster";
import { roleLabel } from "./CrewMemberForm";
import { CrewRoleIcon } from "./CrewRoleIcon";
import { CrewWorkSessions } from "./CrewWorkSessions";
import { CrewWorkBadges, CrewWorkUpdated } from "./CrewWorkState";

/** The team this work started with: an immutable snapshot, not the saved crew. */
function CrewWorkTeam({
  run,
  catalog,
  savedCrew,
}: {
  run: CrewRunView;
  catalog: HostModelCatalog;
  savedCrew?: CrewDefinition;
}) {
  return (
    <details className="mt-4 text-ui-caption">
      <summary className="cursor-pointer font-medium text-(--ui-text-secondary)">
        {t("This work's team ({p0})", { p0: run.definition.agents.length })}
      </summary>
      <p className="mt-2 text-(--ui-text-secondary)">
        {t("Fixed when the work started. Editing the saved crew only changes future work.")}
        {crewSavedTeamChanged(run, savedCrew) ? ` ${t("The saved crew has changed since.")}` : ""}
      </p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {run.definition.agents.map((agent) => (
          <li key={agent.id} className="flex min-w-0 items-start gap-2">
            <CrewRoleIcon role={agent.role} className="icon-sm mt-0.5 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block break-words font-medium text-content [overflow-wrap:anywhere]">
                {agent.name}
              </span>
              <span className="block break-words text-(--ui-text-secondary) [overflow-wrap:anywhere]">
                {roleLabel(agent.role)} · {memberModelSummary(catalog, agent)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Selected work: state, request, decisions and blockers, controls, conversations and team. */
export function CrewWorkDetail({
  run,
  savedCrew,
  catalog,
  pending,
  pendingAction,
  error,
  canOpen,
  canDelete,
  onOpen,
  onPause,
  onStop,
  onDelete,
}: {
  run: CrewRunView;
  /** The current saved crew of this work, when it still exists. */
  savedCrew?: CrewDefinition;
  catalog: HostModelCatalog;
  pending: boolean;
  pendingAction: string | null;
  /** The last failed action on this work, shown beside the controls that caused it. */
  error?: string;
  canOpen: boolean;
  canDelete: boolean;
  onOpen: (id: string, source?: string) => void;
  onPause: () => void;
  onStop: () => void;
  onDelete: () => void;
}) {
  useLocale();
  const { confirm, dialog } = useConfirm();
  const title = crewRunTitle(run);
  const requests = run.messages.filter((message) => !message.resolvedAt);
  const blocked = run.tasks.filter((task) => task.status === "blocked");
  const awaiting =
    run.status === "finished" ? [] : run.tasks.filter((task) => task.status === "review");
  const running = crewHasRunningWork(run);
  const canStop = crewCanStop(run);
  const request = crewRequestInfo(run);
  const canRemove =
    run.status !== "active" &&
    crewActivityKnown(run) &&
    !running &&
    !run.tasks.some((task) => task.status === "queued");
  const openCoordinator = (key: string) => (
    <Button
      variant="link"
      startIcon={<MessageSquare className="icon-sm" />}
      disabled={!run.coordinatorSessionId || !canOpen || pending}
      loading={pendingAction === `open:${key}`}
      onClick={() => run.coordinatorSessionId && onOpen(run.coordinatorSessionId, key)}
    >
      {key.startsWith("answer:") ? t("Answer") : t("Open conversation")}
    </Button>
  );
  return (
    <section data-crew-run={run.id} aria-label={title} className="min-w-0">
      <h3 className="break-words text-ui-title font-medium text-content [overflow-wrap:anywhere]">
        {title}
      </h3>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <CrewWorkBadges run={run} size="md" />
        <span className="text-ui-caption tabular-nums text-(--ui-text-secondary)">
          {crewProgressLabel(run)}
        </span>
        <CrewWorkUpdated value={run.updatedAt} />
      </div>
      {run.status === "paused" && crewActivityKnown(run) ? (
        <p role="status" className="mt-2 text-ui-caption text-(--ui-text-secondary)">
          {running
            ? t("New assignments are paused. Running work can still finish.")
            : t("Work is paused. Nothing is running.")}
        </p>
      ) : null}
      {/* What needs the owner comes first: decisions, acceptance and blockers lead the actions. */}
      {requests.length || blocked.length || awaiting.length ? (
        <div className="mt-3 flex flex-col gap-2">
          {requests.map((message) => (
            <Alert key={message.id} tone="warning" action={openCoordinator(`answer:${message.id}`)}>
              <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                {t("Needs decision: {p0}", { p0: message.text })}
              </p>
              {crewMessageMayBeClipped(message.text) ? (
                <p className="mt-1 text-ui-caption">
                  {t("Showing the first {p0} characters of this message.", {
                    p0: CREW_LIST_MESSAGE_LIMIT,
                  })}
                </p>
              ) : null}
            </Alert>
          ))}
          {awaiting.map((task) => (
            <Alert key={task.id} tone="warning" action={openCoordinator(`accept:${task.id}`)}>
              <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                {t("Awaiting acceptance: {p0}", { p0: task.title })}
              </p>
            </Alert>
          ))}
          {blocked.map((task) => (
            <Alert key={task.id} tone="danger">
              <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                {t("Blocked: {p0}", { p0: task.error ?? task.title })}
              </p>
            </Alert>
          ))}
        </div>
      ) : null}
      {request.kind === "full" ? (
        request.text !== title ? (
          <details className="mt-3 text-ui-secondary">
            <summary className="cursor-pointer font-medium text-(--ui-text-secondary)">
              {t("Work request")}
            </summary>
            <p className="mt-2 max-w-[46rem] whitespace-pre-wrap break-words text-content [overflow-wrap:anywhere] leading-relaxed">
              {request.text}
            </p>
          </details>
        ) : null
      ) : (
        <p
          data-crew-request-note={request.kind}
          className="mt-2 text-ui-caption text-(--ui-text-secondary)"
        >
          {request.kind === "first-line"
            ? t("Only the request's first line is available from this Host.")
            : t("The request text is not available from this Host.")}
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-1">
        {run.status !== "finished" ? (
          <>
            <Button
              variant={run.status === "paused" ? "primary" : "secondary"}
              size="sm"
              disabled={pending}
              loading={pendingAction === `pause:${run.id}`}
              label={run.status === "paused" ? t("Resume work") : t("Pause new assignments")}
              startIcon={
                run.status === "paused" ? (
                  <Play className="icon-sm" />
                ) : (
                  <Pause className="icon-sm" />
                )
              }
              onClick={onPause}
            >
              {run.status === "paused" ? t("Resume work") : t("Pause")}
            </Button>
            {canStop ? (
              <Button
                variant="ghost"
                tone="danger"
                size="sm"
                disabled={pending}
                loading={pendingAction === `stop:${run.id}`}
                startIcon={<Square className="icon-sm" />}
                tooltip={t("Stop work and cancel running assignments")}
                onClick={() =>
                  void confirm({
                    title: t("Stop work"),
                    message: `${title}\n${t("Stop work and cancel running assignments")}`,
                    confirmLabel: t("Stop work"),
                  }).then((ok) => {
                    if (ok) onStop();
                  })
                }
              >
                {t("Stop work")}
              </Button>
            ) : null}
          </>
        ) : null}
        {canDelete ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={pending || !canRemove}
            loading={pendingAction === `delete:${run.id}`}
            className="ms-auto"
            startIcon={<Trash2 className="icon-sm" />}
            tooltip={!canRemove ? t("Stop work before deleting it.") : t("Delete work")}
            onClick={() =>
              void confirm({
                title: t("Delete work"),
                message: `${title}\n${t("Remove this work from the list? The crew, tasks and conversations are kept.")}`,
                confirmLabel: t("Delete work"),
              }).then((ok) => {
                if (ok) onDelete();
              })
            }
          >
            {t("Delete work")}
          </Button>
        ) : null}
      </div>
      {error ? (
        <div className="pt-3">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}
      {run.error ? (
        <div className="pt-3">
          <Alert tone="warning">{run.error}</Alert>
        </div>
      ) : null}
      <CrewWorkSessions
        run={run}
        catalog={catalog}
        canOpen={canOpen}
        pending={pending}
        pendingAction={pendingAction}
        onOpen={onOpen}
      />
      <CrewWorkTeam run={run} catalog={catalog} savedCrew={savedCrew} />
      {dialog}
    </section>
  );
}
