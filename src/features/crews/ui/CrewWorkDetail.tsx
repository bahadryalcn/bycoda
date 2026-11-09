import { t, useLocale } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { Disclosure } from "../../../shared/ui/Disclosure";
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
import { crewRunTitle } from "../model/crewRoster";
import { roleLabel } from "./CrewMemberForm";
import { CrewModelTag } from "./CrewModelTag";
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
    <Disclosure
      className="mt-4"
      size="sm"
      summary={t("This work's team ({p0})", { p0: run.definition.agents.length })}
    >
      <p className="mt-1 text-ui-caption text-(--ui-text-secondary)">
        {t("Fixed when the work started. Editing the saved crew only changes future work.")}
        {crewSavedTeamChanged(run, savedCrew) ? ` ${t("The saved crew has changed since.")}` : ""}
      </p>
      <ul className="mt-2 flex flex-col">
        {run.definition.agents.map((agent) => (
          <li
            key={agent.id}
            className="flex min-h-(--ui-control-height-compact) min-w-0 items-center gap-2"
          >
            <CrewRoleIcon role={agent.role} className="icon-sm shrink-0" />
            <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
              <span className="truncate text-ui-secondary font-medium">{agent.name}</span>
              {agent.name.trim().toLocaleLowerCase() ===
              roleLabel(agent.role).toLocaleLowerCase() ? null : (
                <span className="shrink-0 text-ui-caption text-(--ui-text-secondary)">
                  {roleLabel(agent.role)}
                </span>
              )}
            </span>
            <CrewModelTag catalog={catalog} agent={agent} className="max-w-[45%] shrink-0" />
          </li>
        ))}
      </ul>
    </Disclosure>
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
  stopRequested = false,
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
  /** The owner stopped this work in this dialog; the lead may still be cancelling. */
  stopRequested?: boolean;
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
  // A stop already sent is not offered again while its cancellation settles.
  const stopping = stopRequested && run.status === "paused";
  const canStop = !stopping && crewCanStop(run);
  const request = crewRequestInfo(run);
  const canRemove =
    run.status !== "active" &&
    crewActivityKnown(run) &&
    !running &&
    !run.tasks.some((task) => task.status === "queued");
  // The running action is named next to its controls, not only by a spinner.
  const pendingText =
    pendingAction === `pause:${run.id}`
      ? run.status === "paused"
        ? t("Resuming…")
        : t("Pausing…")
      : pendingAction === `stop:${run.id}` || (stopping && running)
        ? t("Stopping…")
        : pendingAction === `delete:${run.id}`
          ? t("Deleting…")
          : "";
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
            {pendingText ? (
              <span role="status" className="ms-1 text-ui-caption text-(--ui-text-secondary)">
                {pendingText}
              </span>
            ) : null}
          </>
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
      {/* Technical metadata stays reachable but quiet, after the actionable parts. */}
      {request.kind === "full" ? (
        request.text !== title ? (
          <Disclosure className="mt-4" size="sm" summary={t("Work request")}>
            <p className="mt-2 max-w-[46rem] whitespace-pre-wrap break-words text-content [overflow-wrap:anywhere] leading-relaxed">
              {request.text}
            </p>
          </Disclosure>
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
      <CrewWorkTeam run={run} catalog={catalog} savedCrew={savedCrew} />
      {canDelete ? (
        <div className="mt-4">
          <Button
            variant="ghost"
            size="sm"
            disabled={pending || !canRemove}
            loading={pendingAction === `delete:${run.id}`}
            startIcon={<Trash2 className="icon-sm" />}
            disabledReason={canRemove ? undefined : t("Stop work before deleting it.")}
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
        </div>
      ) : null}
      {dialog}
    </section>
  );
}
