import { Text } from "../../../shared/ui/Text";
import { setSessions } from "../../sessions/public/sessionsStore";
import { modelDisplayName } from "../../sessions/public/modelDisplayName";
import { Alert } from "../../../shared/ui/Alert";
import { Toast } from "../../../shared/ui/ToastRegion";
import { useConnectionErrorShownCentrally } from "../../../shared/ui/connectionErrorGate";
import { Button } from "../../../shared/ui/Button";
import { ErrorDetails, fitsOneLine } from "../../../shared/ui/ErrorDetails";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { RemoteSessionFrame, RemoteSessionContent } from "./RemoteSessionFrame";
import { FailureState } from "../../../shared/ui/FailureState";
import { MachineUnavailable } from "./MachineUnavailable";
import { isApprovalOccurrenceId } from "../../../shared/model/approvalOccurrence";
import { isLocalSyncMachine } from "../model/localSync";
import { machineLabel } from "../model/machineIdentity";
import {
  DEFAULT_PROVIDER_ACCOUNT_ID,
  sessionProviderAccountId,
  supportsProviderAccounts,
} from "../../providers/model/providerAccounts";
import {
  acknowledgeHostSessionBinding,
  hostExecutionProject,
  hostSessionBinding,
  saveHostSessionBinding,
  flushHostSessionBindings,
} from "../model/sessionExecutionBinding";
import { applyStreamSync, providerSteerCapability } from "../model/protocol";
import { mergePreviewBlocks } from "../model/mergePreviewBlocks";
import { resolveQuestionDraft } from "../../sessions/public/questionDrafts";
import {
  submitApprovalIntent,
  observeRemoteApprovalResolutions,
  observeRemoteApprovalSourceExpansion,
} from "../../sessions/public/approvalIntents";
import type {
  UserQuestionDelivery,
  UserQuestionPrompt,
  SessionPaneProps,
  Attachment,
  Block,
  ComposerTurnOptions,
  HarnessId,
  Session,
  WorkspaceMode,
  PlanBuildTarget,
} from "../../sessions";
import { t, useLocale } from "../../../shared/i18n";
import { remotePendingRequestNotice, remoteQueueReadNotice } from "../model/remoteSessionNotice";
import { canonicalJson } from "../../sync/model/canonicalJson";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { RemoteOutboxNotice } from "./RemoteOutboxNotice";
import { RemoteDataStatus } from "./RemoteDataStatus";
import type { RemoteDataState } from "../model/remoteDataState";
import {
  remoteIntentAuthority,
  remoteIntentAuthorityMatches,
  useDurableRemoteOutboxIssues,
  readDurableRemoteCommand,
  admitDurableRemoteCommand,
  readDurableRemoteEntry,
  remoteOutcomeUnknownMessage,
  remoteRequestPastRetryLimit,
  markDurableRemoteCommandStopped,
  settleDurableRemoteCommand,
  subscribeOutbox,
} from "../model/remoteOutbox";
import { uploadRemoteAttachments } from "../model/remoteAttachments";
import { uploadQuestionAttachments } from "../model/remoteQuestionAttachments";
import {
  assertDesktopControlReceipts,
  requiresDesktopControlReceipts,
} from "../model/desktopControlCapability";
import {
  ATTACHMENT_OWNERSHIP_CAPABILITY,
  attachmentOwnerId,
  attachmentOwnershipScope,
  retryAttachmentOwnershipReleases,
} from "../model/attachmentOwnership";
import { getComposerAttachments, subscribeComposerDrafts } from "../../sessions/public/draftCache";
import { deleteRemotePageCache, flushRemotePageCache } from "../model/remotePageCache";
import { canApplyRemotePreview } from "../model/remotePreviewBinding";
import { createRemoteHistoryGeneration } from "../model/remoteHistoryGeneration";
import {
  beginSessionPerformanceTrace,
  sessionPerformanceTrace,
  startPerformanceSpan,
  recordPerformanceEvent,
} from "../../../shared/lib/performanceTrace";
import { prepareSessionWorkspace } from "../../workspaces/model/sessionWorkspace";
import { applyWorkspaceRewind, planWorkspaceRewind } from "../../workspaces/model/rewindClient";
import {
  clearWorkspaceRewindUndo,
  requestWorkspaceRewindPreview,
  registerWorkspaceRewindUndoHandler,
  type WorkspaceRewindUndoIdentity,
} from "../../workspaces/ui/WorkspaceRewindPreview";
import { RemoteBindingGeneration } from "../model/remoteBindingGeneration";
import { useRemoteModelCatalog } from "../model/useRemoteModelCatalog";
import { remoteSessionPollDelay } from "../model/remotePollingPolicy";
import {
  MachineChannelStreamError,
  subscribeRemoteMachineChannel,
} from "../model/remoteMachineChannel";
import { ModelSourceContext, type ModelSource } from "../../sessions/public/modelSource";
import {
  cachedDescriptors,
  cachedSessionSnapshots,
  rememberSessionSnapshot,
  snapshotKey,
} from "../model/remoteSessionSnapshotCache";
import { buildRemoteModelSource } from "../model/remoteModelSource";
import type { Configuration, OptimisticTurn } from "../model/remoteSessionTypes";
import { notifyGitChanged } from "../../../platform/tauri/fs";
import { boundedSet } from "../../../shared/lib/store";
import type { Worktree } from "../../source-control";
import { useProjectBranchesState } from "../../source-control/public/useProjectBranches";
import {
  registerRemoteSessionActions,
  publishRemoteSessionActionSource,
} from "../model/remoteSessionActions";
import {
  HOST_UPDATE_NOTICE,
  SESSION_PROVIDER_ACCOUNT,
  SESSION_REWIND,
  SESSION_SHELL,
} from "../model/remoteCapabilities";
import { canRewindConversation } from "../../sessions/public/conversationRewind";
import { parseShellCommand, SHELL_FOLLOW_UP_PROMPT } from "../../sessions/public/shellRun";
import { loadResumeAtReset } from "../../settings/public/settings";
import {
  cachedRemoteSessionIds,
  loadRemoteBlock,
  loadRemoteHistoryPage,
  loadRemoteSession,
  rememberRemotePendingWorktree,
  rememberRemoteSession,
  REMOTE_TAB_BINDING_CHANGE,
  remoteRequest,
  reportRemoteMachineStatus,
  remotePendingWorktree,
  remoteSessionFor,
  remoteShellBoundTo,
  sessionAccessForMachine,
  sessionExecutionClientForMachine,
  useRemoteMachines,
} from "../model/connections";
import { beginRemoteCreate, endRemoteCreate } from "../model/remoteCreateIntent";
import { blocksSending, needsSignIn, sendAfterReconnect } from "../model/remoteConnection";
import {
  CONTINUE_PROMPT,
  RESUME_PROMPT,
  usageLimitAfterTargetChange,
} from "../../sessions/public/inFlight";
import { consumeOperatorCommand } from "../../sessions/public/operatorCommand";
import { sameQueuedModelTarget } from "../../sessions/public/messageQueue";
import {
  canEnqueueRemoteMessage,
  nextRemoteQueuedMessage,
  queueSessionFields,
  shouldQueueRemoteMessage,
  leaseRetryDelay,
  type RemoteQueueDraft,
} from "../model/remoteQueue";
import { followUpRefusalEvent, steerWaitReason, type QueueEvent } from "../model/queueState";
import { isLeaseHeld } from "../../sync/model/runLease";
import { remoteTurnInterrupted } from "../model/remoteRecovery";
import { forgetRemoteQueue } from "../model/useRemoteQueue";
import { useAttachmentOwnerReconcile } from "../model/useAttachmentOwnerReconcile";
import { useQueuedSendDrain } from "../model/useQueuedSendDrain";
import { useRemotePageCacheRestore } from "../model/useRemotePageCacheRestore";
import { useSharedRemoteQueue } from "../model/useSharedRemoteQueue";
import {
  registerDeliveryResolver,
  requestDeliveryReview,
} from "../../sessions/public/deliveryReview";
import { useRemoteRecovery } from "../model/useRemoteRecovery";
import {
  recordRemoteConnection,
  reportRemoteConnection,
  subscribeRemoteRecovered,
  TIMEOUTS_BEFORE_UNREACHABLE,
} from "../model/remoteHealth";
import { useRemoteConnection } from "../model/useRemoteConnection";
import {
  classifyRemoteError,
  describeRemoteError,
  isConnectionFailure,
  isTransientTransportError,
  remoteErrorText,
} from "../model/remoteFailure";
import { errorText } from "../../../shared/lib/errors";
import { useGracedFailure } from "../model/transientFailure";
import {
  classifyCommandFailure,
  COMMAND_RETRY_AUTOMATIC_LIMIT,
  createCommandRetryBackoff,
  type CommandFailureClass,
  type CommandRetryBackoff,
} from "../model/remoteCommandRetry";
import { RemoteConnectionNotice } from "./RemoteConnectionFeedback";
import {
  parseRemotePath,
  remotePath,
  verifyRemoteProjectAlias,
  type RemoteProject,
} from "../model/remoteProjects";
import { carryModelSettings, findRemoteModel, sameModelSettings } from "../model/remoteModels";
import {
  isRemoteProvider,
  REMOTE_PROVIDERS,
  requireHostDescriptor,
  type CommandReceipt,
  type HostCommand,
  type HostDescriptor,
  type HostSession,
  type RemoteAttachment,
  type RemoteMachine,
  type RemoteProvider,
} from "../model/protocol";
import { newRequestId } from "../../../shared/lib/id/requestId";
import { SessionMachinePicker } from "./SessionMachinePicker";
import { hasForeignMachineAttachment, remoteSessionProject } from "../model/sessionMachineTarget";
import { PROJECTLESS_SESSIONS_CAPABILITY } from "../../../shared/model/host-contracts/projectless-sessions";

export type RemoteSessionOverrides = Partial<SessionPaneProps> & {
  remoteSession: boolean;
  remoteFeatures: {
    attachments: boolean;
    questionAttachments?: boolean;
    plan: boolean;
    draft: boolean;
    steer?: boolean;
  };
  remoteSessionLoading: boolean;
  remoteSessionStarted: boolean;
  remoteSessionRetargetBlocked?: boolean;
  managedWorkspaceCreationReady: boolean;
  headerStatus?: ReactNode;
  /** The host recorded that this chat's last turn was lost; Continue is offered. */
  interruptedTurn: boolean;
  sendBlockedReason?: string;
  allowedModelHarnesses: readonly HarnessId[];
};

const noop = () => {};
/** A tab in a project on another machine. The host owns the session; this
 * renders the normal session pane with actions routed to the host. */
export function RemoteSession({
  shell,
  visible,
  onSnapshot,
  onOpenFile,
  onOpenDiff,
  onOpenPlan,
  onSelectMachine,
  render,
  compactPresentation = false,
}: {
  /** The tab's local session, which provides its ID and new-session defaults. */
  shell: Session;
  visible: boolean;
  onSnapshot?: (shellId: string, snapshot?: HostSession) => void;
  onOpenFile: SessionPaneProps["onOpenFile"];
  onOpenDiff: SessionPaneProps["onOpenDiff"];
  onOpenPlan: SessionPaneProps["onOpenPlan"];
  onSelectMachine?: (environmentId: string | undefined) => void;
  render: (overrides: RemoteSessionOverrides) => ReactNode;
  compactPresentation?: boolean;
}) {
  useLocale();
  const owner = hostSessionBinding(shell);
  const project = hostExecutionProject(shell) ?? remoteSessionProject(shell);
  const { machines, loaded } = useRemoteMachines(!!project);
  const machine = project
    ? machines.find(
        (entry) =>
          entry.environmentId === project.environmentId &&
          (!owner || (entry.id === owner.machineId && isLocalSyncMachine(entry))),
      )
    : undefined;
  if (!project)
    return (
      <FailureState
        context={compactPresentation ? "list" : "page"}
        role="status"
        description={t(
          "This project’s machine details are missing. Add the project again from the project rail.",
        )}
      />
    );
  if (!machine)
    return loaded ? (
      <div className="flex h-full flex-col">
        {onSelectMachine ? (
          <div className="p-2">
            <SessionMachinePicker
              environmentId={project.environmentId}
              onSelect={remoteSessionFor(shell.id) || owner ? undefined : onSelectMachine}
            />
          </div>
        ) : null}
        <MachineUnavailable
          cwd={project.key}
          reason="not-added"
          size={compactPresentation ? "panel" : "page"}
        />
      </div>
    ) : (
      <LoadingText>{t("Connecting to the machine…")}</LoadingText>
    );
  return (
    <DurableRemoteSessionGate
      key={`${machine.id}:${project.key}:${shell.id}`}
      shell={shell}
      visible={visible}
      onSnapshot={onSnapshot}
      onOpenFile={onOpenFile}
      onOpenDiff={onOpenDiff}
      onOpenPlan={onOpenPlan}
      machine={machine}
      hostLabel={machineLabel(machines, machine)}
      project={project}
      render={render}
      compactPresentation={compactPresentation}
    />
  );
}
function DurableRemoteSessionGate(props: Parameters<typeof ConnectedRemoteSession>[0]) {
  const { project, machine, shell, compactPresentation } = props;
  const [state, setState] = useState<{ ready: boolean; pending?: HostCommand; error?: string }>({
    ready: false,
  });
  const [attempt, setAttempt] = useState(0);
  const issues = useDurableRemoteOutboxIssues(project.key, machine.environmentId);
  useEffect(() => {
    let active = true;
    void flushHostSessionBindings()
      .then(() => {
        const owner = hostSessionBinding(shell);
        const session = owner?.created ? owner.sessionId : remoteSessionFor(shell.id);
        return readDurableRemoteCommand(
          project.key,
          machine.environmentId,
          session ?? null,
          shell.id,
        );
      })
      .then((result) => {
        if (active) setState({ ready: true, pending: result.command });
      })
      .catch((error: unknown) => {
        if (active) setState({ ready: false, error: errorText(error) });
      });
    return () => {
      active = false;
    };
  }, [project.key, machine.environmentId, shell.id, attempt]);
  const retry = () => (setState({ ready: false }), setAttempt((value) => value + 1));
  const review = t("Saved requests need review before continuing.");
  if (!state.ready)
    return (
      <div
        className={
          compactPresentation ? "flex flex-col gap-2 p-2" : "flex h-full flex-col gap-3 p-4"
        }
      >
        {state.error ? (
          <>
            {issues.length ? (
              <RemoteOutboxNotice project={project.key} environment={machine.environmentId} />
            ) : (
              <Alert
                tone="warning"
                action={{ label: t("Retry"), onClick: retry }}
                extra={
                  fitsOneLine(state.error) ? undefined : (
                    <ErrorDetails title={review} detail={state.error} />
                  )
                }
              >
                {fitsOneLine(state.error) ? `${review} ${state.error}` : review}
              </Alert>
            )}
            {issues.length ? (
              <div>
                <Button onClick={retry}>{t("Retry")}</Button>
              </div>
            ) : null}
          </>
        ) : (
          <LoadingText>{t("Checking saved requests…")}</LoadingText>
        )}
      </div>
    );
  return <ConnectedRemoteSession {...props} initialDurablePending={state.pending} />;
}
function ConnectedRemoteSession({
  shell,
  visible,
  onSnapshot,
  onOpenFile,
  onOpenDiff,
  onOpenPlan,
  machine,
  hostLabel,
  project,
  render,
  initialDurablePending,
  compactPresentation,
}: {
  shell: Session;
  visible: boolean;
  onSnapshot?: (shellId: string, snapshot?: HostSession) => void;
  onOpenFile: SessionPaneProps["onOpenFile"];
  onOpenDiff: SessionPaneProps["onOpenDiff"];
  onOpenPlan: SessionPaneProps["onOpenPlan"];
  machine: RemoteMachine;
  /** The machine name, with its address when another machine shares the name. */
  hostLabel: string;
  project: RemoteProject;
  render: (overrides: RemoteSessionOverrides) => ReactNode;
  initialDurablePending?: HostCommand;
  compactPresentation?: boolean;
}) {
  useLocale();
  const visibleRef = useRef(visible),
    owner = hostSessionBinding(shell);
  const projectless = shell.cwd === "~" && !!shell.remoteExecutionEnvironmentId;
  const consumedContextReplay = useRef<string | undefined>(undefined);
  const displayPath = (path: string) => (owner ? path : remotePath(machine.environmentId, path));
  const executionClient = sessionExecutionClientForMachine(
    machine.id,
    machine.environmentId,
    false,
    true,
  );
  const ownerRequest = <T,>(method: string, params: unknown = {}) =>
    remoteRequest<T>(machine.id, method, params, false, false, machine.environmentId);
  const wake = useRef<() => void>(() => {});
  useEffect(() => {
    visibleRef.current = visible;
    wake.current();
  }, [visible]);
  const [descriptor, setDescriptor] = useState<HostDescriptor | undefined>(() =>
    cachedDescriptors.get(machine.id),
  );
  const canSelectProviderAccount =
    descriptor?.capabilities.includes(SESSION_PROVIDER_ACCOUNT) === true;
  const [attachmentOwner] = useState(() => attachmentOwnerId("desktop-composer", shell.id));
  const ownsAttachments = !!descriptor?.capabilities.includes(ATTACHMENT_OWNERSHIP_CAPABILITY);
  const ownership = useMemo(
    () =>
      ownsAttachments
        ? attachmentOwnershipScope(
            machine.id,
            machine.environmentId,
            attachmentOwner,
            (method, params) => ownerRequest(method, params),
          )
        : undefined,
    [ownsAttachments, machine.id, machine.environmentId, attachmentOwner],
  );
  useEffect(() => {
    if (!ownership) return;
    // Restored drafts keep their references even before a new disk write occurs.
    void ownership
      .acquire(
        "draft",
        getComposerAttachments(shell.id).map((file) => file.id),
      )
      .catch(console.warn);
    return subscribeComposerDrafts((id) => {
      if (id === shell.id)
        void ownership
          .acquire(
            "draft-live",
            getComposerAttachments(shell.id).map((file) => file.id),
          )
          .catch(console.warn);
    });
  }, [ownership, shell.id]);
  const [online, setOnline] = useState(false);
  useEffect(() => {
    if (ownership && online)
      void retryAttachmentOwnershipReleases(machine.id, machine.environmentId, (method, params) =>
        ownerRequest(method, params),
      ).catch(console.warn);
  }, [ownership, online, machine.id, machine.environmentId]);
  const connection = useRemoteConnection(owner?.environmentId ?? project.key);
  const connectionIssueHandled =
    connection.status !== "connected" &&
    (connection.status !== "connecting" || connection.reconnecting);
  const [error, setError] = useState("");
  const [sessionId, setSessionId] = useState(() =>
    owner?.created ? owner.sessionId : remoteSessionFor(shell.id),
  );
  const remoteBindingKey = JSON.stringify([machine.id, machine.environmentId, sessionId]);
  // One writer (this component) owns the binding generation; reads and
  // operations capture its version/token and re-check before applying results.
  const [bindingGen] = useState(() => new RemoteBindingGeneration(sessionId, remoteBindingKey));
  bindingGen.track(remoteBindingKey);
  const boundOwner = useRef(`${machine.id}:${machine.environmentId}`);
  useEffect(() => {
    const changed = () => {
      const binding = hostSessionBinding(shell);
      const next = binding?.created ? binding.sessionId : remoteSessionFor(shell.id);
      const owner = `${machine.id}:${machine.environmentId}`;
      if (owner !== boundOwner.current) {
        boundOwner.current = owner;
        bindingGen.clearDeleted();
        setRemoteDeleted(false);
      }
      if (next !== bindingGen.session) {
        bindingGen.advance();
        historyPageRequest.current = null;
        forceTailRead.current = true;
        setPageCacheOnly(false);
        setRemoteHistoryLoading(false);
        bindingGen.bind(next);
        setStarting(undefined);
        setUnseenSend(undefined);
        setChanges(undefined);
        applied.current = undefined;
        setError("");
        contentRefreshInFlight.current = false;
        const cached = next ? cachedSessionSnapshots.get(snapshotKey(machine.id, next)) : undefined;
        publishRemoteDataState(
          cached ? { phase: "refreshing" } : next ? { phase: "loading" } : { phase: "empty" },
        );
        setRemovingDraft(undefined);
        preparingRef.current = false;
        setFollowUpPreparing(false);
        setUploadProgress(undefined);
        setSnapshot(next ? cachedSessionSnapshots.get(snapshotKey(machine.id, next)) : undefined);
      }
      setSessionId(next);
    };
    window.addEventListener(REMOTE_TAB_BINDING_CHANGE, changed);
    changed();
    return () => window.removeEventListener(REMOTE_TAB_BINDING_CHANGE, changed);
  }, [shell.id, machine.id, machine.environmentId]);
  const [snapshot, setSnapshot] = useState<HostSession | undefined>(() =>
    sessionId ? cachedSessionSnapshots.get(snapshotKey(machine.id, sessionId)) : undefined,
  );
  const [pageCacheOnly, setPageCacheOnly] = useState(false);
  const [remoteDeleted, setRemoteDeleted] = useState(false);
  // A cached transcript is shown while its first owner read is in flight; that
  // read is a refresh, and only its failure makes the content unverified.
  const [remoteDataState, setRemoteDataState] = useState<RemoteDataState>(() =>
    !sessionId
      ? { phase: "empty" }
      : cachedSessionSnapshots.has(snapshotKey(machine.id, sessionId))
        ? { phase: "refreshing" }
        : { phase: "loading" },
  );
  const remoteDataStateRef = useRef(remoteDataState);
  remoteDataStateRef.current = remoteDataState;
  const contentRefreshInFlight = useRef(false);
  const publishRemoteDataState = (next: RemoteDataState) => {
    remoteDataStateRef.current = next;
    setRemoteDataState(next);
  };
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const [remoteHistoryLoading, setRemoteHistoryLoading] = useState(false);
  const [remoteHistoryError, setRemoteHistoryError] = useState("");
  const historyPageRequest = useRef<{ revision: number; before?: number; binding: number } | null>(
    null,
  );
  const forceTailRead = useRef(false);
  const loadingRemoteBlocks = useRef(new Set<string>());
  const [refresh, setRefresh] = useState(0);
  const beginOwnerVerification = () => {
    contentRefreshInFlight.current = true;
    const current = remoteDataStateRef.current;
    publishRemoteDataState({
      phase: snapshotRef.current || current.updatedAt ? "refreshing" : "loading",
      error: isTransientTransportError(current.error) ? current.error : undefined,
      updatedAt: current.updatedAt,
    });
  };
  const refreshOwnerContent = () => {
    if (bindingGen.currentDeleted() || contentRefreshInFlight.current) return;
    beginOwnerVerification();
    setRefresh((value) => value + 1);
  };
  useRemotePageCacheRestore({
    environmentId: machine.environmentId,
    sessionId,
    hasSnapshot: () => !!snapshotRef.current,
    isDeleted: () => bindingGen.currentDeleted(),
    restore: (cached) => {
      // The disk projection has a clipped block window; invalidate any poll
      // closure that may have captured an earlier in-memory baseline.
      forceTailRead.current = true;
      snapshotRef.current = cached;
      setSnapshot(cached);
      setPageCacheOnly(true);
      publishRemoteDataState({ phase: "refreshing" });
    },
  });
  const {
    catalog,
    error: catalogError,
    loading: catalogLoading,
    refresh: refreshCatalog,
    retry: retryCatalog,
  } = useRemoteModelCatalog({
    scope: {
      machineId: machine.id,
      environmentId: machine.environmentId,
      projectId: projectless ? undefined : project.projectId,
    },
    enabled: !!descriptor && visible,
    hostEnvironmentId: descriptor?.environmentId,
    request: ownerRequest,
  });
  const [selectedCwd, setSelectedCwd] = useState(
    () => remotePendingWorktree(shell.id) ?? (owner ? shell.worktreeCwd : undefined) ?? project.cwd,
  );
  const [draftWorkspaceMode, setDraftWorkspaceMode] = useState<WorkspaceMode | undefined>(
    shell.workspaceMode,
  );
  // This identity survives preparation failures/reloads, before a create receipt
  // exists. Hosts advertising managedCreation validate it before binding ownership.
  const creationIdentityKey = `bycoda.managedCreate:${machine.environmentId}:${shell.id}`;
  const managedCreateId = () => {
    if (owner) return owner.sessionId;
    const existing = localStorage.getItem(creationIdentityKey);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(creationIdentityKey, id);
    return id;
  };
  const [draftWorktreeBase, setDraftWorktreeBase] = useState<string | undefined>(
    shell.worktreeBase,
  );
  const [sending, setSending] = useState(false);
  const [rewinding, setRewinding] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ offset: number; size: number }>();
  const sendingRef = useRef(false);
  const sendingOwner = useRef<symbol | undefined>(undefined);
  const rewindOwner = useRef<symbol | undefined>(undefined);
  const preparingRef = useRef(false);
  const [followUpPreparing, setFollowUpPreparing] = useState(false);
  const submissionGeneration = useRef(0);
  const preparingTurn = useRef<OptimisticTurn | undefined>(undefined);
  const [unseenSend, setUnseenSend] = useState<
    Pick<
      OptimisticTurn,
      | "commandId"
      | "text"
      | "startedAt"
      | "turnModel"
      | "attachments"
      | "draftBlockId"
      | "authorityGeneration"
    > & {
      sessionId: string;
      runId?: string;
    }
  >();
  // A first message waits here while its session is created on the host.
  const [starting, setStarting] = useState<OptimisticTurn & { failed?: boolean }>();
  const [pending, setPending] = useState(initialDurablePending);
  // Why the last Send was not taken; shown until the next one is.
  const [refusal, setRefusal] = useState("");
  const lastCommandFailure = useRef<{ commandId: string; kind: CommandFailureClass } | undefined>(
    undefined,
  );
  const commandFailureKind = (commandId: string) => {
    const failure = lastCommandFailure.current;
    return failure?.commandId === commandId ? failure.kind : undefined;
  };
  // Ticks that re-run the pending check: machine back, window focused, or backoff fired.
  const [recoveryTick, setRecoveryTick] = useState(0);
  const [focusTick, setFocusTick] = useState(0);
  const [retryTick, setRetryTick] = useState(0);
  const commandRetry = useRef<
    | {
        commandId: string;
        backoff: CommandRetryBackoff;
        running: boolean;
        stopped: boolean;
      }
    | undefined
  >(undefined);
  const [draft, setDraft] = useState<Configuration>(() => ({
    harness: isRemoteProvider(shell.harness) ? shell.harness : "codex",
    model: shell.model,
    settings: shell.modelSettings ?? {},
    mode: shell.runtimeMode,
    ...(owner && supportsProviderAccounts(shell.harness)
      ? {
          providerAccountId:
            sessionProviderAccountId(shell.harness, shell) === DEFAULT_PROVIDER_ACCOUNT_ID
              ? null
              : sessionProviderAccountId(shell.harness, shell),
        }
      : {}),
  }));
  // Changes to a started session, applied when it is idle.
  const [changes, setChanges] = useState<Configuration>();
  const failedAccountConfiguration = useRef<Configuration | undefined>(undefined);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    let generation = 0;
    const refresh = () => {
      const version = ++generation;
      void readDurableRemoteCommand(project.key, machine.environmentId, sessionId ?? null, shell.id)
        .then((result) => {
          if (active && version === generation) setPending(result.command);
        })
        .catch((reason: unknown) => {
          if (active && version === generation) setError(errorText(reason));
        });
    };
    const unsubscribe = subscribeOutbox(refresh);
    refresh();
    return () => {
      active = false;
      unsubscribe();
    };
  }, [project.key, machine.environmentId, sessionId]);

  const hostSession = snapshot && snapshot.session.id === sessionId ? snapshot.session : undefined;
  const questionDraftScope = `${shell.id}:${machine.id}:${sessionId ?? ""}`;
  const previousQuestions = useRef<{ scope: string; questions: UserQuestionPrompt[] } | undefined>(
    undefined,
  );
  useEffect(() => {
    if (!hostSession || pageCacheOnly) return;
    const questions = [
      ...(hostSession.submittedQuestions ?? []),
      ...(hostSession.pendingQuestion ? [hostSession.pendingQuestion] : []),
    ];
    const previous = previousQuestions.current;
    if (previous?.scope === questionDraftScope) {
      for (const question of previous.questions) {
        if (
          !questions.some(
            (current) =>
              current.requestId === question.requestId &&
              current.callId === question.callId &&
              current.providerTurnId === question.providerTurnId,
          )
        )
          resolveQuestionDraft(questionDraftScope, question);
      }
    }
    previousQuestions.current = { scope: questionDraftScope, questions };
  }, [hostSession, pageCacheOnly, questionDraftScope]);
  useEffect(() => {
    if (hostSession) rememberRemotePendingWorktree(shell.id);
  }, [hostSession?.id, shell.id]);
  const executionCwd = hostSession?.cwd ?? selectedCwd;
  const { branches } = useProjectBranchesState(displayPath(executionCwd), online && !projectless);
  const activeSessionId = hostSession?.id ?? sessionId;
  const hasHostBlock = (commandId: string) =>
    !!hostSession?.blocks.some((block) => block.id === commandId);
  const unseenActive =
    !!unseenSend && unseenSend.sessionId === activeSessionId && !hasHostBlock(unseenSend.commandId);
  const startingActive = !!starting && !starting.failed && !hasHostBlock(starting.commandId);
  const pendingSendActive =
    (pending?.type === "send" || pending?.type === "compact") &&
    pending.sessionId === activeSessionId &&
    !hasHostBlock(pending.commandId);
  const busy =
    (!!hostSession && snapshot?.status === "running") ||
    rewinding ||
    unseenActive ||
    (startingActive && !starting?.draft) ||
    pendingSendActive;
  const sharedQueueEnabled = !!descriptor?.capabilities.includes("sessions.queue");
  const queue = useSharedRemoteQueue(
    activeSessionId,
    machine.id,
    machine.environmentId,
    sharedQueueEnabled,
    // A turn started or ended: the queue is read now, not on the next timer. Not the
    // snapshot revision, which moves with every streamed flush.
    snapshot?.status ?? "",
  );
  // The inline delivered / send again / keep / discard choice of an unconfirmed row
  // decides through the shared queue of this host, not through a store that does not own it.
  const resolveDeliveryRef = useRef(queue.resolveDelivery);
  resolveDeliveryRef.current = queue.resolveDelivery;
  useEffect(
    () =>
      sharedQueueEnabled && activeSessionId
        ? registerDeliveryResolver(activeSessionId, (id, outcome) =>
            resolveDeliveryRef.current(id, outcome),
          )
        : undefined,
    [sharedQueueEnabled, activeSessionId],
  );
  useAttachmentOwnerReconcile({
    ownership,
    online,
    queueLoaded: queue.loaded,
    machineId: machine.id,
    environmentId: machine.environmentId,
    shellId: shell.id,
    projectKey: project.key,
    sharedQueueEnabled,
    activeSessionId,
    request: (method, params) => ownerRequest(method, params),
  });
  const reservedFollowUp = useRef<RemoteQueueDraft | undefined>(undefined);
  const followUpGeneration = useRef(0);
  // `desktop` records transcript synchronization, including host-created chats.
  // Older hosts identify a desktop-owned run with the reserved `desktop` run id.
  const desktopRun =
    snapshot?.status === "running" &&
    (snapshot.executionOwner === "desktop" ||
      (!snapshot.executionOwner && snapshot.runId === "desktop"));
  const remoteCanSteer =
    !desktopRun &&
    !!hostSession &&
    !!descriptor?.capabilities.includes(providerSteerCapability(hostSession.harness));
  // A removed draft leaves the transcript at once and returns if the host refuses.
  const [removingDraft, setRemovingDraft] = useState<string>();
  // An accepted turn stays on screen until a sync shows the host's copy, so
  // the transcript never drops it for a moment in between. What is shown is
  // already derived from the snapshot (`startingActive`, `unseenActive`,
  // `leavingDrafts`); the stored overlays are released here, during render and
  // not in an effect, the moment the snapshot confirms the block (or, for a
  // removed draft, no longer has it). Releasing is permanent on purpose: if a
  // later rewind drops the block again, the overlay must not come back as a
  // phantom message that keeps the chat busy. Failure paths clear their own
  // overlay in the handlers (`launch`, `run`, `removeDraft`, `discardSession`)
  // or keep it as `failed`, which this never touches.
  if (starting && !starting.failed && hasHostBlock(starting.commandId)) setStarting(undefined);
  if (removingDraft && !hostSession?.blocks.some((block) => block.id === removingDraft))
    setRemovingDraft(undefined);
  if (
    unseenSend &&
    hostSession?.id === unseenSend.sessionId &&
    hostSession.blocks.some((block) => block.id === unseenSend.commandId)
  )
    setUnseenSend(undefined);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let contentRetryTimer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribeChannel: (() => void) | undefined;
    const bindingKey = remoteBindingKey;
    let deletedOnHost = bindingGen.isDeleted(bindingKey);
    let controlChannelFailed = false;
    let failed = 0;
    let polling = false;
    let ownerReadPending = false;
    let ownerResetGeneration = 0;
    const historyGeneration = createRemoteHistoryGeneration();
    const token = bindingGen.capture(bindingKey, sessionId);
    const stale = () => disposed || bindingGen.isStale(token);
    // Every request carries the expected host identity; describe again only
    // after a failure, when the host may have been replaced.
    let described = false;
    const verifiedProjects = new Set([project.projectId]);
    const poll = async (application?: { isCurrent(): boolean }) => {
      if (disposed || bindingGen.isDeleted(bindingKey) || application?.isCurrent() === false)
        return;
      if (polling) {
        // A control hint can arrive while the initial tail or a delta is still
        // loading. Coalesce it into one follow-up read instead of losing it.
        ownerReadPending = true;
        return;
      }
      if (contentRetryTimer) {
        clearTimeout(contentRetryTimer);
        contentRetryTimer = undefined;
      }
      polling = true;
      let active = false;
      let readGeneration = ownerResetGeneration;
      try {
        if (!described) {
          const host = requireHostDescriptor(
            await ownerRequest<HostDescriptor>("environment.describe", {
              supportedProviders: REMOTE_PROVIDERS,
            }),
          );
          if (host.environmentId !== machine.environmentId)
            // The code, not the translated text, tells the classifier this is an identity refusal.
            throw Object.assign(
              new Error(t("Host identity changed. Reconnect this machine before continuing.")),
              { code: "RPC_WS_IDENTITY" },
            );
          if (stale() || application?.isCurrent() === false) return;
          boundedSet(cachedDescriptors, machine.id, host);
          setDescriptor(host);
          described = true;
        }
        const host = cachedDescriptors.get(machine.id);
        if (
          host?.capabilities.includes("machine.changes") &&
          visibleRef.current &&
          !document.hidden &&
          sessionId &&
          !unsubscribeChannel
        ) {
          const lastActiveAt = Date.now();
          unsubscribeChannel = subscribeRemoteMachineChannel(
            machine.id,
            () => ({
              active: { projectId: project.projectId, sessionId, lastActiveAt },
              sessions: [
                {
                  sessionId,
                  revision: snapshotRef.current?.revision ?? 0,
                  sourceEpoch: snapshotRef.current?.sourceEpoch,
                },
              ],
              inlineSync:
                visibleRef.current &&
                !document.hidden &&
                host.capabilities.includes("machine.changes.inlineSync") &&
                !!snapshotRef.current &&
                !snapshotRef.current.history &&
                !snapshotRef.current.historyLoading,
            }),
            async (changes, application) => {
              if (stale() || application?.isCurrent() === false) return;
              const recoveredControlChannel = controlChannelFailed;
              controlChannelFailed = false;
              const hint = changes.sessions.find((entry) => entry.sessionId === sessionId);
              const sourceChanged =
                !!hint?.sourceEpoch &&
                !!snapshotRef.current &&
                hint.sourceEpoch !== snapshotRef.current.sourceEpoch;
              if (hint?.deleted) {
                deletedOnHost = true;
                bindingGen.markDeleted(bindingKey);
                clearTimeout(timer);
                if (contentRetryTimer) clearTimeout(contentRetryTimer);
                unsubscribeChannel?.();
                unsubscribeChannel = undefined;
                historyPageRequest.current = null;
                setRemoteHistoryLoading(false);
                setRemoteDeleted(true);
                return;
              }
              if (changes.reset || sourceChanged) {
                ownerResetGeneration++;
                forceTailRead.current = true;
                historyPageRequest.current = null;
                snapshotRef.current = undefined;
                cachedSessionSnapshots.delete(snapshotKey(machine.id, sessionId));
                await deleteRemotePageCache({ environmentId: machine.environmentId, sessionId });
                if (stale() || application?.isCurrent() === false) return;
                setRemoteHistoryLoading(false);
              }
              const current = snapshotRef.current;
              if (
                !changes.reset &&
                !sourceChanged &&
                !recoveredControlChannel &&
                failed === 0 &&
                visibleRef.current &&
                !document.hidden &&
                hint?.sync?.kind === "delta" &&
                current &&
                !polling &&
                !forceTailRead.current
              ) {
                if (
                  hint.sync.value.revision <= current.revision &&
                  current.session.id === sessionId &&
                  verifiedProjects.has(current.projectId)
                )
                  return { appliedRevision: current.revision };
                if (
                  // A windowed session takes only a tail stream's partial deltas.
                  (!current.history || hint.sync.partial) &&
                  !current.historyLoading &&
                  hint.sync.base === current.revision
                ) {
                  try {
                    const next = applyStreamSync(current, hint.sync);
                    if (
                      !verifiedProjects.has(next.projectId) ||
                      next.projectId !== current.projectId ||
                      next.session.id !== sessionId
                    )
                      throw new Error("Inline sync does not match this host session");
                    observeRemoteApprovalResolutions(shell.id, current, next);
                    snapshotRef.current = next;
                    setSnapshot(next);
                    rememberSessionSnapshot(
                      snapshotKey(machine.id, sessionId),
                      next,
                      machine.environmentId,
                    );
                    onSnapshot?.(shell.id, next);
                    setOnline(true);
                    reportRemoteMachineStatus(machine.id, true);
                    publishRemoteDataState({
                      phase: next.session.blocks.length ? "ready" : "empty",
                      updatedAt: Date.now(),
                    });
                    return { appliedRevision: next.revision };
                  } catch {
                    /* A history/window mismatch uses the normal sync path. */
                  }
                }
              }
              const ownerReadNeeded =
                recoveredControlChannel ||
                changes.reset ||
                sourceChanged ||
                // A content request can fail while the control lane stays
                // healthy. An unchanged host has no revision hint to wake us.
                failed > 0 ||
                (hint !== undefined && hint.revision !== snapshotRef.current?.revision);
              if (ownerReadNeeded) {
                const currentData = remoteDataStateRef.current;
                if (failed === 0 && currentData.phase !== "refreshing")
                  publishRemoteDataState({
                    phase: snapshotRef.current || currentData.updatedAt ? "refreshing" : "loading",
                    updatedAt: currentData.updatedAt,
                  });
                if (failed === 0) {
                  const hydration = poll(application);
                  if (hint?.sync)
                    return hydration.then(() => {
                      const applied = snapshotRef.current;
                      if (
                        !stale() &&
                        application?.isCurrent() !== false &&
                        applied?.session.id === sessionId &&
                        verifiedProjects.has(applied.projectId) &&
                        applied.revision >= hint.revision
                      )
                        return { appliedRevision: applied.revision };
                      // The read finished older than the delta; its follow-up read commits it.
                      return stale() ? undefined : { deferred: true as const };
                    });
                } else if (!contentRetryTimer)
                  contentRetryTimer = setTimeout(
                    () => {
                      contentRetryTimer = undefined;
                      void poll();
                    },
                    remoteSessionPollDelay(
                      snapshotRef.current?.status === "running",
                      visibleRef.current,
                      document.hidden,
                      failed,
                    ),
                  );
              }
              if (
                hint?.sync &&
                !stale() &&
                snapshotRef.current?.session.id === sessionId &&
                verifiedProjects.has(snapshotRef.current.projectId) &&
                snapshotRef.current.revision >= hint.revision
              )
                return { appliedRevision: snapshotRef.current.revision };
              // An in-flight read refused this delta; it was queued as a follow-up read.
              if (hint?.sync && !stale() && (polling || ownerReadNeeded))
                return { deferred: true as const };
            },
            (reason) => {
              if (stale()) return;
              if (reason instanceof MachineChannelStreamError) {
                // One stream refused this consumer; the machine still answers, so
                // refresh over HTTP without reporting an outage.
                void poll().catch(() => undefined);
                return;
              }
              controlChannelFailed = true;
              setOnline(false);
              reportRemoteMachineStatus(machine.id, false, reason);
              const currentData = remoteDataStateRef.current;
              publishRemoteDataState({
                phase: currentData.updatedAt ? "stale" : "error",
                error: remoteErrorText(reason),
                updatedAt: currentData.updatedAt,
              });
            },
          );
        }
        if (
          cachedDescriptors.get(machine.id)?.capabilities.includes("machine.changes") &&
          (!visibleRef.current || document.hidden)
        ) {
          // The machine channel carries control hints; background tabs do not
          // need their own transcript-content polling loop.
          setOnline(true);
          reportRemoteMachineStatus(machine.id, true);
          return;
        }
        const known = historyGeneration.known(
          !pageCacheOnly && !forceTailRead.current && snapshotRef.current?.session.id === sessionId
            ? snapshotRef.current
            : undefined,
        );
        readGeneration = ownerResetGeneration;
        let next = sessionId
          ? await loadRemoteSession(machine.id, sessionId, known, {
              executionClient,
              waitMs:
                !unsubscribeChannel &&
                visibleRef.current &&
                !document.hidden &&
                cachedDescriptors.get(machine.id)?.capabilities.includes("sessions.longPoll")
                  ? 10_000
                  : 0,
              pages:
                cachedDescriptors.get(machine.id)?.capabilities.includes("sessions.lazyHistory") ||
                cachedDescriptors.get(machine.id)?.capabilities.includes("sessions.pages"),
              partialHistory: cachedDescriptors
                .get(machine.id)
                ?.capabilities.includes("sessions.lazyHistory"),
              isCurrent: () =>
                !stale() &&
                application?.isCurrent() !== false &&
                readGeneration === ownerResetGeneration,
              onHistoryError: (reason) => {
                if (
                  stale() ||
                  application?.isCurrent() === false ||
                  readGeneration !== ownerResetGeneration
                )
                  return;
                // A changed revision restarts tail loading without overwriting
                // the transcript that has already been displayed.
                snapshotRef.current = undefined;
                forceTailRead.current = true;
                historyGeneration.failed();
                setError(
                  t("History loading failed: {p0}. Retrying.", {
                    p0: describeRemoteError(reason).message,
                  }),
                );
              },
              onPreviews: (preview) => {
                const current = snapshotRef.current;
                if (
                  stale() ||
                  application?.isCurrent() === false ||
                  readGeneration !== ownerResetGeneration ||
                  !canApplyRemotePreview(current, preview) ||
                  !current
                )
                  return;
                const blocks = mergePreviewBlocks(current.session.blocks, preview.session.blocks);
                if (blocks === current.session.blocks) return;
                const merged = { ...current, session: { ...current.session, blocks } };
                observeRemoteApprovalSourceExpansion(shell.id, current, merged);
                snapshotRef.current = merged;
                rememberSessionSnapshot(
                  snapshotKey(machine.id, sessionId),
                  merged,
                  machine.environmentId,
                );
                setSnapshot(merged);
                onSnapshot?.(shell.id, merged);
              },
            })
          : undefined;
        // A reset invalidates replies from the previous host generation even
        // when its revision happens to match the replacement host.
        if (
          stale() ||
          application?.isCurrent() === false ||
          readGeneration !== ownerResetGeneration
        )
          return;
        if (next && !verifiedProjects.has(next.projectId)) {
          await verifyRemoteProjectAlias(
            (method, params) => ownerRequest(method, params),
            { projectId: project.projectId, cwd: project.cwd },
            next.projectId,
          );
          if (
            stale() ||
            application?.isCurrent() === false ||
            readGeneration !== ownerResetGeneration
          )
            return;
          verifiedProjects.add(next.projectId);
        }
        const latest = snapshotRef.current;
        if (
          !pageCacheOnly &&
          known &&
          next &&
          latest &&
          latest !== known &&
          latest.session.id === sessionId
        ) {
          if (latest.revision === next.revision) {
            // A page or full-block request expanded this same revision while
            // the poll was in flight. Keep that wider snapshot, then continue
            // through the normal scheduling path (legacy hosts have no hint
            // channel to schedule the next content read).
            next = latest;
          } else {
            setRefresh((value) => value + 1);
            return;
          }
        }
        if (
          historyPageRequest.current &&
          next &&
          next.revision !== historyPageRequest.current.revision
        ) {
          historyPageRequest.current = null;
          setRemoteHistoryLoading(false);
        }
        historyGeneration.loaded();
        setOnline(true);
        reportRemoteMachineStatus(machine.id, true);
        // A catalog request that failed while offline is retried on recovery.
        if (failed) refreshCatalog();
        failed = 0;
        if (next && sessionId)
          rememberSessionSnapshot(snapshotKey(machine.id, sessionId), next, machine.environmentId);
        if (next && !pageCacheOnly && snapshotRef.current)
          observeRemoteApprovalResolutions(shell.id, snapshotRef.current, next);
        setSnapshot(next);
        snapshotRef.current = next;
        forceTailRead.current = false;
        setPageCacheOnly(false);
        setRemoteDeleted(false);
        if (next)
          recordPerformanceEvent(
            "renderer-receive",
            { revision: next.revision, blocks: next.session.blocks.length },
            sessionPerformanceTrace(shell.id),
          );
        if (next) onSnapshot?.(shell.id, next);
        const verifiedAt = next ? Date.now() : remoteDataStateRef.current.updatedAt;
        publishRemoteDataState({
          phase: next?.session.blocks.length ? "ready" : "empty",
          ...(verifiedAt ? { updatedAt: verifiedAt } : {}),
        });
        // A `!command` still running on the host changes the transcript too.
        active =
          !next?.historyLoading &&
          (next?.status === "running" ||
            !!next?.session.blocks.some((block) => block.shell?.running));
      } catch (reason) {
        if (
          stale() ||
          application?.isCurrent() === false ||
          readGeneration !== ownerResetGeneration
        )
          return;
        failed++;
        // One timeout or busy reply proves nothing: the shared connection state ignores it,
        // so keep the last data and online status. Going offline on a blip would make the
        // next success announce a recovery that reloads every view of this machine.
        const blip =
          classifyRemoteError(reason).kind === "temporary" && failed < TIMEOUTS_BEFORE_UNREACHABLE;
        if (!blip) {
          const currentData = remoteDataStateRef.current;
          publishRemoteDataState({
            phase: "error",
            error: remoteErrorText(reason),
            updatedAt: currentData.updatedAt,
          });
          setOnline(false);
          reportRemoteMachineStatus(machine.id, false, reason);
        } else recordRemoteConnection(machine.environmentId, reason); // a timeout here is counted by the request path
        described = false;
      } finally {
        polling = false;
        contentRefreshInFlight.current = false;
        if (ownerReadPending && !stale()) {
          ownerReadPending = false;
          if (contentRetryTimer) clearTimeout(contentRetryTimer);
          contentRetryTimer = setTimeout(
            () => {
              contentRetryTimer = undefined;
              void poll();
            },
            failed === 0
              ? 0
              : remoteSessionPollDelay(
                  snapshotRef.current?.status === "running",
                  visibleRef.current,
                  document.hidden,
                  failed,
                ),
          );
        }
      }
      if (
        !disposed &&
        !deletedOnHost &&
        !unsubscribeChannel &&
        !(
          cachedDescriptors.get(machine.id)?.capabilities.includes("machine.changes") &&
          (!visibleRef.current || document.hidden)
        )
      )
        timer = setTimeout(
          () => void poll(),
          active &&
            visibleRef.current &&
            !document.hidden &&
            failed === 0 &&
            cachedDescriptors.get(machine.id)?.capabilities.includes("sessions.longPoll")
            ? 100
            : remoteSessionPollDelay(active, visibleRef.current, document.hidden, failed),
        );
    };
    const onVisibility = () => {
      if (bindingGen.isDeleted(bindingKey)) return;
      clearTimeout(timer);
      if (visibleRef.current && !document.hidden) beginOwnerVerification();
      if (polling) {
        ownerReadPending = true;
        return;
      }
      // The active channel stays subscribed; pending reads use current visibility.
      if (visibleRef.current && !document.hidden) void poll();
      else
        timer = setTimeout(
          () => void poll(),
          remoteSessionPollDelay(
            snapshotRef.current?.status === "running",
            visibleRef.current,
            true,
            failed,
          ),
        );
    };
    wake.current = onVisibility;
    document.addEventListener("visibilitychange", onVisibility);
    void poll();
    return () => {
      disposed = true;
      wake.current = () => {};
      clearTimeout(timer);
      if (contentRetryTimer) clearTimeout(contentRetryTimer);
      unsubscribeChannel?.();
      document.removeEventListener("visibilitychange", onVisibility);
      if (sessionId) void flushRemotePageCache({ environmentId: machine.environmentId, sessionId });
    };
  }, [
    machine.id,
    machine.environmentId,
    project.projectId,
    project.cwd,
    sessionId,
    refresh,
    pageCacheOnly,
    onSnapshot,
  ]);

  // When the machine comes back, the poll starts again at once instead of
  // waiting out its back-off, and re-attaches this session from its snapshot.
  useEffect(
    () =>
      subscribeRemoteRecovered((environmentId) => {
        if (environmentId && environmentId !== machine.environmentId) return;
        if (bindingGen.currentDeleted()) return;
        beginOwnerVerification();
        setRefresh((value) => value + 1);
        setRecoveryTick((value) => value + 1);
        refreshCatalog();
      }),
    [machine.environmentId],
  );

  const providers = useMemo(
    () => (descriptor?.providers ?? []).filter(isRemoteProvider),
    [descriptor],
  );
  // A new session starts with the tab's model when the host offers it, and
  // otherwise with the host's first model. Settings follow the host's entry:
  // the same id can differ between machines, such as `claude:opus` offering a
  // 1M context only on an account that has it.
  useEffect(() => {
    if (!online || sessionId || !catalog || !providers.length) return;
    const harness = providers.includes(draft.harness) ? draft.harness : providers[0];
    const models = catalog.models[harness] ?? [];
    const model =
      findRemoteModel(models, draft.model) ??
      (harness === draft.harness ? undefined : models[0]) ??
      models[0];
    if (!model) return;
    setDraft((current) => {
      const settings = carryModelSettings(model.settings ?? [], current.settings);
      return current.harness === harness &&
        current.model === model.id &&
        sameModelSettings(settings, current.settings)
        ? current
        : {
            ...current,
            harness,
            model: model.id,
            settings,
            providerAccountId: current.harness === harness ? current.providerAccountId : undefined,
          };
    });
  }, [online, catalog, providers, sessionId, draft.harness, draft.model]);

  const saved: Configuration | undefined = hostSession && {
    harness: hostSession.harness as RemoteProvider,
    model: hostSession.model,
    settings: hostSession.modelSettings ?? {},
    mode: hostSession.runtimeMode,
    providerAccountId: hostSession.providerAccountId ?? null,
  };
  const configuration = saved ? (changes ?? saved) : draft;
  const selectedProviderAccountId =
    configuration.providerAccountId === null
      ? DEFAULT_PROVIDER_ACCOUNT_ID
      : (configuration.providerAccountId ??
        (configuration.harness === saved?.harness
          ? (saved.providerAccountId ?? undefined)
          : undefined));
  useEffect(() => {
    const binding = hostSessionBinding(shell);
    if (!binding || binding.created) return;
    try {
      saveHostSessionBinding(
        {
          ...shell,
          harness: draft.harness,
          model: draft.model,
          modelSettings: draft.settings,
          runtimeMode: draft.mode,
          providerAccountId: draft.providerAccountId ?? undefined,
          workspaceMode: draftWorkspaceMode,
          worktreeBase: draftWorktreeBase,
          worktreeCwd: selectedCwd === project.cwd ? undefined : selectedCwd,
        },
        binding,
      );
    } catch (reason) {
      setError(describeRemoteError(reason).message);
    }
  }, [
    shell.id,
    draft.harness,
    draft.model,
    draft.settings,
    draft.mode,
    draft.providerAccountId,
    draftWorkspaceMode,
    draftWorktreeBase,
    selectedCwd,
  ]);
  const updateConfiguration = (update: (current: Configuration) => Configuration) => {
    failedAccountConfiguration.current = undefined;
    if (saved)
      setChanges({
        ...update(changes ?? saved),
        authorityGeneration: remoteIntentAuthority(snapshot).authorityGeneration,
      });
    else setDraft(update);
  };

  const accountAvailable = (provider: "codex" | "claude" | "grok", accountId: string): boolean => {
    if (!canSelectProviderAccount || preparingRef.current) return false;
    const accounts = catalog?.accounts?.[provider];
    if (accounts && !accounts.some((account) => account.id === accountId)) {
      setError(t("This account is not available on the owning Host."));
      return false;
    }
    if (
      !accounts &&
      accountId !== (hostSession?.providerAccountId ?? DEFAULT_PROVIDER_ACCOUNT_ID)
    ) {
      setError(t("Update the Host to load its available accounts."));
      return false;
    }
    return true;
  };
  const selectAccount = (provider: "codex" | "claude" | "grok", accountId: string): boolean => {
    if (provider !== configuration.harness || !accountAvailable(provider, accountId)) return false;
    updateConfiguration((current) => ({
      ...current,
      providerAccountId: accountId === DEFAULT_PROVIDER_ACCOUNT_ID ? null : accountId,
    }));
    return true;
  };

  const selectedTurnModel = (): NonNullable<Block["turnModel"]> => ({
    harness: configuration.harness,
    id: configuration.model,
    name:
      findRemoteModel(catalog?.models[configuration.harness] ?? [], configuration.model)?.name ??
      modelDisplayName(configuration.model, configuration.harness),
  });
  const optimisticTurn = (
    text: string,
    attachments: Attachment[] = [],
    intent: "default" | "plan" | "build" = "default",
    draft = false,
    draftBlockId?: string,
    planBlockId?: string,
  ): OptimisticTurn => ({
    ...remoteIntentAuthority(hostSession ? snapshot : undefined),
    commandId: newRequestId(),
    text,
    attachments,
    intent,
    draft,
    draftBlockId,
    planBlockId,
    startedAt: Date.now(),
    turnModel: selectedTurnModel(),
  });

  /** Why the last command did not reach the host, for what its queue should do next. */
  const lastRunFailure = useRef<string>(undefined);
  const approvalOccurrenceError = (occurrenceId?: string) =>
    !descriptor?.capabilities.includes("sessions.approvalOccurrence.v1")
      ? t(
          "This Host cannot verify which request you are answering. Update the Host before responding.",
        )
      : !isApprovalOccurrenceId(occurrenceId)
        ? t(
            "This request cannot be verified. Refresh the conversation or update its execution client.",
          )
        : undefined;
  const run = async (
    command: HostCommand,
    optimistic?: OptimisticTurn,
    followup?: HostCommand,
    recoveredReceipt?: CommandReceipt,
    generation?: number,
  ): Promise<CommandReceipt | undefined> => {
    const contextReplay =
      command.type === "send"
        ? command.contextReplay
        : command.type === "create" && command.firstTurn?.type === "send"
          ? command.firstTurn.contextReplay
          : undefined;
    if (contextReplay && !descriptor?.capabilities.includes("sessions.contextReplay.v1")) {
      setError(t("Update the Host to preserve this conversation's context before sending."));
      return undefined;
    }
    if (!recoveredReceipt) {
      try {
        assertDesktopControlReceipts(command, descriptor?.capabilities);
      } catch (reason) {
        const message = errorText(reason);
        lastRunFailure.current = message;
        setError(message);
        return undefined;
      }
    }
    if (!recoveredReceipt && command.type === "approve") {
      const refusal = approvalOccurrenceError(command.approvalOccurrenceId);
      if (refusal) {
        setError(refusal);
        return undefined; // Preserve the exact persisted original; never add a newer nonce.
      }
    }
    if (optimistic?.queued && ["send", "compact"].includes(command.type))
      command = { ...command, queued: optimistic.queued };
    if (sendingRef.current || pageCacheOnly || remoteDeleted) return undefined;
    if (
      !recoveredReceipt &&
      generation !== undefined &&
      generation !== submissionGeneration.current
    )
      return undefined;
    const version = bindingGen.version;
    let priorPending: boolean;
    try {
      priorPending =
        (
          await readDurableRemoteCommand(
            project.key,
            machine.environmentId,
            sessionId ?? null,
            shell.id,
          )
        ).command?.commandId === command.commandId;
    } catch (reason) {
      setError(errorText(reason));
      return undefined;
    }
    if (!alive.current || version !== bindingGen.version || sendingRef.current) return undefined;
    let persisted = priorPending;
    const owner = Symbol();
    sendingOwner.current = owner;
    sendingRef.current = true;
    setSending(true);
    setError("");
    lastRunFailure.current = undefined;
    if (command.type === "send" || command.type === "compact")
      setUnseenSend((current) =>
        current?.commandId === command.commandId
          ? current
          : {
              sessionId: command.sessionId,
              commandId: command.commandId,
              ...remoteIntentAuthority(command),
              text: command.type === "send" ? command.text : "/compact",
              attachments: optimistic?.attachments ?? [],
              startedAt: optimistic?.startedAt ?? Date.now(),
              turnModel: optimistic?.turnModel ?? selectedTurnModel(),
              draftBlockId: command.type === "send" ? command.draftBlockId : undefined,
            },
      );
    // Keep the original ID across disconnects and app restarts. An ambiguous
    // response is retried explicitly instead of silently sending a new prompt.
    try {
      if (!recoveredReceipt) {
        await flushHostSessionBindings();
        await admitDurableRemoteCommand(
          project.key,
          machine.environmentId,
          command,
          shell.id,
          followup,
        );
        persisted = true;
        const current = await readDurableRemoteEntry(
          project.key,
          machine.environmentId,
          command.commandId,
        );
        if (!current.entry || canonicalJson(current.entry.command) !== canonicalJson(command))
          throw new Error("The pending request changed; check the host before continuing.");
        if (
          !alive.current ||
          version !== bindingGen.version ||
          current.entry?.stopRequested ||
          (generation !== undefined && generation !== submissionGeneration.current)
        ) {
          // Another window may already have offered this exact command. Without a
          // receipt, keep its original evidence even when this attempt did not send.
          return undefined;
        }
      }
      setPending(command);
      const traceId = sessionPerformanceTrace(shell.id);
      let receipt = recoveredReceipt;
      if (!receipt) {
        const dispatchDone = startPerformanceSpan("dispatch", {}, traceId);
        try {
          receipt = await executionClient.dispatchCommand(command);
        } finally {
          dispatchDone();
        }
      }
      if (!receipt) throw new Error(t("The host did not confirm the request."));
      if (contextReplay) {
        consumedContextReplay.current = contextReplay;
        setSessions((sessions) =>
          sessions.map((session) =>
            session.id === shell.id && session.pendingContextReplay === contextReplay
              ? { ...session, pendingContextReplay: undefined }
              : session,
          ),
        );
      }
      if (owner)
        acknowledgeHostSessionBinding(shell, receipt.sessionId, receipt.authorityGeneration);
      if (owner) await flushHostSessionBindings();
      if (command.type === "create" && command.sessionId && receipt.sessionId !== command.sessionId)
        throw new Error(t("The host did not confirm the request."));
      recordPerformanceEvent("host-ack", { revision: receipt.revision }, traceId);
      const stopped =
        (generation !== undefined && generation !== submissionGeneration.current) ||
        (await readDurableRemoteEntry(project.key, machine.environmentId, command.commandId)).entry
          ?.stopRequested;
      if (stopped) {
        await markDurableRemoteCommandStopped(
          project.key,
          machine.environmentId,
          command.commandId,
        );
        if (receipt.runId) {
          // A newer turn may already exist. Cancel only the run this command
          // accepted, never whichever run happens to be in the latest snapshot.
          await executionClient.dispatchCommand({
            type: "cancel",
            commandId: newRequestId(),
            sessionId: receipt.sessionId,
            runId: receipt.runId,
            ...remoteIntentAuthority(receipt),
          });
        } else if (
          command.type === "send" ||
          command.type === "compact" ||
          (command.type === "create" && command.firstTurn?.type === "send")
        ) {
          throw new Error(
            t(
              "The host confirmed the stopped request without its run ID. It was kept for recovery; check the host before retrying.",
            ),
          );
        }
        // The host made the session even though the turn was stopped: keep it
        // reachable from this tab unless a newer turn is already creating its own.
        if (command.type === "create" && !preparingTurn.current)
          adoptCreatedSession(receipt.sessionId, alive.current && version === bindingGen.version);
        await settleDurableRemoteCommand(project.key, machine.environmentId, command);
        const handedOff =
          command.type === "create" ? command.firstTurn?.commandId : command.commandId;
        if (handedOff && ownership) {
          ownership.finishJob(`submit:${handedOff}`);
          void ownership.replaceDurable(`submit:${handedOff}`, []).catch(console.warn);
        }
        if (alive.current && version === bindingGen.version) {
          setStarting((current) =>
            current?.commandId === optimistic?.commandId ? undefined : current,
          );
          setUnseenSend((current) =>
            current?.commandId === command.commandId ? undefined : current,
          );
          setPending(
            (
              await readDurableRemoteCommand(
                project.key,
                machine.environmentId,
                bindingGen.session ?? null,
                shell.id,
              )
            ).command,
          );
          setRefresh((value) => value + 1);
        }
        return receipt;
      }
      if (command.type === "create") {
        const next = (
          await readDurableRemoteEntry(project.key, machine.environmentId, command.commandId)
        ).entry?.followup;
        await settleDurableRemoteCommand(
          project.key,
          machine.environmentId,
          command,
          next && next.type !== "create" ? { ...next, sessionId: receipt.sessionId } : undefined,
          shell.id,
        );
        adoptCreatedSession(receipt.sessionId, version === bindingGen.version);
      } else await settleDurableRemoteCommand(project.key, machine.environmentId, command);
      const handedOff =
        command.type === "create" ? command.firstTurn?.commandId : command.commandId;
      if (handedOff && ownership) {
        ownership.finishJob(`submit:${handedOff}`);
        void ownership.replaceDurable(`submit:${handedOff}`, []).catch(console.warn);
      }
      if (!alive.current || version !== bindingGen.version) return receipt;
      if (receipt.runId) {
        setUnseenSend((current) =>
          current?.commandId === command.commandId ? { ...current, runId: receipt.runId } : current,
        );
        if (command.type === "create")
          setStarting((current) =>
            current && optimistic && current.commandId === optimistic.commandId
              ? {
                  ...current,
                  acceptedRun: {
                    sessionId: receipt.sessionId,
                    runId: receipt.runId!,
                    ...remoteIntentAuthority(receipt),
                  },
                }
              : current,
          );
      }
      if (command.type === "draft") {
        // Accepted drafts are actionable before the next snapshot arrives.
        const current = snapshotRef.current;
        const next: HostSession = {
          ...(current?.session.id === command.sessionId
            ? current
            : {
                projectId: project.projectId,
                revision: 0,
                updatedAt: Date.now(),
              }),
          status: "idle",
          session: {
            ...(current?.session.id === command.sessionId ? current.session : shell),
            id: command.sessionId,
            cwd: selectedCwd,
            harness: configuration.harness,
            model: configuration.model,
            modelSettings: configuration.settings,
            runtimeMode: configuration.mode,
            busy: false,
            blocks: [
              ...(current?.session.id === command.sessionId ? current.session.blocks : []).filter(
                (block) =>
                  (!block.draft || !!block.followUpDelivery) && block.id !== command.commandId,
              ),
              {
                id: command.commandId,
                role: "user",
                text: command.text,
                draft: true,
                attachments: optimistic?.attachments ?? [],
              },
            ],
          },
        };
        if (current) observeRemoteApprovalSourceExpansion(shell.id, current, next);
        snapshotRef.current = next;
        setSnapshot(next);
        setStarting(undefined);
      }
      setPending(
        (
          await readDurableRemoteCommand(
            project.key,
            machine.environmentId,
            command.type === "create" ? receipt.sessionId : (sessionId ?? null),
            shell.id,
          )
        ).command,
      );
      setRefresh((value) => value + 1);
      return receipt;
    } catch (reason) {
      if (!alive.current || version !== bindingGen.version) return undefined;
      if (
        !persisted &&
        !priorPending &&
        String(reason).includes("Cannot save remote requests.") &&
        optimistic?.onSendRejected?.()
      ) {
        optimistic.restoredDraft = true;
        setStarting(undefined);
        setUnseenSend((current) =>
          current?.commandId === command.commandId ? undefined : current,
        );
      }
      reportRemoteConnection(remotePath(machine.environmentId, project.cwd), "session", reason);
      const message = String(reason);
      lastRunFailure.current = message;
      const failureClass = classifyCommandFailure(reason);
      lastCommandFailure.current = { commandId: command.commandId, kind: failureClass };
      // Saved to the outbox: a failure to reach the Host is retried by the pending
      // check, which says so in the notice instead of showing the raw error.
      if (persisted && optimistic) optimistic.saved = true;
      const blockedRetry =
        priorPending &&
        requiresDesktopControlReceipts(command) &&
        typeof reason === "object" &&
        reason !== null &&
        "code" in reason &&
        reason.code === "RPC_WS_UNSUPPORTED";
      if (
        failureClass === "definitive" &&
        message.includes("Host rejected request:") &&
        !blockedRetry
      ) {
        if (command.type === "send" || command.type === "compact")
          setUnseenSend((current) =>
            current?.commandId === command.commandId ? undefined : current,
          );
        if (persisted) {
          try {
            await settleDurableRemoteCommand(project.key, machine.environmentId, command);
          } catch (settlementError) {
            setError(errorText(settlementError));
            return undefined;
          }
        }
        try {
          setPending(
            (
              await readDurableRemoteCommand(
                project.key,
                machine.environmentId,
                sessionId ?? null,
                shell.id,
              )
            ).command,
          );
        } catch (storageError) {
          setError(errorText(storageError));
          return undefined;
        }
      }
      // Another computer runs a turn of this conversation: a wait, not an error.
      // The message goes to the queue and is sent when that turn is over.
      if (!isLeaseHeld(message) && !(persisted && failureClass !== "definitive"))
        setError(describeRemoteError(reason).message);
      return undefined;
    } finally {
      ownership?.finishJob(
        `submit:${command.type === "create" ? command.firstTurn?.commandId : command.commandId}`,
      );
      if (sendingOwner.current === owner) {
        sendingOwner.current = undefined;
        sendingRef.current = false;
        if (alive.current) setSending(false);
      }
    }
  };

  // A conversation that was only a draft goes with it, as a local one does,
  // and the tab starts over as a new conversation.
  const discardSession = async (id: string) => {
    const version = bindingGen.version;
    bindingGen.beginDiscard(id);
    try {
      await sessionAccessForMachine(machine.id, false, true, machine.environmentId).delete(
        id,
        project.projectId,
        snapshot?.session.id === id ? snapshot.authorityGeneration : undefined,
      );
      cachedSessionSnapshots.delete(snapshotKey(machine.id, id));
      forgetRemoteQueue(id);
      if (!alive.current || version !== bindingGen.version) return;
      setSnapshot(undefined);
      rememberRemoteSession(shell.id);
      onSnapshot?.(shell.id, undefined);
    } catch (reason) {
      if (!alive.current || version !== bindingGen.version) return;
      bindingGen.endDiscard();
      setRefresh((value) => value + 1);
      setRemovingDraft(undefined);
      setError(describeRemoteError(reason).message);
    }
  };

  // Not a reset for the REMOTE_TAB_BINDING_CHANGE handler above: `bindingGen.session` is
  // set first, so the binding it then reads is already ours and the optimistic
  // turn, `starting` and the snapshot survive our own bind.
  const openSession = (id: string) => {
    bindingGen.bind(id);
    rememberRemoteSession(shell.id, id);
    setSessionId(id);
  };

  // Binds the host session a create made to this tab. When the tab's binding
  // changed while the create ran (`current` false), the session is still bound if
  // the tab has none and no other tab shows it: skipping would orphan it. Only a
  // tab meanwhile bound to another session, or the session open elsewhere, keeps it.
  const adoptCreatedSession = (id: string, current: boolean) => {
    if (!current && (remoteSessionFor(shell.id) || remoteShellBoundTo(id, shell.id))) return;
    openSession(id);
  };

  // Model, effort and permission changes apply directly, as locally. A
  // running turn keeps its settings; the change is sent once it finishes.
  const applying = useRef(false);
  // The last change the host accepted, until a sync reflects it.
  const applied = useRef<Configuration>(undefined);
  useEffect(() => {
    if (!changes || !saved || !hostSession) return;
    const same = (a: Configuration, b: Configuration) =>
      a.harness === b.harness &&
      a.model === b.model &&
      a.mode === b.mode &&
      (a.providerAccountId === undefined || a.providerAccountId === b.providerAccountId) &&
      sameModelSettings(a.settings, b.settings);
    if (same(changes, saved)) {
      applied.current = undefined;
      setChanges(undefined);
      return;
    }
    if (failedAccountConfiguration.current && same(changes, failedAccountConfiguration.current))
      return;
    if (
      applied.current &&
      same(changes, applied.current) &&
      remoteIntentAuthorityMatches(changes, applied.current)
    )
      return;
    if (busy || !online || pending || applying.current) return;
    if (!remoteIntentAuthorityMatches(changes, snapshot)) {
      setError(
        t(
          "This pending request belongs to an earlier session authority. It was kept for recovery; review it before creating a new request.",
        ),
      );
      return;
    }
    applying.current = true;
    const sent = changes;
    const changesAccount =
      sent.providerAccountId !== undefined &&
      (sent.harness !== saved.harness || sent.providerAccountId !== saved.providerAccountId);
    void run({
      type: "configure",
      ...remoteIntentAuthority(changes),
      commandId: newRequestId(),
      sessionId: hostSession.id,
      ...(descriptor?.capabilities.includes("sessions.harnessSwitch")
        ? { harness: changes.harness }
        : {}),
      model: changes.model,
      modelSettings: changes.settings,
      runtimeMode: changes.mode,
      ...(changesAccount ? { providerAccountId: sent.providerAccountId } : {}),
    })
      .then((receipt) => {
        if (receipt) applied.current = sent;
        else if (changesAccount) failedAccountConfiguration.current = sent;
      })
      .finally(() => {
        applying.current = false;
      });
  });

  const dispatchTurn = async (
    id: string,
    turn: OptimisticTurn,
    uploaded?: RemoteAttachment[],
    generation = submissionGeneration.current,
  ) => {
    const version = bindingGen.version;
    const refs = turn.draftBlockId
      ? []
      : (uploaded ??
        (await uploadRemoteAttachments(machine.id, turn.attachments, {
          ownership,
          ownershipSource: `submit:${turn.commandId}`,
          environmentId: machine.environmentId,
          resumable: descriptor?.capabilities.includes("attachments.resume"),
          onProgress: (_id, offset, size) => {
            if (
              alive.current &&
              version === bindingGen.version &&
              generation === submissionGeneration.current
            )
              setUploadProgress({ offset, size });
          },
        })));
    if (
      !alive.current ||
      version !== bindingGen.version ||
      generation !== submissionGeneration.current
    ) {
      ownership?.finishJob(`submit:${turn.commandId}`);
      return undefined;
    }
    setUploadProgress(undefined);
    return run(
      turn.draft
        ? {
            type: "draft",
            ...remoteIntentAuthority(turn),
            commandId: turn.commandId,
            sessionId: id,
            text: turn.text,
            attachments: refs,
          }
        : message(
            id,
            turn.text,
            turn.commandId,
            refs,
            turn.intent,
            turn.draftBlockId,
            turn.planBlockId,
            turn.authorityGeneration,
          ),
      turn,
      undefined,
      undefined,
      generation,
    );
  };

  const startSession = async (turn: OptimisticTurn, generation = submissionGeneration.current) => {
    const version = bindingGen.version;
    // The host lists the new session before the create receipt binds it to this
    // tab; the intent keeps the rail, openers and tab cleanup from claiming it.
    const createIntent = beginRemoteCreate(
      shell.id,
      project.key,
      machine.environmentId,
      cachedRemoteSessionIds(project.key),
    );
    try {
      const managedCreation = descriptor?.capabilities.includes("sessions.managedCreation.v1");
      if (!descriptor || (!managedCreation && draftWorkspaceMode === "worktree"))
        throw new Error(t("Update bycoda to create managed sessions on this remote Host."));
      const reservedSessionId = managedCreateId();
      const workspace = projectless
        ? undefined
        : await prepareSessionWorkspace(
            {
              ...shell,
              id: reservedSessionId,
              cwd: project.key,
              workspaceMode: draftWorkspaceMode,
              worktreeBase: draftWorktreeBase,
              worktreeCwd: selectedCwd !== project.cwd ? selectedCwd : undefined,
            },
            !!managedCreation,
          );
      if (
        !alive.current ||
        version !== bindingGen.version ||
        generation !== submissionGeneration.current
      )
        return;
      const uploaded = await uploadRemoteAttachments(machine.id, turn.attachments, {
        environmentId: machine.environmentId,
        ownership,
        ownershipSource: `submit:${turn.commandId}`,
        resumable: descriptor?.capabilities.includes("attachments.resume"),
        onProgress: (_id, offset, size) => {
          if (
            alive.current &&
            version === bindingGen.version &&
            generation === submissionGeneration.current
          )
            setUploadProgress({ offset, size });
        },
      });
      if (
        !alive.current ||
        version !== bindingGen.version ||
        generation !== submissionGeneration.current
      )
        return;
      setUploadProgress(undefined);
      const worktreeCwd = workspace?.path ?? selectedCwd;
      const followup: Exclude<HostCommand, { type: "create" }> = turn.draft
        ? {
            type: "draft",
            ...remoteIntentAuthority(turn),
            commandId: turn.commandId,
            sessionId: "",
            text: turn.text,
            attachments: uploaded,
          }
        : message(
            "",
            turn.text,
            turn.commandId,
            uploaded,
            turn.intent,
            turn.draftBlockId,
            turn.planBlockId,
            turn.authorityGeneration,
          );
      const atomic = descriptor?.capabilities.includes("sessions.createFirstTurn") ?? false;
      const receipt = await run(
        {
          type: "create",
          commandId: reservedSessionId,
          ...(managedCreation || projectless ? { sessionId: reservedSessionId } : {}),
          projectId: project.projectId,
          ...(workspace ? { workspaceId: workspace.id } : {}),
          ...(!projectless && draftWorkspaceMode === "current"
            ? { workspaceMode: "current" as const }
            : {}),
          ...(!projectless && worktreeCwd !== project.cwd ? { worktreeCwd } : {}),
          harness: draft.harness,
          ...(draft.providerAccountId ? { providerAccountId: draft.providerAccountId } : {}),
          model: draft.model,
          modelSettings: draft.settings,
          runtimeMode: draft.mode,
          ...(atomic
            ? { firstTurn: followup as Extract<HostCommand, { type: "send" | "draft" }> }
            : {}),
        },
        turn,
        atomic ? undefined : followup,
        undefined,
        generation,
      );
      if (version !== bindingGen.version || generation !== submissionGeneration.current) return;
      if (!receipt) {
        if (alive.current && !turn.saved)
          setStarting(turn.restoredDraft ? undefined : { ...turn, failed: true });
        return;
      }
      if (version !== bindingGen.version) return;
      if (atomic) return;
      const sent = await run(
        { ...followup, sessionId: receipt.sessionId },
        turn,
        undefined,
        undefined,
        generation,
      );
      if (
        alive.current &&
        version === bindingGen.version &&
        generation === submissionGeneration.current
      )
        if (!sent && !turn.saved)
          setStarting(turn.restoredDraft ? undefined : { ...turn, failed: true });
    } catch (reason) {
      if (
        alive.current &&
        version === bindingGen.version &&
        generation === submissionGeneration.current
      ) {
        setError(describeRemoteError(reason).message);
        setStarting({ ...turn, failed: true });
      }
    } finally {
      // The receipt has bound the session by now, or the create failed with its
      // outbox entry (which keeps the tab pending) still saved.
      endRemoteCreate(shell.id, createIntent);
      ownership?.finishJob(`submit:${turn.commandId}`);
      if (generation === submissionGeneration.current) {
        preparingRef.current = false;
        preparingTurn.current = undefined;
      }
    }
  };

  const message = (
    id: string,
    text: string,
    commandId: string = crypto.randomUUID(),
    attachments: RemoteAttachment[] = [],
    intent: "default" | "plan" | "build" = "default",
    draftBlockId?: string,
    planBlockId?: string,
    authorityGeneration?: number,
  ): Extract<HostCommand, { type: "send" | "compact" }> =>
    text.trim().toLowerCase() === "/compact" &&
    !attachments.length &&
    !draftBlockId &&
    intent === "default"
      ? {
          type: "compact",
          ...remoteIntentAuthority({ authorityGeneration }),
          commandId,
          sessionId: id,
          resumeAtReset: loadResumeAtReset(),
        }
      : {
          type: "send",
          ...remoteIntentAuthority({ authorityGeneration }),
          commandId,
          sessionId: id,
          resumeAtReset: loadResumeAtReset(),
          text,
          ...(shell.pendingContextReplay &&
          shell.pendingContextReplay !== consumedContextReplay.current
            ? { contextReplay: shell.pendingContextReplay }
            : {}),
          attachments,
          intent,
          ...(draftBlockId ? { draftBlockId } : {}),
          ...(planBlockId ? { planBlockId } : {}),
        };

  // The desktop that owns this conversation is running a turn (`LEASE_HELD`):
  // the message waits in the shared queue, never paused, and goes out afterwards.
  // A row that came from the queue is still there; a new one is added.
  const leaseRetries = useRef(0);
  const leaseTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** The queue does not offer its head again before this time (a refused `LEASE_HELD`). */
  const leaseWait = useRef(0);
  useEffect(() => () => clearTimeout(leaseTimer.current), []);
  // The turn the other computer runs shows in the snapshot as running; when that
  // changes, the queue looks again at once instead of waiting out the delay.
  useEffect(() => {
    leaseWait.current = 0;
    leaseRetries.current = 0;
    clearTimeout(leaseTimer.current);
  }, [busy]);
  // The snapshot normally shows that turn as running and the queue waits for it
  // to end. If it has not yet, look again, each wait longer up to a cap; the
  // queue keeps that pace instead of giving up and sitting there.
  const retryAfterLease = () => {
    const delay = leaseRetryDelay(leaseRetries.current++);
    leaseWait.current = Date.now() + delay;
    clearTimeout(leaseTimer.current);
    leaseTimer.current = setTimeout(() => {
      if (alive.current) retryDrain();
    }, delay);
  };
  const queueForLease = (turn: OptimisticTurn): boolean => {
    if (turn.queued) return true;
    if (turn.draft || turn.draftBlockId || turn.planBlockId || !queue.loaded) return false;
    return (
      queue.enqueue({
        ...remoteIntentAuthority(turn),
        id: crypto.randomUUID(),
        text: turn.text,
        attachments: turn.attachments,
        intent: turn.intent,
        modelTarget: {
          harness: configuration.harness,
          model: configuration.model,
          modelSettings: { ...configuration.settings },
          ...(canSelectProviderAccount && supportsProviderAccounts(configuration.harness)
            ? { providerAccountId: selectedProviderAccountId ?? DEFAULT_PROVIDER_ACCOUNT_ID }
            : {}),
        },
      }) !== false
    );
  };

  // Starts a turn whose optimistic bubble is already in `starting`. Gives up,
  // clearing it, when the session cannot take a message now.
  const launch = (
    turn: OptimisticTurn,
    generation = submissionGeneration.current,
    onAcceptance?: (accepted: boolean) => void,
  ): boolean => {
    if (generation !== submissionGeneration.current) return false;
    if (!hostSession) {
      if (sessionId || !draft.model) {
        preparingRef.current = false;
        setStarting(undefined);
        return false;
      }
      void startSession(turn, generation);
      return true;
    }
    if (changes || hostSession.busy || pending || sendingRef.current) {
      preparingRef.current = false;
      setStarting(undefined);
      return false;
    }
    const version = bindingGen.version;
    void dispatchTurn(hostSession.id, turn, undefined, generation)
      .then((receipt) => {
        onAcceptance?.(!!receipt);
        if (receipt) {
          leaseRetries.current = 0;
          leaseWait.current = 0;
        }
        if (
          alive.current &&
          version === bindingGen.version &&
          generation === submissionGeneration.current
        )
          if (!receipt) {
            if (isLeaseHeld(lastRunFailure.current) && queueForLease(turn)) {
              setStarting(undefined);
              retryAfterLease();
            } else if (!turn.saved)
              // A saved request is sent again by the pending check; it is not a failure.
              setStarting(turn.restoredDraft ? undefined : { ...turn, failed: true });
          }
      })
      .catch((reason) => {
        onAcceptance?.(false);
        if (
          alive.current &&
          version === bindingGen.version &&
          generation === submissionGeneration.current
        ) {
          setError(describeRemoteError(reason).message);
          setStarting({ ...turn, failed: true });
        }
      })
      .finally(() => {
        if (generation === submissionGeneration.current) {
          preparingRef.current = false;
          preparingTurn.current = undefined;
        }
      });
    return true;
  };
  const launchRef = useRef(launch);
  launchRef.current = launch;
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const onlineWaiters = useRef(new Set<() => void>());
  useEffect(() => {
    if (!online) return;
    onlineWaiters.current.forEach((wake) => wake());
    onlineWaiters.current.clear();
  }, [online]);
  // Send while the machine is out of reach. The message is saved to the outbox at
  // once; the pending check below sends it when the machine answers again, so it
  // never waits here for a timeout. Only a refused start (nothing saved) goes back
  // to the composer or stays as a failed message with Try again.
  const sendWhenConnected = async (
    turn: OptimisticTurn,
    options?: ComposerTurnOptions,
    generation = submissionGeneration.current,
  ) => {
    const version = bindingGen.version;
    // A conversation whose machine descriptor or snapshot is not loaded yet cannot
    // start a turn. That waits for the poll to reach the machine, with no time limit.
    const viewReady = !!descriptor && (!sessionId || !!hostSession);
    const outcome = await sendAfterReconnect({
      status: connection.status,
      reconnect: () => connection.reconnect(),
      wake: () => wake.current(),
      ready: () =>
        viewReady || onlineRef.current
          ? true
          : new Promise<boolean>((resolve) => {
              onlineWaiters.current.add(() => resolve(true));
            }),
      send: () =>
        alive.current &&
        version === bindingGen.version &&
        generation === submissionGeneration.current &&
        launchRef.current(turn, generation),
    });
    if (
      outcome.sent ||
      !alive.current ||
      version !== bindingGen.version ||
      generation !== submissionGeneration.current
    )
      return;
    preparingRef.current = false;
    preparingTurn.current = undefined;
    // The connection banner already says why a reconnect failed.
    if (options?.onSendRejected?.())
      setStarting((current) => (current?.commandId === turn.commandId ? undefined : current));
    else setStarting({ ...turn, failed: true });
  };

  // `!commands` this window sent; the agent carries on once each one finishes.
  const shellFollowUps = useRef(new Map<string, { authorityGeneration?: number }>());
  const dispatchShell = (
    id: string,
    command: string,
    authorityGeneration?: number,
    optimistic?: OptimisticTurn,
  ) => {
    const commandId = newRequestId();
    return run(
      {
        type: "shell",
        ...remoteIntentAuthority({ authorityGeneration }),
        commandId,
        sessionId: id,
        line: command,
      },
      optimistic,
    ).then((receipt) => {
      if (!receipt) return;
      shellFollowUps.current.set(commandId, remoteIntentAuthority({ authorityGeneration }));
      if (alive.current) setRefresh((value) => value + 1);
    });
  };
  useEffect(() => {
    for (const [id, authority] of Array.from(shellFollowUps.current)) {
      const block = hostSession?.blocks.find((entry) => entry.id === id);
      if (!block?.shell || block.shell.running) continue;
      shellFollowUps.current.delete(id);
      if (!remoteIntentAuthorityMatches(authority, snapshot)) {
        setError(
          t(
            "This queued request belongs to an earlier session authority. Review it and create a new message to continue.",
          ),
        );
        continue;
      }
      submit(SHELL_FOLLOW_UP_PROMPT);
    }
  }, [hostSession, snapshot?.authorityGeneration]);

  /** Runs a `!command` on the host. It is not a turn: nothing is queued or
   * retried, and a refused one stays in the composer. */
  const runShell = (command: string, options?: ComposerTurnOptions): boolean => {
    if (!descriptor) {
      setError(t("This project’s machine isn’t connected yet."));
      return false;
    }
    if (!descriptor.capabilities.includes(SESSION_SHELL)) {
      setError(t(HOST_UPDATE_NOTICE));
      return false;
    }
    if (sendingRef.current || preparingRef.current) return false;
    const version = bindingGen.version;
    const optimistic = optimisticTurn(`!${command}`, [], "default", false);
    optimistic.onSendRejected = options?.onSendRejected;
    const failed = (reason: unknown) => {
      if (alive.current && version === bindingGen.version) {
        reportRemoteConnection(remotePath(machine.environmentId, project.cwd), "session", reason);
        setError(describeRemoteError(reason).message);
      }
    };
    setError("");
    if (hostSession) {
      void dispatchShell(hostSession.id, command, snapshot?.authorityGeneration, optimistic).catch(
        failed,
      );
      return true;
    }
    // A new conversation: the command needs a session to run in.
    if (sessionId || !draft.model || projectless) return false;
    const managedCreation = descriptor.capabilities.includes("sessions.managedCreation.v1");
    if (!managedCreation && draftWorkspaceMode === "worktree") {
      setError(t("Update bycoda to create managed sessions on this remote Host."));
      return false;
    }
    preparingRef.current = true;
    void (async () => {
      const reservedSessionId = managedCreateId();
      const workspace = await prepareSessionWorkspace(
        {
          ...shell,
          id: reservedSessionId,
          cwd: project.key,
          workspaceMode: draftWorkspaceMode,
          worktreeBase: draftWorktreeBase,
          worktreeCwd: selectedCwd !== project.cwd ? selectedCwd : undefined,
        },
        !!managedCreation,
      );
      if (!alive.current || version !== bindingGen.version) return undefined;
      const cwd = workspace?.path ?? selectedCwd;
      return run({
        type: "create",
        commandId: reservedSessionId,
        ...(managedCreation ? { sessionId: reservedSessionId } : {}),
        projectId: project.projectId,
        ...(workspace ? { workspaceId: workspace.id } : {}),
        ...(draftWorkspaceMode === "current" ? { workspaceMode: "current" as const } : {}),
        ...(cwd !== project.cwd ? { worktreeCwd: cwd } : {}),
        harness: draft.harness,
        model: draft.model,
        modelSettings: draft.settings,
        runtimeMode: draft.mode,
      });
    })()
      .then((receipt) =>
        receipt
          ? dispatchShell(receipt.sessionId, command, receipt.authorityGeneration, optimistic)
          : undefined,
      )
      .catch(failed)
      .finally(() => {
        preparingRef.current = false;
      });
    return true;
  };

  const submit = (
    text: string,
    attachments: Attachment[] = [],
    options?: ComposerTurnOptions,
    asDraft = false,
    planBlockId?: string,
    queuedId?: string,
    onAcceptance?: (accepted: boolean) => void,
  ): boolean => {
    // Every refusal below keeps the composer's text and says why, so Send is never silent.
    const refused = (reason: string): false => {
      setRefusal(reason);
      return false;
    };
    if (
      projectless &&
      descriptor &&
      !descriptor.capabilities.includes(PROJECTLESS_SESSIONS_CAPABILITY)
    )
      return refused(
        t("This host cannot start sessions without a project. Update it and try again."),
      );
    if (hasForeignMachineAttachment(attachments, machine.environmentId))
      return refused(
        t("This file belongs to another machine. Remove it or switch back before sending."),
      );
    if (
      !asDraft &&
      shell.pendingContextReplay &&
      shell.pendingContextReplay !== consumedContextReplay.current &&
      descriptor &&
      !descriptor.capabilities.includes("sessions.contextReplay.v1")
    )
      return refused(t("Update the Host to preserve this conversation's context before sending."));
    if (rewindOwner.current) return refused(t("A rewind is in progress. Your message is kept."));
    // Repeated Send must keep its draft while the preceding send is preparing
    // or awaiting acknowledgement. Explicit Queue remains available.
    if (
      (preparingRef.current || sendingRef.current || pending) &&
      options?.followUpBehavior !== "queue"
    )
      return refused(t("The previous message is still being sent. Your message is kept."));
    if (remoteDeleted)
      return refused(t("This conversation was deleted on the machine. Your message is kept."));
    if (pageCacheOnly)
      return refused(
        t("The latest messages have not loaded from the machine yet. Your message is kept."),
      );
    if (snapshotRef.current?.historyLoading)
      return refused(t("This conversation is still loading. Send again in a moment."));
    if (queue.error)
      return refused(
        t("Queued messages could not be read, so sending is held. Your message is kept."),
      );
    const queuedRow = queuedId
      ? queue.current().messages.find((row) => row.id === queuedId)
      : undefined;
    if (queuedId && !queuedRow) return refused(t("This queued message is no longer available."));
    const authority = remoteIntentAuthority(
      queuedId ? queuedRow : hostSession ? snapshot : undefined,
    );
    if (queuedRow && !remoteIntentAuthorityMatches(queuedRow, snapshot)) {
      setError(
        t(
          "This queued request belongs to an earlier session authority. Review it and create a new message to continue.",
        ),
      );
      queue.pause();
      return false;
    }
    const hostDraft = options?.draftBlockId
      ? hostSession?.blocks.find((block) => block.id === options.draftBlockId)
      : undefined;
    // A host-accepted follow-up is already owned by its delivery chain. Until
    // it settles, sending its draft action must not queue a second copy.
    if (
      hostDraft?.followUpDelivery &&
      (hostDraft.followUpDelivery === "pending" || busy || pending || !online)
    )
      return refused(t("This follow-up is already being delivered. Your message is kept."));
    setRefusal("");
    beginSessionPerformanceTrace(shell.id);
    const shellCommand =
      asDraft || queuedId || attachments.length || options?.draftBlockId || planBlockId
        ? undefined
        : parseShellCommand(text);
    if (shellCommand) return runShell(shellCommand, options);
    if (
      busy &&
      remoteCanSteer &&
      queue.loaded &&
      online &&
      !changes &&
      !sending &&
      !pending &&
      !preparingRef.current &&
      !asDraft &&
      !options?.draftBlockId &&
      !planBlockId &&
      (!options?.intent || options.intent === "default") &&
      !consumeOperatorCommand(text).matched &&
      options?.followUpBehavior !== "queue" &&
      hostSession &&
      snapshot?.runId &&
      (text.trim() || attachments.length)
    ) {
      const generation = followUpGeneration.current;
      const submission = submissionGeneration.current;
      const version = bindingGen.version;
      const targetSessionId = hostSession.id;
      const runId = snapshot.runId;
      const unsent = {
        ...authority,
        id: queuedId ?? newRequestId(),
        text,
        attachments,
        intent: options?.intent,
        modelTarget: {
          harness: hostSession.harness,
          model: hostSession.model,
          modelSettings: { ...hostSession.modelSettings },
          ...(canSelectProviderAccount && supportsProviderAccounts(hostSession.harness)
            ? { providerAccountId: hostSession.providerAccountId ?? DEFAULT_PROVIDER_ACCOUNT_ID }
            : {}),
        },
      };
      if (
        !queue.current().messages.some((message) => message.id === unsent.id) &&
        !canEnqueueRemoteMessage(queue.current(), unsent)
      ) {
        setError(t("Remote queue is full. Send or remove queued messages before adding more."));
        return false;
      }
      // Reserve recovery space while upload/steering is in flight. New queued
      // submissions cannot consume the slot needed if this follow-up is refused.
      reservedFollowUp.current = unsent;
      // A follow-up the host did not take is kept. An explicit refusal holds
      // the queue for the owner; a coordination failure (a desktop-owned turn,
      // an unreachable host) sent nothing, so it just goes out after the turn.
      // The composer already let go of the text, so the queue must take it: it is
      // tried again while the queue is busy, and if it still cannot be kept the
      // message stays on screen with "Try again" instead of vanishing.
      const holdFollowUp = async (
        event: QueueEvent = followUpRefusalEvent(lastRunFailure.current),
        reason?: string,
      ): Promise<boolean> => {
        if (await queue.keep(unsent, event !== "coordination")) return true;
        if (alive.current) {
          const intent =
            unsent.intent === "plan" || unsent.intent === "build" ? unsent.intent : "default";
          setStarting({
            ...optimisticTurn(text, attachments, intent),
            authorityGeneration: authority.authorityGeneration,
            failed: true,
          });
          setError(
            reason
              ? t("The follow-up could not be saved to the queue: {p0}", { p0: reason })
              : t("The follow-up could not be saved to the queue. It is shown above."),
          );
        }
        return false;
      };
      preparingRef.current = true;
      setFollowUpPreparing(true);
      void (async () => {
        const commandId = newRequestId();
        let accepted = false;
        try {
          const files = await uploadRemoteAttachments(machine.id, attachments, {
            ownership,
            ownershipSource: `submit:${commandId}`,
            environmentId: machine.environmentId,
            resumable: descriptor?.capabilities.includes("attachments.resume"),
            onProgress: (_id, offset, size) => {
              if (
                alive.current &&
                version === bindingGen.version &&
                generation === followUpGeneration.current
              )
                setUploadProgress({ offset, size });
            },
          });
          if (
            !alive.current ||
            version !== bindingGen.version ||
            generation !== followUpGeneration.current
          ) {
            if (alive.current && version === bindingGen.version) await holdFollowUp("pause");
            return;
          }
          const receipt = await run({
            type: "steer",
            ...authority,
            commandId,
            sessionId: targetSessionId,
            runId,
            text,
            attachments: files,
            ...(queuedId ? { queued: queue.dispatch(queuedId) } : {}),
          });
          accepted = !!receipt;
          // Explicit rejection clears the outbox. An ambiguous response stays
          // there under its original command ID and must never also be queued.
          if (
            !receipt &&
            alive.current &&
            version === bindingGen.version &&
            (
              await readDurableRemoteCommand(
                project.key,
                machine.environmentId,
                targetSessionId,
                shell.id,
              )
            ).command?.commandId !== commandId
          )
            await holdFollowUp();
        } catch (reason) {
          if (alive.current && version === bindingGen.version) {
            if (await holdFollowUp(undefined, errorText(reason)))
              setError(t("Could not deliver the follow-up: {p0}", { p0: errorText(reason) }));
          }
        } finally {
          onAcceptance?.(accepted);
          ownership?.finishJob(`submit:${commandId}`);
          if (reservedFollowUp.current === unsent) reservedFollowUp.current = undefined;
          if (submission === submissionGeneration.current) {
            preparingRef.current = false;
            if (alive.current && version === bindingGen.version) {
              setFollowUpPreparing(false);
              setUploadProgress(undefined);
            }
          }
        }
      })();
      return true;
    }
    if (
      (text.trim() || attachments.length) &&
      shouldQueueRemoteMessage({
        busy,
        working: sending || preparingRef.current || !!pending,
        asDraft,
      })
    ) {
      // Before the saved queue is read, or without a session to key it by,
      // the composer keeps the message.
      if (queuedId || !queue.loaded || !activeSessionId) return false;
      const queued = {
        ...authority,
        id: crypto.randomUUID(),
        text,
        attachments,
        intent: options?.intent,
        modelTarget: {
          harness: configuration.harness,
          model: configuration.model,
          modelSettings: { ...configuration.settings },
          ...(canSelectProviderAccount && supportsProviderAccounts(configuration.harness)
            ? { providerAccountId: selectedProviderAccountId ?? DEFAULT_PROVIDER_ACCOUNT_ID }
            : {}),
        },
      };
      const currentQueue = queue.current();
      const reserved = reservedFollowUp.current;
      const capacityQueue =
        reserved && !currentQueue.messages.some((message) => message.id === reserved.id)
          ? { ...currentQueue, messages: [...currentQueue.messages, reserved] }
          : currentQueue;
      if (!canEnqueueRemoteMessage(capacityQueue, queued)) {
        setError(t("Remote queue is full. Send or remove queued messages before adding more."));
        return false;
      }
      return queue.enqueue(queued) !== false;
    }
    if (!text.trim() && !attachments.length) return false;
    if (sending || preparingRef.current || pending || busy)
      return refused(t("This conversation is busy. Your message is kept."));
    const intent =
      options?.intent === "plan" || options?.intent === "build" ? options.intent : "default";
    const turn = optimisticTurn(
      text,
      attachments,
      intent,
      asDraft,
      options?.draftBlockId,
      planBlockId,
    );
    turn.authorityGeneration = authority.authorityGeneration;
    turn.onSendRejected = options?.onSendRejected;
    if (queuedId) turn.queued = queue.dispatch(queuedId, options?.followUpBehavior === "steer");
    const generation = ++submissionGeneration.current;
    preparingRef.current = true;
    preparingTurn.current = turn;
    setStarting(turn);
    if (!online) {
      void sendWhenConnected(turn, options, generation);
      return true;
    }
    return launch(turn, generation, onAcceptance);
  };

  const working = sending || !!pending || followUpPreparing;
  const queuedSession: Session = {
    ...(hostSession ?? shell),
    busy,
    ...queueSessionFields(queue.queue),
  };
  const nextQueued = nextRemoteQueuedMessage({
    session: queuedSession,
    loaded: queue.loaded && queue.canDrain,
    online,
    canSend: connection.canSend && !snapshot?.historyLoading && !pageCacheOnly && !remoteDeleted,
    working,
    changing: !!changes,
  });
  // Send the head of the queue once the turn is over and the machine is
  // reachable. A held queue loses nothing: it simply waits for both. The send
  // itself stays in `submit`; the hook only schedules it.
  const { retryDrain } = useQueuedSendDrain({
    next: nextQueued,
    pageCacheOnly,
    remoteDeleted,
    authorityGeneration: snapshot?.authorityGeneration,
    saved,
    providers,
    capabilities: descriptor?.capabilities,
    queue,
    leaseWait,
    submit,
    requestChange: setChanges,
    reportError: setError,
  });

  // After a restart or a reconnect: a run this app saw working that the host
  // now reports as lost is continued once, when the setting says so.
  const hostSnapshot = snapshot && snapshot.session.id === sessionId ? snapshot : undefined;
  useRemoteRecovery({
    environmentId: machine.environmentId,
    shellId: shell.id,
    hostSessionId: hostSession?.id,
    status: hostSnapshot?.status,
    runId: hostSnapshot?.runId,
    fresh: online && !pageCacheOnly && !remoteDeleted,
    providerSessionId: hostSession?.providerSessionId,
    queueLoaded: queue.loaded,
    queuedCount: queue.queue.messages.length,
    ready:
      online &&
      !pageCacheOnly &&
      !remoteDeleted &&
      connection.canSend &&
      !busy &&
      !working &&
      !changes,
    send: () => submit(CONTINUE_PROMPT, []),
  });
  const interruptedTurn = remoteTurnInterrupted({
    status: hostSnapshot?.status,
    providerSessionId: hostSession?.providerSessionId,
    busy,
  });

  const modelSource = useMemo<ModelSource>(
    () =>
      buildRemoteModelSource({
        catalog,
        environmentId: machine.environmentId,
        hostSession,
        descriptor,
        providers,
        refreshCatalog,
      }),
    [
      catalog,
      catalogError,
      refreshCatalog,
      descriptor,
      providers,
      machine.environmentId,
      hostSession?.harness,
      hostSession?.model,
      hostSession?.modelSettings,
    ],
  );

  // Show a message the host has not confirmed yet in the transcript.
  // A draft being sent is replaced by its message at once, as locally.
  const leavingDrafts = new Set(
    [
      removingDraft,
      startingActive ? starting?.draftBlockId : undefined,
      pendingSendActive && pending?.type === "send" ? pending.draftBlockId : undefined,
      unseenActive ? unseenSend?.draftBlockId : undefined,
    ].filter(Boolean),
  );
  const blocks: Block[] = (hostSession?.blocks ?? []).filter(
    (block) => !leavingDrafts.has(block.id),
  );
  const unconfirmed: Block | undefined =
    unseenActive && unseenSend
      ? {
          id: unseenSend.commandId,
          role: "user",
          text: unseenSend.text,
          attachments: unseenSend.attachments,
          startedAt: unseenSend.startedAt,
          turnModel: unseenSend.turnModel,
        }
      : pendingSendActive && pending
        ? {
            id: pending.commandId,
            role: "user",
            text: pending.type === "send" ? pending.text : "/compact",
          }
        : (startingActive || (starting?.failed && !starting.draft)) && starting
          ? {
              id: starting.commandId,
              role: "user",
              text: starting.text,
              attachments: starting.attachments,
              draft: starting.draft,
              startedAt: starting.startedAt,
              turnModel: starting.turnModel,
            }
          : undefined;
  const session: Session = {
    ...(hostSession ?? {
      title: shell.title,
      blocks: [],
    }),
    id: shell.id,
    adoptedAuthorityGeneration: hostSession ? snapshot?.authorityGeneration : undefined,
    hostBinding: hostSessionBinding(shell),
    providerAccountId: selectedProviderAccountId,
    usageLimit: hostSession
      ? usageLimitAfterTargetChange(hostSession, {
          ...configuration,
          providerAccountId: selectedProviderAccountId,
        })
      : undefined,
    cwd: projectless ? "~" : displayPath(project.cwd),
    remoteExecutionEnvironmentId: shell.remoteExecutionEnvironmentId,
    worktreeCwd:
      projectless || executionCwd === project.cwd ? undefined : displayPath(executionCwd),
    workspaceMode: hostSession ? undefined : draftWorkspaceMode,
    worktreeBase: hostSession ? undefined : draftWorktreeBase,
    branch: branches?.current ?? hostSession?.branch,
    harness: configuration.harness,
    model: configuration.model,
    modelSettings: configuration.settings,
    runtimeMode: configuration.mode,
    busy,
    ...(hostSession?.pendingQuestion &&
    pending?.type === "answer" &&
    pending.sessionId === hostSession.id &&
    pending.runId === snapshot?.runId &&
    pending.requestId === hostSession.pendingQuestion.requestId
      ? {
          pendingQuestion: {
            ...hostSession.pendingQuestion,
            delivery: sending ? "sending" : "unknown",
            error: sending
              ? undefined
              : t(
                  "Answer delivery could not be confirmed. Check the connection before continuing.",
                ),
          },
        }
      : {}),
    blocks: unconfirmed ? [...blocks, unconfirmed] : blocks,
    historyPartial: snapshot?.history?.before !== undefined,
    historyLoading: !!snapshot?.historyLoading || remoteHistoryLoading,
    ...queueSessionFields(queue.queue),
  };

  const catalogFailure = catalog?.errors[configuration.harness] ?? catalogError;
  // A Codex probe that only timed out keeps the retained models usable; it is not an owner-facing failure.
  const retainedCodexProbeTimeout =
    configuration.harness === "codex" &&
    !!catalog?.models.codex?.length &&
    !!catalogFailure &&
    (/\btimed out\b/i.test(catalogFailure) ||
      classifyRemoteError(catalogFailure).kind === "temporary");
  const { visibleError: catalogProblem } = useGracedFailure({
    error: retainedCodexProbeTimeout ? "" : catalogFailure,
    retry: refreshCatalog,
    loading: catalogLoading,
    scope: questionDraftScope,
  });
  /** Reconciles a pending command. Automatic dispatch requires proof it never left the client. */
  const retryPending = async (automatic = false): Promise<"settled" | "retry" | "stop"> => {
    if (!pending || sendingRef.current) return "retry";
    const risky =
      pending.type === "shell" ||
      pending.type === "cancel" ||
      pending.type === "approve" ||
      pending.type === "answer";
    const stored = await readDurableRemoteEntry(
      project.key,
      machine.environmentId,
      pending.commandId,
    );
    const needsVerification = !stored.entry?.savedAt;
    const stopped = !!stored.entry?.stopRequested;
    let recovered: CommandReceipt | null | undefined;
    const version = bindingGen.version;
    if (descriptor?.capabilities.includes("commands.status")) {
      try {
        recovered = await executionClient.commandStatus(pending.commandId);
      } catch (reason) {
        if (
          pending.type === "steer" &&
          classifyCommandFailure(reason) === "definitive" &&
          steerWaitReason(String(reason))
        ) {
          // The Host retained the undelivered draft or queue row. Retire this
          // command ID so an owner can retry once the turn is ready.
          await settleDurableRemoteCommand(project.key, machine.environmentId, pending);
          const remaining = await readDurableRemoteCommand(
            project.key,
            machine.environmentId,
            sessionId ?? null,
            shell.id,
          );
          if (alive.current && version === bindingGen.version) setPending(remaining.command);
          return "settled";
        }
        if (!automatic)
          setError(
            t("Couldn’t check whether the host accepted this request: {p0}", {
              p0: describeRemoteError(reason).message,
            }),
          );
        return "retry";
      }
    }
    if (!recovered && remoteRequestPastRetryLimit(pending.commandId)) {
      setError(remoteOutcomeUnknownMessage());
      return "stop";
    }
    if (!recovered && hostSession && !remoteIntentAuthorityMatches(pending, snapshot)) {
      setError(
        t(
          "This pending request belongs to an earlier session authority. It was kept for recovery; review it before creating a new request.",
        ),
      );
      return "stop";
    }
    if (
      (recovered === null || recovered === undefined) &&
      (risky || needsVerification || stopped)
    ) {
      setError(
        t(
          "The host cannot confirm whether this request ran. Check the host before clearing it; it was kept for recovery.",
        ),
      );
      return "stop";
    }
    const knownNotSent = commandFailureKind(pending.commandId) === "not-sent";
    if (!recovered && !knownNotSent) {
      setError(t("Remote outcome is unknown. Check the target before another run."));
      return automatic && descriptor?.capabilities.includes("commands.status") ? "retry" : "stop";
    }
    if (!stopped) setStarting((current) => (current ? { ...current, failed: false } : current));
    lastCommandFailure.current = undefined;
    const receipt = recovered
      ? await run(pending, undefined, undefined, recovered)
      : await run(pending);
    if (!receipt) return commandFailureKind(pending.commandId) === "definitive" ? "stop" : "retry";
    if (receipt && pending.type === "shell")
      shellFollowUps.current.set(pending.commandId, remoteIntentAuthority(pending));
    if (receipt && pending.type === "create" && !stopped && version === bindingGen.version) {
      const next = (
        await readDurableRemoteCommand(
          project.key,
          machine.environmentId,
          receipt.sessionId,
          shell.id,
        )
      ).command;
      if (next) await run(next);
    }
    return "settled";
  };

  // Check the Host receipt, or send a proven undelivered command with its original
  // ID. The check runs while the machine answers, on going online or
  // recovering, on window focus, and on a backoff timer that starts at 2 s and stops
  // at 30 s. It never runs while a send is in flight, and stops for good once the
  // Host refuses the request or its ID is past the replay horizon.
  const pendingId = pending?.commandId;
  const pendingHostBlock = !!pendingId && hasHostBlock(pendingId);
  useEffect(() => {
    if (!pendingId || sending || sendingRef.current || pageCacheOnly || remoteDeleted) return;
    if (!online && !pendingHostBlock) return;
    let state = commandRetry.current;
    if (state?.commandId !== pendingId) {
      state = {
        commandId: pendingId,
        backoff: createCommandRetryBackoff(),
        running: false,
        stopped: false,
      };
      commandRetry.current = state;
    }
    if (state.running || state.stopped) return;
    const wait = state.backoff.remainingMs();
    if (wait > 0) {
      const timer = setTimeout(() => setRetryTick((value) => value + 1), wait);
      return () => clearTimeout(timer);
    }
    const current = state;
    current.running = true;
    void retryPending(true)
      .then(
        (outcome) => {
          if (outcome === "settled") current.backoff.reset();
          else if (
            outcome === "stop" ||
            current.backoff.failures + 1 >= COMMAND_RETRY_AUTOMATIC_LIMIT
          )
            current.stopped = true;
          else current.backoff.failed();
        },
        () => {
          current.backoff.failed();
        },
      )
      .finally(() => {
        current.running = false;
        if (alive.current) setRetryTick((value) => value + 1);
      });
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- retryPending reads this render's state; the ticks say when to look again.
  }, [
    pendingId,
    pendingHostBlock,
    sending,
    online,
    pageCacheOnly,
    remoteDeleted,
    connection.status,
    recoveryTick,
    focusTick,
    retryTick,
  ]);
  useEffect(() => {
    const focus = () => setFocusTick((value) => value + 1);
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, []);
  const retryStopped =
    pending &&
    commandRetry.current?.commandId === pending.commandId &&
    commandRetry.current.stopped;
  const pendingNeedsConfirmation =
    pending &&
    (["shell", "cancel", "approve", "answer"].includes(pending.type) ||
      commandFailureKind(pending.commandId) !== "not-sent");
  // While the central notice says the machine is reconnecting, a saved request waiting for it adds no
  // second alert; the request stays saved and goes out by itself.
  const outageShownCentrally = useConnectionErrorShownCentrally(error);
  const waitingForReconnect =
    !!pending && !sending && !retryStopped && !online && !pendingNeedsConfirmation;
  // A busy host (deadline, overload) is read again quietly first; sending stays held meanwhile.
  const { pending: queueRetrying, visibleError: queueProblem } = useGracedFailure({
    error: queue.error,
    retry: queue.retryRead,
    scope: questionDraftScope,
  });
  const notice =
    queueProblem && !pendingNeedsConfirmation
      ? remoteQueueReadNotice(queueProblem, queue.retry, queue.failure, machine.name)
      : pending && !sending && !(waitingForReconnect && outageShownCentrally)
        ? remotePendingRequestNotice(
            retryStopped,
            online,
            pendingNeedsConfirmation,
            error,
            () =>
              void retryPending().catch((reason) => setError(describeRemoteError(reason).message)),
          )
        : starting?.failed
          ? {
              text: starting.draft
                ? t("Couldn’t save the draft on {p0}.", { p0: hostLabel })
                : t("Couldn’t send the message on {p0}.", { p0: hostLabel }),
              detail: error,
              action: {
                kind: "retry",
                get label() {
                  return t("Try again");
                },
                run: () => {
                  const turn = { ...starting, failed: false };
                  const version = bindingGen.version;
                  const generation = ++submissionGeneration.current;
                  setStarting(turn);
                  preparingRef.current = true;
                  preparingTurn.current = turn;
                  if (!sessionId) void startSession(turn, generation);
                  else
                    void dispatchTurn(sessionId, turn, undefined, generation)
                      .then((sent) => {
                        if (
                          alive.current &&
                          version === bindingGen.version &&
                          generation === submissionGeneration.current
                        )
                          if (!sent) setStarting({ ...turn, failed: true });
                      })
                      .catch((reason) => {
                        if (
                          alive.current &&
                          version === bindingGen.version &&
                          generation === submissionGeneration.current
                        ) {
                          setError(describeRemoteError(reason).message);
                          setStarting({ ...turn, failed: true });
                        }
                      })
                      .finally(() => {
                        if (generation === submissionGeneration.current) {
                          preparingRef.current = false;
                          preparingTurn.current = undefined;
                        }
                      });
                },
              },
            }
          : refusal
            ? {
                text: refusal,
                action: {
                  kind: "dismiss",
                  get label() {
                    return t("Dismiss");
                  },
                  run: () => setRefusal(""),
                },
              }
            : error
              ? {
                  text: error,
                  action: {
                    kind: "dismiss",
                    get label() {
                      return t("Dismiss");
                    },
                    run: () => setError(""),
                  },
                }
              : catalogProblem
                ? {
                    text: t("Couldn’t load models from {p0}.", { p0: hostLabel }),
                    detail: catalogProblem,
                    action: {
                      kind: "retry",
                      get label() {
                        return t("Retry");
                      },
                      run: retryCatalog,
                    },
                  }
                : undefined;

  // The notice the owner closed; different text or detail shows again.
  const [closedNotice, setClosedNotice] = useState("");
  const noticeKey = notice ? JSON.stringify([notice.text, notice.detail ?? ""]) : "";
  const deletedNotice = remoteDeleted ? t("This conversation was deleted on the host.") : "";

  // A transport failure has one recovery owner above the conversation. Keep
  // independent queue/storage and command failures actionable in their own notice.
  const noticeHandledByConnection =
    connectionIssueHandled &&
    !pendingNeedsConfirmation &&
    !!notice &&
    isConnectionFailure(classifyRemoteError(notice.detail || notice.text));

  const selectWorktree = async (tree: Worktree) => {
    const parsed = owner
      ? { environmentId: owner.environmentId, hostPath: tree.path }
      : parseRemotePath(tree.path);
    if (!parsed || parsed.environmentId !== machine.environmentId)
      throw new Error(t("Choose a worktree on this machine"));
    if (sessionId)
      throw new Error(t("This session’s worktree is fixed. Start a new session to use another."));
    if (parsed.hostPath === executionCwd) return;
    rememberRemotePendingWorktree(shell.id, parsed.hostPath);
    setSelectedCwd(parsed.hostPath);
  };

  const buildPlan = (blockId: string, target?: PlanBuildTarget) => {
    const block = hostSession?.blocks.find(
      (entry) => entry.id === blockId && entry.role === "plan",
    );
    if (!block || !block.text.trim() || block.streaming || busy) return;
    if (
      target &&
      (target.harness !== configuration.harness ||
        target.model !== configuration.model ||
        !sameModelSettings(target.modelSettings, configuration.settings))
    ) {
      setError(t("Select that model in the composer before building this remote plan."));
      return;
    }
    submit(`Build the approved plan:\n\n${block.text}`, [], { intent: "build" }, false, blockId);
  };

  const stopTurnAsync = async () => {
    followUpGeneration.current += 1;
    submissionGeneration.current += 1;
    const stoppedTurn = preparingTurn.current;
    preparingTurn.current = undefined;
    preparingRef.current = false;
    setFollowUpPreparing(false);
    setUploadProgress(undefined);
    if (stoppedTurn)
      setStarting((current) =>
        current?.commandId === stoppedTurn.commandId ? { ...current, failed: true } : current,
      );
    queue.pause();
    const inFlight = (
      await readDurableRemoteCommand(
        project.key,
        machine.environmentId,
        bindingGen.session ?? null,
        shell.id,
      )
    ).command;
    if (inFlight?.type === "send" || inFlight?.type === "compact" || inFlight?.type === "create")
      await markDurableRemoteCommandStopped(project.key, machine.environmentId, inFlight.commandId);
    const target =
      unseenActive && unseenSend?.runId
        ? {
            sessionId: unseenSend.sessionId,
            runId: unseenSend.runId,
            ...remoteIntentAuthority(unseenSend),
          }
        : startingActive && starting?.acceptedRun
          ? starting.acceptedRun
          : snapshot?.status === "running" && hostSession && snapshot.runId
            ? {
                sessionId: hostSession.id,
                runId: snapshot.runId,
                ...remoteIntentAuthority(snapshot),
              }
            : undefined;
    if (!pageCacheOnly && target) {
      // What is queued waits for the user instead of sending as the turn ends.
      // Stop must reach the host even while a follow-up is being acknowledged.
      const command = {
        type: "cancel",
        commandId: newRequestId(),
        ...target,
      } as const;
      try {
        assertDesktopControlReceipts(command, descriptor?.capabilities);
      } catch (reason) {
        setError(t("Could not stop the turn: {p0}", { p0: errorText(reason) }));
        return;
      }
      void executionClient
        .dispatchCommand(command)
        .catch((reason) =>
          setError(t("Could not stop the turn: {p0}", { p0: describeRemoteError(reason).message })),
        );
    }
  };
  const stopTurn = () => {
    void stopTurnAsync().catch((reason) =>
      setError(t("Could not stop the turn: {p0}", { p0: describeRemoteError(reason).message })),
    );
  };
  const approve = (
    requestId: number,
    decision: Parameters<SessionPaneProps["onApproval"]>[2],
    approvalOccurrenceId?: string,
  ) => {
    const refusal = approvalOccurrenceError(approvalOccurrenceId);
    if (refusal) throw new Error(refusal);
    if (!hostSession || !snapshot?.runId) return;
    return run({
      type: "approve",
      ...remoteIntentAuthority(snapshot),
      commandId: newRequestId(),
      sessionId: hostSession.id,
      runId: snapshot.runId,
      requestId,
      decision,
      approvalOccurrenceId,
    });
  };
  // The host owns the limit; a local edit would be undone by its next snapshot.
  const usageLimit = (action: "arm" | "disarm" | "dismiss") => {
    if (!hostSession?.usageLimit) return;
    void run({
      type: "usageLimit",
      ...remoteIntentAuthority(snapshot),
      commandId: newRequestId(),
      sessionId: hostSession.id,
      action,
    });
  };
  const answer = async (
    requestId: number,
    reply: Parameters<SessionPaneProps["onQuestionReply"]>[2],
  ) => {
    if (!hostSession || !snapshot?.runId) return;
    const sessionId = hostSession.id;
    const runId = snapshot.runId;
    const commandId = newRequestId();
    const updateDelivery = (delivery: UserQuestionDelivery, error?: string) => {
      const current = snapshotRef.current;
      if (
        current?.session.id !== sessionId ||
        current.runId !== runId ||
        current.session.pendingQuestion?.requestId !== requestId
      )
        return;
      const next = {
        ...current,
        session: {
          ...current.session,
          pendingQuestion: { ...current.session.pendingQuestion, delivery, error },
        },
      };
      observeRemoteApprovalSourceExpansion(shell.id, current, next);
      snapshotRef.current = next;
      setSnapshot(next);
    };
    if (
      ["sending", "queued", "unknown"].includes(
        snapshotRef.current?.session.pendingQuestion?.delivery ?? "",
      )
    )
      return;
    let heldCommand: HostCommand | undefined;
    try {
      heldCommand = (
        await readDurableRemoteCommand(project.key, machine.environmentId, sessionId, shell.id)
      ).command;
    } catch (reason) {
      updateDelivery("failed", errorText(reason));
      return;
    }
    if (
      heldCommand?.type === "answer" &&
      heldCommand.runId === runId &&
      heldCommand.requestId === requestId
    ) {
      updateDelivery(
        "unknown",
        t("Answer delivery could not be confirmed. Check the connection before continuing."),
      );
      return;
    }
    if (sendingRef.current || pageCacheOnly || remoteDeleted || !online) {
      updateDelivery("failed", t("The host did not confirm the request."));
      return;
    }
    try {
      assertDesktopControlReceipts({ type: "answer", runId, commandId }, descriptor?.capabilities);
    } catch (reason) {
      updateDelivery("failed", errorText(reason));
      return;
    }
    updateDelivery("sending");
    const targetVersion = bindingGen.version;
    const targetMachine = machine.id;
    const authority = remoteIntentAuthority(snapshot);
    const originalQuestion = snapshotRef.current?.session.pendingQuestion;
    const questionIdentity = JSON.stringify([
      originalQuestion?.occurrenceId,
      originalQuestion?.questions,
    ]);
    let dispatched = false;
    const prepareReply = async () => {
      if (reply.kind !== "answered" || !reply.attachments) return reply;
      if (!descriptor?.capabilities.includes("sessions.questionAttachments"))
        throw new Error(t("This host cannot upload attachments."));
      return uploadQuestionAttachments(targetMachine, reply, {
        ownership,
        ownershipSource: `question:${commandId}`,
        environmentId: machine.environmentId,
        resumable: descriptor?.capabilities.includes("attachments.resume"),
        ...(descriptor?.capabilities.includes("sessions.questionAttachments.v2")
          ? { questionSessionId: sessionId, questionRequestId: requestId, questionRunId: runId }
          : {}),
      });
    };
    void prepareReply()
      .then((preparedReply) => {
        if (
          !alive.current ||
          bindingGen.version !== targetVersion ||
          snapshotRef.current?.session.id !== sessionId ||
          snapshotRef.current.runId !== runId ||
          snapshotRef.current.session.pendingQuestion?.requestId !== requestId ||
          JSON.stringify([
            snapshotRef.current.session.pendingQuestion.occurrenceId,
            snapshotRef.current.session.pendingQuestion.questions,
          ]) !== questionIdentity
        )
          throw new Error(t("The original question changed before the attachments were ready."));
        dispatched = true;
        return run({
          type: "answer",
          ...authority,
          commandId,
          sessionId,
          runId,
          requestId,
          reply: preparedReply,
        });
      })
      .then((receipt) => {
        if (receipt) return; // Host acceptance is followed by the provider's authoritative snapshot.
        // Only an explicit host refusal proves the answer was not accepted.
        // A receipt or snapshot failure must never turn into an automatic resend.
        const uncertain = !lastRunFailure.current?.includes("Host rejected request:");
        updateDelivery(
          uncertain ? "unknown" : "failed",
          uncertain
            ? t("Answer delivery could not be confirmed. Check the connection before continuing.")
            : t("The host did not confirm the request."),
        );
      })
      .catch((error: unknown) => {
        updateDelivery(dispatched ? "unknown" : "failed", describeRemoteError(error).message);
      })
      .finally(() => ownership?.finishJob(`question:${commandId}`));
  };
  const compact = () => {
    if (!hostSession || busy || pending || changes || !online) return false;
    void run({ ...message(hostSession.id, "/compact"), ...remoteIntentAuthority(snapshot) });
    return true;
  };
  const undoManaged = async (
    requestedSessionId: string,
    { workspaceId, operationId }: WorkspaceRewindUndoIdentity,
  ) => {
    const current = snapshotRef.current;
    if (
      requestedSessionId !== shell.id ||
      !current ||
      current.session.workspaceId !== workspaceId ||
      current.session.id !== bindingGen.session ||
      current.status === "running" ||
      sendingRef.current ||
      preparingRef.current ||
      !onlineRef.current ||
      pageCacheOnly ||
      remoteDeleted ||
      (sharedQueueEnabled && (!queue.loaded || queue.current().messages.length))
    )
      throw new Error(t("Wait for this session to finish before undoing the rewind."));
    const targetSessionId = current.session.id;
    const version = bindingGen.version;
    const owner = Symbol();
    rewindOwner.current = owner;
    sendingOwner.current = owner;
    sendingRef.current = true;
    setSending(true);
    setRewinding(true);
    const stillCurrent = () =>
      alive.current &&
      bindingGen.session === targetSessionId &&
      bindingGen.version === version &&
      rewindOwner.current === owner;
    try {
      const undoSession = { ...current.session, id: shell.id, cwd: project.key };
      const plan = await planWorkspaceRewind(
        undoSession,
        workspaceId,
        { operationId },
        { authorityGeneration: current.authorityGeneration },
      );
      const key = crypto.randomUUID();
      await requestWorkspaceRewindPreview(
        plan,
        async () => {
          if (
            !stillCurrent() ||
            snapshotRef.current?.revision !== current.revision ||
            snapshotRef.current?.authorityGeneration !== current.authorityGeneration
          )
            throw new Error(t("The conversation changed. Close this preview and try again."));
          await deleteRemotePageCache({
            environmentId: machine.environmentId,
            sessionId: targetSessionId,
          });
          const undone = await applyWorkspaceRewind(undoSession, plan, key, {
            authorityGeneration: current.authorityGeneration,
          });
          if (!stillCurrent() || !undone.snapshot)
            throw new Error(
              t("The complete conversation could not be loaded. Retry the rewind preview."),
            );
          snapshotRef.current = undone.snapshot;
          setSnapshot(undone.snapshot);
          rememberSessionSnapshot(
            snapshotKey(machine.id, targetSessionId),
            undone.snapshot,
            machine.environmentId,
          );
          onSnapshot?.(shell.id, undone.snapshot);
          clearWorkspaceRewindUndo(shell.id);
        },
        shell.id,
      );
    } finally {
      if (rewindOwner.current === owner) rewindOwner.current = undefined;
      if (sendingOwner.current === owner) {
        sendingOwner.current = undefined;
        sendingRef.current = false;
        if (alive.current) setSending(false);
      }
      if (alive.current) setRewinding(false);
    }
  };
  const undoManagedRef = useRef(undoManaged);
  undoManagedRef.current = undoManaged;
  useEffect(
    () =>
      registerWorkspaceRewindUndoHandler(shell.id, (id, identity) =>
        undoManagedRef.current(id, identity),
      ),
    [shell.id],
  );

  const rewind = async (blockId: string): Promise<boolean> => {
    if (
      !hostSession ||
      !snapshot ||
      busy ||
      pending ||
      changes ||
      !online ||
      pageCacheOnly ||
      remoteDeleted ||
      sendingRef.current ||
      preparingRef.current ||
      snapshot.history?.before !== undefined ||
      !descriptor?.capabilities.includes(SESSION_REWIND) ||
      (sharedQueueEnabled && (!queue.loaded || queue.queue.messages.length > 0)) ||
      !canRewindConversation(hostSession, blockId)
    )
      return false;
    const owner = Symbol();
    const targetSessionId = hostSession.id;
    const targetBindingVersion = bindingGen.version;
    const targetBinding = remoteBindingKey;
    const known = snapshot;
    rewindOwner.current = owner;
    sendingOwner.current = owner;
    sendingRef.current = true;
    setSending(true);
    setRewinding(true);
    forceTailRead.current = true;
    try {
      await deleteRemotePageCache({
        environmentId: machine.environmentId,
        sessionId: targetSessionId,
      });
      const receipt = await executionClient.dispatchCommand({
        type: "rewind",
        ...remoteIntentAuthority(known),
        commandId: newRequestId(),
        sessionId: targetSessionId,
        blockId,
        expectedRevision: known.revision,
      });
      if (receipt.sessionId !== targetSessionId || receipt.revision <= known.revision) return false;
      const stillCurrent = () =>
        alive.current &&
        bindingGen.session === targetSessionId &&
        bindingGen.version === targetBindingVersion &&
        bindingGen.key === targetBinding &&
        rewindOwner.current === owner;
      const pages =
        !!descriptor.capabilities.includes("sessions.pages") ||
        !!descriptor.capabilities.includes("sessions.lazyHistory");
      const partialHistory = !!descriptor.capabilities.includes("sessions.lazyHistory");
      let updated: HostSession | undefined;
      for (let attempt = 0; attempt < 3 && stillCurrent(); attempt += 1) {
        const candidate = await loadRemoteSession(machine.id, targetSessionId, known, {
          executionClient,
          waitMs: 0,
          pages,
          partialHistory,
          isCurrent: stillCurrent,
        });
        if (!stillCurrent()) return false;
        if (candidate.revision >= receipt.revision) {
          updated = candidate;
          break;
        }
      }
      if (!updated || !stillCurrent()) {
        forceTailRead.current = true;
        setRefresh((value) => value + 1);
        return false;
      }
      const latest = snapshotRef.current;
      if (
        latest?.session.id === targetSessionId &&
        latest.revision > updated.revision &&
        latest.revision >= receipt.revision
      )
        updated = latest;
      forceTailRead.current = false;
      setPageCacheOnly(false);
      setRemoteDeleted(false);
      snapshotRef.current = updated;
      setSnapshot(updated);
      rememberSessionSnapshot(
        snapshotKey(machine.id, targetSessionId),
        updated,
        machine.environmentId,
      );
      onSnapshot?.(shell.id, updated);
      publishRemoteDataState({ phase: updated.session.blocks.length ? "ready" : "empty" });
      return true;
    } catch (reason) {
      if (
        alive.current &&
        bindingGen.version === targetBindingVersion &&
        bindingGen.session === targetSessionId
      ) {
        reportRemoteConnection(remotePath(machine.environmentId, project.cwd), "session", reason);
        setError(describeRemoteError(reason).message);
      }
      return false;
    } finally {
      if (rewindOwner.current === owner) rewindOwner.current = undefined;
      if (sendingOwner.current === owner) {
        sendingOwner.current = undefined;
        sendingRef.current = false;
        if (alive.current) setSending(false);
      }
      if (alive.current) setRewinding(false);
    }
  };
  const saveDraft = (text: string, attachments: Attachment[]) =>
    submit(text, attachments, undefined, true);
  const removeDraft = (draftBlockId: string) => {
    if (!hostSession || busy || pending || !online || removingDraft) return false;
    if (
      hostSession.blocks.find((block) => block.id === draftBlockId)?.followUpDelivery === "pending"
    )
      return false;
    setRemovingDraft(draftBlockId);
    if (hostSession.blocks.every((block) => block.id === draftBlockId))
      void discardSession(hostSession.id);
    else
      void run({
        type: "removeDraft",
        ...remoteIntentAuthority(snapshot),
        commandId: newRequestId(),
        sessionId: hostSession.id,
        draftBlockId,
      }).then((receipt) => {
        if (!receipt && alive.current) setRemovingDraft(undefined);
      });
    return true;
  };
  const actionOwnerKey = JSON.stringify([
    remoteBindingKey,
    bindingGen.version,
    snapshot?.runId,
    snapshot?.authorityGeneration,
  ]);
  const committedActions = useRef<
    | {
        key: string;
        session: Session;
        snapshot: HostSession | undefined;
        pageCacheOnly: boolean;
        actions: Parameters<typeof registerRemoteSessionActions>[1];
      }
    | undefined
  >(undefined);
  useLayoutEffect(() => {
    committedActions.current = {
      key: actionOwnerKey,
      session,
      snapshot,
      pageCacheOnly,
      actions: {
        buildPlan,
        submit,
        saveDraft,
        removeDraft,
        selectAccount,
        stop: stopTurn,
        rewind,
        compact,
        approve,
        approvalOccurrenceSupported:
          descriptor?.capabilities.includes("sessions.approvalOccurrence.v1") === true,
        answer,
      },
    };
  });
  const registeredActions = useMemo(() => {
    const token = bindingGen.capture(remoteBindingKey, sessionId);
    const current = () => {
      const value = committedActions.current;
      return alive.current &&
        bindingGen.key === token.key &&
        bindingGen.isBound(token) &&
        value?.key === actionOwnerKey
        ? value
        : undefined;
    };
    const source = () => {
      const value = current();
      return value?.snapshot && !value.pageCacheOnly && snapshotRef.current === value.snapshot
        ? { session: value.session, snapshot: value.snapshot }
        : undefined;
    };
    return {
      buildPlan: (...args: Parameters<typeof buildPlan>) => current()?.actions.buildPlan(...args),
      submit: (...args: Parameters<Parameters<typeof registerRemoteSessionActions>[1]["submit"]>) =>
        current()?.actions.submit(...args),
      saveDraft: (...args: Parameters<typeof saveDraft>) => current()?.actions.saveDraft(...args),
      removeDraft: (...args: Parameters<typeof removeDraft>) =>
        current()?.actions.removeDraft?.(...args) ?? false,
      selectAccount: (...args: Parameters<typeof selectAccount>) =>
        current()?.actions.selectAccount?.(...args) ?? false,
      stop: () => current()?.actions.stop(),
      rewind: (...args: Parameters<typeof rewind>) =>
        current()?.actions.rewind(...args) ?? Promise.resolve(false),
      compact: () => current()?.actions.compact() ?? false,
      get approvalOccurrenceSupported() {
        return current()?.actions.approvalOccurrenceSupported === true;
      },
      approve: (
        requestId: number,
        decision: Parameters<typeof approve>[1],
        approvalOccurrenceId?: string,
      ) => {
        if (!source())
          throw new Error("Approval connection is unavailable. This decision was not sent.");
        return current()!.actions.approve(requestId, decision, approvalOccurrenceId);
      },
      approvalSource: source,
      answer: (...args: Parameters<typeof answer>) => current()?.actions.answer(...args),
    };
  }, [shell.id, actionOwnerKey]);
  useLayoutEffect(() => {
    const release = registerRemoteSessionActions(shell.id, registeredActions);
    return release;
  }, [shell.id, registeredActions]);
  useLayoutEffect(() => {
    // Both the pane and global request center must recapture the committed source.
    publishRemoteSessionActionSource(shell.id, registeredActions);
  });

  const hostFilePath = (path: string) => {
    const existing = parseRemotePath(path);
    if (existing) return path;
    const absolute =
      path.startsWith("/") || path.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(path)
        ? path
        : `${executionCwd.replace(/[\\/]+$/, "")}/${path.replace(/^\.\//, "")}`;
    return displayPath(absolute);
  };

  const outboxIssues = useDurableRemoteOutboxIssues(project.key, machine.environmentId);
  const loadEarlierRemote = async (): Promise<number> => {
    const current = snapshotRef.current;
    if (!sessionId || !current?.history || historyPageRequest.current) return 0;
    const token = bindingGen.capture(remoteBindingKey, sessionId);
    const binding = token.version;
    const request = { revision: current.revision, before: current.history.before, binding };
    historyPageRequest.current = request;
    const stillCurrent = () =>
      alive.current &&
      bindingGen.isBound(token) &&
      historyPageRequest.current === request &&
      snapshotRef.current?.revision === current.revision &&
      snapshotRef.current?.history?.before === current.history?.before;
    setRemoteHistoryLoading(true);
    setRemoteHistoryError("");
    try {
      const next = await loadRemoteHistoryPage(
        machine.id,
        sessionId,
        current,
        stillCurrent,
        executionClient,
      );
      if (!stillCurrent()) return 0;
      if (!next) {
        setRemoteHistoryError(
          "The conversation changed while loading. Try again to continue from its current version.",
        );
        setRefresh((value) => value + 1);
        return 0;
      }
      const added = Math.max(0, next.session.blocks.length - current.session.blocks.length);
      observeRemoteApprovalSourceExpansion(shell.id, current, next);
      snapshotRef.current = next;
      setSnapshot(next);
      onSnapshot?.(shell.id, next);
      rememberSessionSnapshot(snapshotKey(machine.id, sessionId), next, machine.environmentId);
      return added;
    } catch (reason) {
      if (alive.current && bindingGen.isCurrent(token) && historyPageRequest.current === request)
        setRemoteHistoryError(
          t("Couldn’t load earlier messages: {p0}", {
            p0: describeRemoteError(reason).message,
          }),
        );
      return 0;
    } finally {
      if (historyPageRequest.current === request) {
        historyPageRequest.current = null;
        if (alive.current && bindingGen.isCurrent(token)) setRemoteHistoryLoading(false);
      }
    }
  };
  const loadLargeRemoteBlock = async (blockId: string, previewRevision: number) => {
    const current = snapshotRef.current;
    if (!sessionId || !current || loadingRemoteBlocks.current.has(blockId)) return;
    // The preview keeps its own revision across deltas; the read pins the session's.
    const revision = current.revision;
    const token = bindingGen.capture(remoteBindingKey, sessionId);
    const ownerSessionId = current.session.id;
    const stub = current.session.blocks.find((block) => block.id === blockId);
    if (!stub?.remoteContent || stub.remoteContent.revision !== previewRevision) return;
    loadingRemoteBlocks.current.add(blockId);
    try {
      const full = await loadRemoteBlock(machine.id, sessionId, blockId, revision, executionClient);
      const latest = snapshotRef.current;
      if (
        !alive.current ||
        !bindingGen.isBound(token) ||
        !full ||
        !latest ||
        latest.session.id !== ownerSessionId ||
        latest.revision !== revision
      )
        return;
      const next = {
        ...latest,
        session: {
          ...latest.session,
          blocks: latest.session.blocks.map((block) => (block.id === blockId ? full : block)),
        },
      };
      observeRemoteApprovalSourceExpansion(shell.id, latest, next);
      snapshotRef.current = next;
      setSnapshot(next);
      onSnapshot?.(shell.id, next);
    } catch (reason) {
      if (alive.current && bindingGen.isCurrent(token))
        setRemoteHistoryError(
          t("Couldn’t load full output: {p0}", { p0: describeRemoteError(reason).message }),
        );
      throw reason;
    } finally {
      loadingRemoteBlocks.current.delete(blockId);
    }
  };
  const overrides: RemoteSessionOverrides = {
    questionDraftScope,
    headerStatus: remoteDeleted ? undefined : (
      <RemoteDataStatus
        cwd={owner?.environmentId ?? project.key}
        presentation="indicator"
        autoRetry={false}
        state={remoteDataState}
        onRefresh={refreshOwnerContent}
        label={t("conversation")}
        connectionIssueHandled={connectionIssueHandled}
      />
    ),
    session,
    remoteSession: true,
    remoteFeatures: {
      attachments: !!descriptor?.capabilities.includes("attachments.upload"),
      questionAttachments: !!descriptor?.capabilities.includes("sessions.questionAttachments"),
      plan: !!descriptor?.capabilities.includes("sessions.plan"),
      draft: !!descriptor?.capabilities.includes("sessions.draft"),
      steer: remoteCanSteer && !changes,
    },
    remoteSessionLoading: !!sessionId && !hostSession && !session.blocks.length,
    remoteSessionStarted: !!sessionId,
    remoteSessionRetargetBlocked: !!pending || sending || startingActive,
    remoteLifecycleTarget:
      hostSession && !remoteDeleted && !pageCacheOnly && !blocksSending(connection.status)
        ? {
            machineId: machine.id,
            sessionId: hostSession.id,
            projectKey: project.key,
            lastActivityAt: snapshot?.lastActivityAt,
          }
        : undefined,
    managedWorkspaceCreationReady: !!descriptor?.capabilities.includes(
      "sessions.managedCreation.v1",
    ),
    remoteHistoryHasMore: snapshot?.history?.before !== undefined,
    remoteHistoryLoading,
    remoteHistoryError: remoteHistoryError || undefined,
    onLoadRemoteHistory: loadEarlierRemote,
    onLoadRemoteBlock: loadLargeRemoteBlock,
    inlineVisualHost:
      !activeSessionId || isLocalSyncMachine(machine)
        ? undefined
        : {
            machineId: machine.id,
            environmentId: machine.environmentId,
            sessionId: activeSessionId,
          },
    sendBlockedReason:
      projectless &&
      descriptor &&
      !descriptor.capabilities.includes(PROJECTLESS_SESSIONS_CAPABILITY)
        ? t("This host cannot start sessions without a project. Update it and try again.")
        : deletedNotice
          ? deletedNotice
          : pageCacheOnly
            ? // Opening from the saved preview while the host answers is loading, not a problem.
              blocksSending(connection.status)
              ? t(
                  "Showing a saved transcript preview. Reconnect to confirm the host before sending.",
                )
              : t("Loading conversation…")
            : queue.error
              ? queueRetrying
                ? t(
                    "Waiting for the bycoda Host to coordinate the queued messages. They send as soon as it answers.",
                  )
                : t("Could not load queued messages.")
              : snapshot?.historyLoading
                ? t("Loading earlier messages…")
                : outboxIssues.length
                  ? t("An unfinished request needs recovery.")
                  : blocksSending(connection.status)
                    ? needsSignIn(connection.status)
                      ? t("{p0} needs you to sign in first.", {
                          p0: hostLabel,
                        })
                      : t("Can’t reach {p0}. Send reconnects first.", { p0: hostLabel })
                    : undefined,
    allowedModelHarnesses:
      hostSession && !descriptor?.capabilities.includes("sessions.harnessSwitch")
        ? [hostSession.harness]
        : providers.length
          ? providers
          : ["codex", "claude"],
    onSubmit: (_, text, attachments, options) => submit(text, attachments, options),
    onStop: stopTurn,
    onRewindMessage: descriptor?.capabilities.includes(SESSION_REWIND)
      ? (requestedSessionId, blockId) =>
          requestedSessionId === shell.id ? rewind(blockId) : Promise.resolve(false)
      : undefined,
    onApproval: (_, requestId, decision, expected) => {
      const source = () => registeredActions.approvalSource()?.session;
      return submitApprovalIntent(source(), requestId, decision, expected, source);
    },
    onQuestionReply: (_, requestId, reply) => answer(requestId, reply),
    onCompactContext: compact,
    onSelectProviderAccount: canSelectProviderAccount
      ? (_, provider, accountId) => {
          selectAccount(provider, accountId);
        }
      : undefined,
    onModelChange: (_, harness, model, accountId) => {
      if (!isRemoteProvider(harness)) return;
      if (
        canSelectProviderAccount &&
        accountId &&
        (!supportsProviderAccounts(harness) || !accountAvailable(harness, accountId))
      )
        return;
      updateConfiguration((current) => ({
        ...current,
        harness,
        model,
        providerAccountId:
          canSelectProviderAccount && accountId
            ? accountId === DEFAULT_PROVIDER_ACCOUNT_ID
              ? null
              : accountId
            : current.harness === harness
              ? current.providerAccountId
              : undefined,
        settings: carryModelSettings(
          modelSource.resolve(harness, model).settings ?? [],
          current.settings,
        ),
      }));
    },
    onModelSettingsChange: (_, settings) =>
      updateConfiguration((current) => ({ ...current, settings })),
    onRuntimeModeChange: (_, mode) => updateConfiguration((current) => ({ ...current, mode })),
    onOpenFile: (path, navigation, options) => {
      if (navigation || options) onOpenFile(hostFilePath(path), navigation, options);
      else onOpenFile(hostFilePath(path));
    },
    onOpenDiff: (path, checkpoint) => onOpenDiff(path ? hostFilePath(path) : undefined, checkpoint),
    // This computer's features do not apply to a host session.
    onCwdChange: noop,
    onBranchChange: () => {
      notifyGitChanged();
    },
    onWorktreeChange: (_, tree) => selectWorktree(tree),
    onWorkspaceModeChange: (_, mode, base) => {
      setDraftWorkspaceMode(mode);
      if (base) setDraftWorktreeBase(base);
    },
    onWorktreeBaseChange: (_, base) => setDraftWorktreeBase(base),
    onManageWorktrees: undefined,
    onSaveDraft: (_, text, attachments) => saveDraft(text, attachments),
    onRemoveDraft: (_, draftBlockId) => removeDraft(draftBlockId),
    onPlaceSessionInFolder: noop,
    onDeleteQueuedMessage: (_, id) => queue.removeUndoable(id),
    onEditQueuedMessage: (_, id, text, attachments) => queue.edit(id, text, attachments),
    onQueuedMessageEditingChange: (_, id) => queue.setEditing(id),
    onReorderQueuedMessages: (_, ids) => queue.reorder(ids),
    onSteerQueuedMessage: async (_, id) => {
      if (!online || !hostSession || !remoteCanSteer || sending || pending || preparingRef.current)
        throw new Error(t("This conversation is still preparing. Wait and try again."));
      const retained = queue.current().messages.find((row) => row.id === id);
      if (retained && !remoteIntentAuthorityMatches(retained, snapshot))
        throw new Error(
          t(
            "This queued request belongs to an earlier session authority. Review it and create a new message to continue.",
          ),
        );
      const generation = followUpGeneration.current;
      if (!(await queue.prepareSend(true)))
        throw new Error(t("The queue could not be synchronized. Retry before sending."));
      if (generation !== followUpGeneration.current || !alive.current) return false;
      const message = queue.current().messages.find((entry) => entry.id === id);
      if (!message) return false;
      if (
        message.modelTarget &&
        !sameQueuedModelTarget(message.modelTarget, {
          harness: hostSession.harness,
          model: hostSession.model,
          modelSettings: hostSession.modelSettings ?? {},
        })
      )
        throw new Error(
          t("This queued message uses different model settings. It will wait for a new turn."),
        );
      const accepted = await new Promise<boolean>((resolve) => {
        if (
          !submit(
            message.text,
            message.attachments,
            { intent: message.intent, followUpBehavior: "steer" },
            false,
            undefined,
            id,
            resolve,
          )
        )
          resolve(false);
      });
      if (accepted) queue.sent(id);
      return accepted;
    },
    onResumeQueue: async () => {
      if (
        !online ||
        !queue.loaded ||
        pending ||
        sending ||
        preparingRef.current ||
        !connection.canSend
      )
        throw new Error(t("Reconnect to the host before resuming the queue."));
      // The host never sends a row whose delivery nobody confirmed: Resume asks for the
      // owner's choice (the inline review) instead of claiming to have resumed.
      if (queue.current().messages.some((row) => row.deliveryUnknown)) {
        if (activeSessionId) requestDeliveryReview(activeSessionId);
        return {
          kind: "waiting",
          message: t("Choose what happened to the unconfirmed message first, then resume."),
        };
      }
      if (queue.current().editingId)
        throw new Error(t("Finish editing the queued message before resuming."));
      if (queue.current().messages[0]?.attachments.some((file) => file.missing))
        throw new Error(t("An attachment is missing. Edit the queued message before resuming."));
      const retained = queue.current().messages[0];
      if (retained && !remoteIntentAuthorityMatches(retained, snapshot))
        throw new Error(
          t(
            "This queued request belongs to an earlier session authority. Review it and create a new message to continue.",
          ),
        );
      const generation = followUpGeneration.current;
      await queue.release(() => alive.current && generation === followUpGeneration.current);
      return {
        kind: "waiting",
        message: busy
          ? "Queue resumed. Messages will send when this turn finishes."
          : "Queue resumed. The next message is being prepared.",
      };
    },
    interruptedTurn,
    onUsageLimitResume: hostSession?.usageLimit ? () => submit(RESUME_PROMPT) : undefined,
    onUsageLimitResumeAtReset: (_, enabled) => usageLimit(enabled ? "arm" : "disarm"),
    onUsageLimitDismiss: () => usageLimit("dismiss"),
    onOpenPlan: (_, blockId) => onOpenPlan(shell.id, blockId),
    onBuildPlan: (_, blockId, target) => buildPlan(blockId, target),
    onSecondOpinion: undefined,
    onHandoff: undefined,
    onBtwSubmit: undefined,
    onBtwRetry: undefined,
    onBtwDelete: undefined,
    onBtwModelChange: undefined,
    onNewTerminal: noop,
    onArchiveSession: undefined,
    onDeleteSession: undefined,
    reviewUndoLocked: true,
  };

  return (
    <ModelSourceContext.Provider value={modelSource}>
      <RemoteSessionFrame compact={compactPresentation}>
        {followUpPreparing || sending ? (
          <LoadingText delay={false} inset="panel" className="shrink-0">
            {t(
              sending
                ? "Waiting for the host to confirm your request."
                : "Preparing the message and attachments…",
            )}
          </LoadingText>
        ) : null}
        {uploadProgress ? (
          <LoadingText delay={false} inset="panel" className="shrink-0">
            {t("Uploading attachment: ")}
            {Math.round(
              uploadProgress.size ? (uploadProgress.offset / uploadProgress.size) * 100 : 100,
            )}
            %
          </LoadingText>
        ) : null}
        <RemoteConnectionNotice
          cwdOrEnvironmentId={owner?.environmentId ?? project.key}
          stale={!!hostSession}
        />
        {!remoteDeleted && (
          <RemoteDataStatus
            cwd={owner?.environmentId ?? project.key}
            presentation="notice"
            state={remoteDataState}
            machineLabel={machine.name}
            onRefresh={refreshOwnerContent}
            label={t("conversation")}
            connectionIssueHandled={connectionIssueHandled}
          />
        )}
        <RemoteOutboxNotice project={project.key} environment={machine.environmentId} />
        {deletedNotice && closedNotice !== deletedNotice ? (
          <Toast
            tone="info"
            placement="top-center"
            durationMs={null}
            message={deletedNotice}
            onDismiss={() => setClosedNotice(deletedNotice)}
          />
        ) : null}
        {!remoteDeleted && notice && !noticeHandledByConnection && closedNotice !== noticeKey ? (
          // The shared alert stack (top center for warnings and errors). Closing it only hides
          // it: sending stays held, and the same problem shows again once it changes.
          <Toast
            tone={error ? "danger" : "warning"}
            durationMs={null}
            message={
              <span className="min-w-0 break-words">
                {notice.text}
                {notice.detail ? (
                  <Text size="inherit" tone="muted">
                    {" "}
                    {notice.detail}
                  </Text>
                ) : null}
              </span>
            }
            historyMessage={"history" in notice ? notice.history : notice.text}
            extra={
              "details" in notice && notice.details ? (
                <ErrorDetails title={notice.text} detail={notice.details} />
              ) : undefined
            }
            action={
              notice.action && notice.action.kind !== "dismiss"
                ? {
                    label: notice.action.label,
                    disabled: !online && !queue.error,
                    onClick: notice.action.run,
                  }
                : undefined
            }
            onDismiss={
              notice.action?.kind === "dismiss"
                ? notice.action.run
                : () => setClosedNotice(noticeKey)
            }
          />
        ) : null}
        <RemoteSessionContent compact={compactPresentation}>
          {render(overrides)}
        </RemoteSessionContent>
      </RemoteSessionFrame>
    </ModelSourceContext.Provider>
  );
}
