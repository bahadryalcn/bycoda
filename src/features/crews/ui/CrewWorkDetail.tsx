import { Text } from "../../../shared/ui/Text";
import { useState } from "react";
import { Heading } from "../../../shared/ui/Heading";
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
} from "../model/crewPresentation";
import { crewRunTitle } from "../model/crewRoster";
import { composerDefaultMember } from "../model/crewComposer";
import { CrewWorkOwnerActions, type CrewOwnerTools } from "./CrewWorkOwnerActions";
import { CrewWorkSessions } from "./CrewWorkSessions";
import { CrewWorkSummary } from "./CrewWorkSummary";
import { CrewWorkTeam } from "./CrewWorkTeam";
import { CrewWorkTimeline, crewUsageText } from "./CrewWorkTimeline";
import { crewRunUsage } from "../model/crewUsage";
import { CrewWorkBadges, CrewWorkUpdated } from "./CrewWorkState";

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
  error?: string;
  canOpen: boolean;
  canDelete: boolean;
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
  const [target, setTarget] = useState(() => composerDefaultMember(run));
  const spent = crewUsageText(crewRunUsage(run).total);
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
            {pendingText ? (
              <Text role="status" className="me-1">
                {pendingText}
              </Text>
            ) : null}
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
              {run.status === "paused" ? t("Resume") : t("Pause")}
            </Button>
            {canStop ? (
              <Button
                variant="ghost"
                tone="danger"
                size="sm"
                disabled={pending}
                loading={pendingAction === `stop:${run.id}`}
                startIcon={<Square className="icon-sm" />}
                label={t("Stop work")}
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
                {t("Stop")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <CrewWorkBadges run={run} size="md" />
        <Text className="tabular-nums">{crewProgressLabel(run)}</Text>
        <CrewWorkUpdated value={run.updatedAt} />
        {spent && run.status !== "finished" ? <Text className="tabular-nums">{spent}</Text> : null}
      </div>
      {request.kind === "full" && request.text !== title ? (
        <Text
          as="p"
          size="secondary"
          className="mt-2 max-h-32 max-w-[46rem] overflow-y-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
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
              {crewMessageMayBeClipped(message.text) ? (
                <Text as="p" tone="inherit" className="mt-1">
                  {t("Showing the first {p0} characters of this message.", {
                    p0: CREW_LIST_MESSAGE_LIMIT,
                  })}
                </Text>
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
      <CrewWorkTeam
        run={run}
        catalog={catalog}
        savedCrew={savedCrew}
        pickedId={target}
        onPick={ownerTools && run.status !== "finished" ? setTarget : undefined}
      />
      {ownerTools ? (
        <CrewWorkOwnerActions
          run={run}
          tools={ownerTools}
          memberId={target}
          onMemberChange={setTarget}
        />
      ) : null}
      <CrewWorkTimeline run={run} />
      {canDelete ? (
        <div className="mt-5">
          <Button
            variant="ghost"
            tone="danger"
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
