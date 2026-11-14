import { LoadingText } from "../../../shared/ui/LoadingText";
import { FailureState } from "../../../shared/ui/FailureState";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import {
  canRetryRoomPrivacyProjection,
  rebuildClosedRoomPrivacyProjection,
  recoverRoomPrivacyProjection,
  getRoomPrivacyStatus,
  isRoomPrivacyRecoveryPending,
  subscribeRoomPrivacyStatus,
} from "../../group-lock/model/roomPrivacyProjection";
import { isAppQuitting } from "../../../app/model/appLifecycle";
import { MemoryEditor } from "./MemoryEditor";
import { useSyncExternalStore } from "react";
import sessionStyles from "./AssistantSessions.module.css";
import { AssistantSettings } from "./AssistantSettings";
import historyStyles from "./AssistantHistory.module.css";
import noteStyles from "./AssistantNoteCard.module.css";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Heading } from "../../../shared/ui/Heading";
import { Alert } from "../../../shared/ui/Alert";
import { StatusDot } from "../../../shared/ui/StatusDot";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { LiveText } from "../../../shared/ui/LiveText";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import {
  MoreHorizontal,
  Settings,
  Play,
  Square,
  Trash2,
  RefreshCw,
  X,
  ChevronDown,
} from "../../../shared/ui/icons";
import { assistantRequest as ownerRequest } from "../model/assistantClient";
import { AssistantPresenceStatus } from "./AssistantPresenceStatus";
import { useVisibleProjects } from "../../group-lock/hooks/useGroupLock";
import { isProjectLocked } from "../../group-lock/model/groupLock";
import { assistantJobVisible } from "../model/assistantJobs";
import { AssistantSetup } from "./AssistantSetup";
import styles from "./AssistantView.module.css";
import shell from "./room/RoomShell.module.css";
import { type AssistantViewProps } from "./room/assistantRoomHelpers";
import { RoomNavigation } from "./room/RoomNavigation";
import { AssistantRoomContext, type AssistantRoom } from "./room/assistantRoomContext";
import { useAssistantRoomState } from "./room/useAssistantRoomState";
import { useAssistantRoomJobs } from "./room/useAssistantRoomJobs";
import { RoomStatusPopovers } from "./room/RoomStatusPopovers";
import { CollectionToolbar } from "./room/CollectionToolbar";
import { TodayTab } from "./room/TodayTab";
import { JobsTab } from "./room/JobsTab";
import { SessionsTab } from "./room/SessionsTab";
import { NotesTab } from "./room/NotesTab";
import { HistoryTab } from "./room/HistoryTab";
import { MemoryTab } from "./room/MemoryTab";
import { RoomUndoBars } from "./room/RoomUndoBars";
import { JobDetailDialog } from "./room/JobDetailDialog";
import { JobReviewDialog } from "./room/JobReviewDialog";
import { JobOwnerEditDialog } from "./room/JobOwnerEditDialog";
import { ConversationPanel } from "./room/ConversationPanel";
import { TrashPanel } from "./room/TrashPanel";
import { AssistantAvatarMark } from "./AssistantAvatar";

export type { AssistantViewProps };

export function AssistantView(props: AssistantViewProps) {
  const roomPrivacy = useSyncExternalStore(
    subscribeRoomPrivacyStatus,
    getRoomPrivacyStatus,
    getRoomPrivacyStatus,
  );
  const core = useAssistantRoomState(props, {
    roomPrivacy,
    useVisibleProjects,
    isProjectLocked,
  });
  // Retry only when the privacy projection can settle it; otherwise the reason stands alone.
  // A failed recovery republishes its reason through the privacy status store.
  const retryPrivacy =
    roomPrivacy.error && canRetryRoomPrivacyProjection()
      ? () => void recoverRoomPrivacyProjection().catch(() => undefined)
      : undefined;
  const jobs = useAssistantRoomJobs(core);
  const room: AssistantRoom = { ...core, ...jobs, isAppQuitting };
  const {
    environmentId,
    assistantRequest,
    projectReadError,
    readProjects,
    projects,
    privacy,
    snapshot,
    visibility,
    canSeeProject,
    identity,
    view,
    setView,
    setup,
    setSetup,
    returnMessage,
    settings,
    setSettings,
    trash,
    setTrash,
    menu,
    setMenu,
    healthAnchor,
    setHealthAnchor,
    presenceAnchor,
    setPresenceAnchor,
    query,
    setQuery,
    setFilter,
    jobEdit,
    setJobEdit,
    pending,
    stopping,
    error,
    confirm,
    confirmPrivacy,
    setConfirm,
    undo,
    deletedNoteWithoutReceipt,
    setRestoredUndoId,
    setDetail,
    memoryEdit,
    setMemoryEdit,
    manual,
    defaultProjectId,
    mutate,
    stopEverything,
    onOpenSession,
    canonicalSnapshot,
    loading,
    readError,
    refresh,
    active,
    workingJobs,
    errorFor,
  } = room;

  const mode = snapshot
    ? snapshot.paused
      ? { label: t("Paused"), tone: "warning" as const }
      : workingJobs.length
        ? { label: t("Working"), tone: "info" as const }
        : snapshot.usage.mode === "report"
          ? { label: t("Report only"), tone: "secondary" as const }
          : active.some((job) => job.status === "waiting")
            ? { label: t("Waiting for you"), tone: "warning" as const }
            : { label: t("Ready"), tone: "success" as const }
    : { label: "", tone: "secondary" as const };

  const sameReadError =
    Boolean(readError && projectReadError) &&
    (projectReadError === readError || t(projectReadError) === readError);

  return (
    <AssistantRoomContext.Provider value={room}>
      <main
        {...surfaceAttributes({ variant: "canvas-chat" }, shell.room)}
        aria-label={identity.room}
      >
        <LiveText
          className="sr-only"
          mode="assertive"
          text={error?.text || readError || projectReadError || ""}
        />
        <LiveText
          className="sr-only"
          text={
            pending?.label ||
            returnMessage ||
            (undo
              ? `${t("Deleted")}: ${undo.label}`
              : deletedNoteWithoutReceipt
                ? `${t("Deleted")}: ${deletedNoteWithoutReceipt}`
                : "")
          }
        />
        <header className={shell.header}>
          <div className={shell.identity}>
            <AssistantAvatarMark
              className={shell.avatar}
              value={snapshot?.profile.avatar}
              name={identity.name}
            />
            <Heading size="page" level={1} className={shell.name}>
              {identity.name || identity.title}
            </Heading>
            {snapshot?.profile.setupComplete && (
              <Button
                className={shell.mode}
                variant="ghost"
                label={t("Assistant status")}
                aria-haspopup="dialog"
                aria-expanded={Boolean(healthAnchor)}
                onClick={(event) => setHealthAnchor(event.currentTarget)}
              >
                <StatusDot tone={mode.tone} />
                {mode.label}
                <ChevronDown className="icon-xs" />
              </Button>
            )}
          </div>
          <div className={shell.actions}>
            {snapshot?.profile.setupComplete && (
              <>
                <Button
                  className={shell.presence}
                  variant="ghost"
                  label={t("Presence")}
                  aria-haspopup="dialog"
                  aria-expanded={Boolean(presenceAnchor)}
                  onClick={(event) => setPresenceAnchor(event.currentTarget)}
                >
                  <AssistantPresenceStatus
                    snapshot={snapshot}
                    compact
                    offline={Boolean(readError)}
                  />
                  <ChevronDown className="icon-xs" />
                </Button>
                <Button
                  variant={snapshot.paused ? "secondary" : "ghost"}
                  tone={snapshot.paused ? "neutral" : "danger"}
                  label={t(snapshot.paused ? "Resume work" : "Stop everything")}
                  startIcon={
                    snapshot.paused ? <Play className="icon-sm" /> : <Square className="icon-sm" />
                  }
                  disabled={snapshot.paused && Boolean(pending)}
                  loading={stopping || pending?.key === "pauseAll"}
                  onClick={() =>
                    snapshot.paused
                      ? void mutate("pauseAll", t("Updating..."), {
                          op: "resumeAll",
                        })
                      : void stopEverything()
                  }
                >
                  {t(snapshot.paused ? "Resume" : "Stop")}
                </Button>
              </>
            )}
            <Button
              iconOnly
              variant="ghost"
              label={t("Settings")}
              onClick={() => setSettings(true)}
              disabled={!snapshot}
            >
              <Settings className="icon-md" />
            </Button>
            <Button
              iconOnly
              variant="ghost"
              label={t("More options")}
              aria-haspopup="menu"
              aria-expanded={Boolean(menu)}
              onClick={(event) => setMenu(event.currentTarget)}
            >
              <MoreHorizontal className="icon-md" />
            </Button>
            {props.onClose && (
              <Button iconOnly variant="ghost" label={t("Close")} onClick={props.onClose}>
                <X className="icon-md" />
              </Button>
            )}
          </div>
        </header>
        {menu && (
          <DropdownMenu
            anchor={menu}
            label={t("Room options")}
            onClose={() => setMenu(null)}
            onPick={(id) => {
              setMenu(null);
              if (id === "trash") setTrash(true);
              else if (id === "refresh") void refresh();
              else setSetup(true);
            }}
            items={[
              {
                kind: "item",
                id: "refresh",
                label: t("Refresh"),
                icon: <RefreshCw className="icon-sm" />,
                disabled: loading,
              },
              {
                kind: "item",
                id: "trash",
                label: t("Recently deleted"),
                icon: <Trash2 className="icon-sm" />,
              },
              { kind: "item", id: "setup", label: t("Quick setup") },
            ]}
          />
        )}
        {roomPrivacy.error && (
          <Alert
            className={shell.notice}
            tone="danger"
            inline
            title={t("Room privacy protection could not be confirmed.")}
            action={
              retryPrivacy && (
                <Button variant="link" layout="text" onClick={retryPrivacy}>
                  {t("Retry")}
                </Button>
              )
            }
          >
            {t(roomPrivacy.error)}
          </Alert>
        )}
        {roomPrivacy.error &&
          (roomPrivacy.error === "Privacy lock state is unavailable" ||
            isRoomPrivacyRecoveryPending()) && (
            <div className={`${shell.notice} ${shell.noticeBody}`}>
              <InlineMessage tone="info">
                {t("Review current project visibility before rebuilding Room privacy protection.")}
              </InlineMessage>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  void rebuildClosedRoomPrivacyProjection().catch(() => {});
                }}
              >
                {t("Rebuild Room privacy protection")}
              </Button>
            </div>
          )}
        {readError && (
          <InlineError
            className={shell.notice}
            retry={{
              onRetry: () => {
                void refresh();
                // One shared failure shows once, so its Retry recovers both reads.
                if (sameReadError) void readProjects();
              },
              pending: loading,
            }}
          >
            {readError}
          </InlineError>
        )}
        {projectReadError && !sameReadError && (
          <InlineError className={shell.notice} retry={{ onRetry: () => void readProjects() }}>
            {t(projectReadError)}
          </InlineError>
        )}
        {error?.key.startsWith("navigation:") && (
          <InlineError className={shell.notice}>{error.text}</InlineError>
        )}
        {!snapshot ? (
          loading ? (
            <LoadingText className={shell.empty} delay={false}>
              {t("Loading...")}
            </LoadingText>
          ) : (
            <FailureState
              context="panel"
              className={shell.empty}
              description={t("Connect to the local Host to open this room.")}
            />
          )
        ) : !snapshot.profile.setupComplete ? (
          <section className={shell.setupPrompt}>
            <Heading size="section">{t("Set up your personal assistant")}</Heading>
            <p>{t("Choose a name, working permissions and a daily budget before starting.")}</p>
            <Button variant="primary" onClick={() => setSetup(true)}>
              {t("Set up")}
            </Button>
          </section>
        ) : (
          <>
            <RoomStatusPopovers snapshot={snapshot} />
            {errorFor("presence")}
            {errorFor("presence.return")}
            {returnMessage && (
              <Text
                as="p"
                size="caption"
                tone="secondary"
                leading="inherit"
                className={shell.muted}
              >
                {returnMessage}
              </Text>
            )}
            {errorFor("pauseAll")}
            {snapshot.chiefReview?.blocked && (
              <Alert
                className={shell.notice}
                tone="warning"
                inline
                title={t("Supervisor review needs attention")}
                action={
                  <Button
                    disabled={Boolean(pending)}
                    loading={pending?.key === "chief.retry"}
                    onClick={() =>
                      snapshot.profile.autonomy === "chief"
                        ? void mutate("chief.retry", t("Updating..."), {
                            op: "chief.retry",
                          })
                        : setSettings(true)
                    }
                  >
                    {t(snapshot.profile.autonomy === "chief" ? "Retry review" : "Settings")}
                  </Button>
                }
              >
                {snapshot.chiefReview.message}
              </Alert>
            )}
            {errorFor("chief.retry")}
            <div {...surfaceAttributes({ frame: "pane", edge: "block-end" }, shell.tabRow)}>
              <RoomNavigation
                view={view}
                activeJobs={active.length}
                onChange={(value) => {
                  setView(value);
                  setQuery("");
                  setFilter("");
                }}
              />
            </div>
            <section
              id="assistant-content"
              className={`${styles.content} ${view === "Sessions" ? sessionStyles.workspace : ""} ${view === "History" ? historyStyles.workspace : ""} ${view === "Notes" ? noteStyles.page : ""}`}
              data-view={view}
              aria-label={t(view)}
            >
              {(view === "Today" || view === "Jobs") && snapshot.workHoursActive === false && (
                <Text
                  as="p"
                  size="micro"
                  tone="secondary"
                  leading="inherit"
                  className={styles.muted}
                >
                  {t("Outside working hours. Accepted turns can finish; new work waits.")}
                </Text>
              )}
              {view === "History" && (
                <header className={historyStyles.heading}>
                  <Heading size="page">{t("What I did")}</Heading>
                  <span>{snapshot.activity.length}</span>
                </header>
              )}
              {view === "Sessions" && (
                <div className={sessionStyles.pageHeading}>
                  <Heading size="page">{t("Sessions")}</Heading>
                </div>
              )}
              {!(view === "Notes" && room.noteEdit) && <CollectionToolbar snapshot={snapshot} />}
              {view === "Today" && (
                <TodayTab snapshot={snapshot} jobs={<JobsTab snapshot={snapshot} />} />
              )}
              {view === "Jobs" && <JobsTab snapshot={snapshot} />}
              {view === "Conversations" && (
                <ConversationPanel
                  key={privacy.key}
                  request={assistantRequest}
                  environmentId={environmentId}
                  snapshot={{
                    ...snapshot,
                    threads: snapshot.threads.filter((thread) => thread.purpose !== "job-planning"),
                  }}
                  source={canonicalSnapshot!}
                  privacy={privacy}
                  canSeeProject={canSeeProject}
                  projectId={defaultProjectId}
                  projects={projects}
                  sessionId={props.sessionId}
                  query={query}
                  onOpenSession={onOpenSession}
                  onJob={setDetail}
                  isAppQuitting={isAppQuitting}
                />
              )}
              {view === "Sessions" && <SessionsTab snapshot={snapshot} />}
              {view === "Notes" && <NotesTab snapshot={snapshot} />}
              {view === "History" && <HistoryTab snapshot={snapshot} />}
              {view === "Memory" && <MemoryTab snapshot={snapshot} />}
            </section>
          </>
        )}
        <RoomUndoBars />
        {jobEdit &&
          jobEdit.environmentId === environmentId &&
          jobEdit.scopeKey === privacy.key &&
          assistantJobVisible(jobEdit.job, canSeeProject) && (
            <JobOwnerEditDialog
              key={`${jobEdit.environmentId}:${jobEdit.job.id}:${jobEdit.mode}`}
              job={jobEdit.job}
              mode={jobEdit.mode}
              environmentId={jobEdit.environmentId}
              request={ownerRequest}
              current={() =>
                visibility.current.privacy.key === jobEdit.scopeKey &&
                assistantJobVisible(jobEdit.job, canSeeProject)
              }
              onClose={() => setJobEdit(null)}
              onSaved={() => {
                void refresh();
                setJobEdit(null);
              }}
            />
          )}
        {setup && <AssistantSetup voice={setup === "voice"} onClose={() => setSetup(false)} />}
        {settings && snapshot && (
          <AssistantSettings
            request={assistantRequest}
            environmentId={environmentId}
            snapshot={snapshot}
            manual={manual}
            projects={projects}
            onClose={() => setSettings(false)}
            onSetup={() => {
              setSettings(false);
              setSetup(true);
            }}
          />
        )}
        {trash && snapshot && (
          <TrashPanel
            key={privacy.key}
            request={assistantRequest}
            entries={snapshot.trash}
            onRestored={(id) => setRestoredUndoId({ id, environmentId })}
            onClose={() => setTrash(false)}
          />
        )}
        {memoryEdit && (
          <MemoryEditor
            request={assistantRequest}
            entry={memoryEdit}
            onClose={() => setMemoryEdit(null)}
          />
        )}
        {confirm && confirmPrivacy.current === privacy.key && (
          <ConfirmDialog request={confirm} onSettle={() => setConfirm(null)} />
        )}
        <JobDetailDialog />
        <JobReviewDialog />
      </main>
    </AssistantRoomContext.Provider>
  );
}
