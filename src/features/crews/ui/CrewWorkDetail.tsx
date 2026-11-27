import { Text } from "../../../shared/ui/Text";
import { taskStopText } from "../../../shared/model/taskStopSummary";
import { Heading } from "../../../shared/ui/Heading";
import { LiveText } from "../../../shared/ui/LiveText";
import { t, useLocale } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { useConfirm } from "../../../shared/ui/ConfirmDialog";
import { Pause, Play, Square, Trash2 } from "../../../shared/ui/icons";
import type { HostModelCatalog } from "../../connections/model/protocol";
import type { CrewDefinition } from "../model/crew";
import type { CrewRunView } from "../model/crewClient";
import type { CrewActionError } from "../model/crewActionError";
import { FailureAlert } from "./FailureAlert";
import {
  crewActivityKnown,
  crewCanStop,
  crewHasRunningWork,
  crewProgressLabel,
  crewRequestInfo,
} from "../model/crewPresentation";
import { crewRunTitle } from "../model/crewRoster";
import { CrewWorkOwnerActions, type CrewOwnerTools } from "./CrewWorkOwnerActions";
import { CrewWorkSessions } from "./CrewWorkSessions";
import { CrewWorkSummary } from "./CrewWorkSummary";
import { CrewWorkTimeline } from "./CrewWorkTimeline";
import { CrewWorkTeam } from "./CrewWorkTeam";
import { CrewWorkBadges } from "./CrewWorkState";

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
  coordinatorInline = false,
  stopRequested = false,
  ownerTools,
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
  error?: CrewActionError;
  canOpen: boolean;
  canDelete: boolean;
  /** The lead's conversation is already shown inline above, so its session row is left out. */
  coordinatorInline?: boolean;
  /** The owner stopped this work in this dialog; the lead may still be cancelling. */
  stopRequested?: boolean;
  /** Host access for the owner actions; without it they stay hidden. */
  ownerTools?: CrewOwnerTools;
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
  // The pressed buttons carry their own pending label; only a stop already sent (button hidden)
  // keeps a line naming it while the cancellation settles.
  const pendingText =
    stopping && running && pendingAction !== `stop:${run.id}` ? t("Stopping…") : "";
  const openCoordinator = (key: string) => ({
    label: key.startsWith("answer:") ? t("Answer") : t("Open session"),
    disabled: !run.coordinatorSessionId || !canOpen || pending,
    pending: pendingAction === `open:${key}`,
    onClick: () => run.coordinatorSessionId && onOpen(run.coordinatorSessionId, key),
  });
  return (
    <section data-crew-run={run.id} aria-label={title} className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <Heading
          size="section"
          level={3}
          className="min-w-0 flex-1 basis-56 break-words [overflow-wrap:anywhere]"
        >
          {title}
        </Heading>
        {run.status !== "finished" ? (
          <div className="flex shrink-0 flex-wrap items-center gap-1">
            {pendingText ? <LiveText text={pendingText} className="me-1" /> : null}
            <Button
              variant={run.status === "paused" ? "primary" : "secondary"}
              size="sm"
              disabled={pending}
              loading={pendingAction === `pause:${run.id}`}
              loadingLabel={run.status === "paused" ? t("Resuming…") : t("Pausing…")}
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
              {run.status === "paused" ? t("Resume") : t("Pause")}
            </Button>
            {canStop ? (
              <Button
                variant="ghost"
                tone="danger"
                size="sm"
                disabled={pending}
                loading={pendingAction === `stop:${run.id}`}
                loadingLabel={t("Stopping…")}
                startIcon={<Square className="icon-sm" />}
                label={t("Stop work")}
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
                {t("Stop")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <CrewWorkBadges run={run} size="md" />
        <Text className="tabular-nums">{crewProgressLabel(run)}</Text>
      </div>
      {request.kind === "full" && request.text !== title ? (
        <Text
          as="p"
          size="secondary"
          className="mt-2 max-h-32 max-w-184 overflow-y-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
        >
          {request.text}
        </Text>
      ) : null}
      <CrewWorkSummary run={run} />
      {/* What needs the owner comes first: decisions, acceptance and blockers lead the actions. */}
      {requests.length || blocked.length || awaiting.length ? (
        <div className="mt-3 flex flex-col gap-2">
          {requests.map((message) => (
            <Alert key={message.id} tone="warning" action={openCoordinator(`answer:${message.id}`)}>
              <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                {t("Needs decision: {p0}", { p0: message.text })}
              </p>
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
                {t("Blocked: {p0}", { p0: taskStopText(task) ?? task.title })}
              </p>
            </Alert>
          ))}
        </div>
      ) : null}
      {error ? (
        <div className="pt-3">
          <FailureAlert title={error.title} detail={error.detail} />
        </div>
      ) : null}
      {run.error ? (
        <div className="pt-3">
          <FailureAlert tone="warning" title={t("Work stopped with an error")} detail={run.error} />
        </div>
      ) : null}
      <CrewWorkSessions
        run={run}
        catalog={catalog}
        canOpen={canOpen}
        pending={pending}
        pendingAction={pendingAction}
        coordinatorInline={coordinatorInline}
        onOpen={onOpen}
      />
      <CrewWorkTeam run={run} savedCrew={savedCrew} />
      {ownerTools ? <CrewWorkOwnerActions run={run} tools={ownerTools} /> : null}
      <CrewWorkTimeline run={run} />
      {canDelete ? (
        <div className="mt-5">
          <Button
            variant="ghost"
            tone="danger"
            size="sm"
            disabled={pending || !canRemove}
            loading={pendingAction === `delete:${run.id}`}
            loadingLabel={t("Deleting…")}
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
