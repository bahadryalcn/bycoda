import { Button } from "../../../shared/ui/Button";
import { applySessionSync } from "../model/protocol";
import { mergePreviewBlocks } from "../model/mergePreviewBlocks";
import { t, useLocale } from "../../../shared/i18n";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { RemoteOutboxNotice } from "./RemoteOutboxNotice";
import { RemoteDataStatus } from "./RemoteDataStatus";
import type { RemoteDataState } from "../model/remoteDataState";
import {
  markRemoteCommandStopped,
  remoteCommandWasStopped,
  remoteCommandNeedsVerification,
  useRemoteOutboxIssues,
} from "../model/remoteOutbox";
import type { SessionPaneProps } from "../../sessions/ui/SessionPane";
import type {
  Attachment,
  Block,
  ComposerTurnOptions,
  HarnessId,
  RuntimeMode,
  Session,
  WorkspaceMode,
  PlanBuildTarget,
} from "../../sessions/model/session";
import { uploadRemoteAttachments } from "../model/remoteAttachments";
import {
  ATTACHMENT_OWNERSHIP_CAPABILITY,
  attachmentOwnerId,
  attachmentOwnershipScope,
  retryAttachmentOwnershipReleases,
  retireClosedAttachmentOwners,
} from "../model/attachmentOwnership";
import { desktopAttachmentInventory } from "../model/desktopAttachmentInventory";
import { getComposerAttachments, subscribeComposerDrafts } from "../../sessions/model/draftCache";
import { subscribePersistedComposerDrafts } from "../../sessions/data/composerDraftStore";
import { snapshotWeight } from "../model/snapshotWeight";
import {
  deleteRemotePageCache,
  readRemotePageCache,
  writeRemotePageCache,
} from "../model/remotePageCache";
import { canApplyRemotePreview } from "../model/remotePreviewBinding";
import {
  canCacheRemoteSnapshot,
  createRemoteHistoryGeneration,
} from "../model/remoteHistoryGeneration";
import {
  beginSessionPerformanceTrace,
  sessionPerformanceTrace,
  startPerformanceSpan,
  recordPerformanceEvent,
} from "../../../shared/lib/performanceTrace";
import { temporaryWorktreeBranchName } from "../../source-control/model/worktrees";
import type { AgentModel } from "../../sessions/model/models";
import { isModelEnabled } from "../../sessions/model/models";
import { remoteSessionPollDelay } from "../model/remotePollingPolicy";
import { subscribeRemoteMachineChannel } from "../model/remoteMachineChannel";
import { ModelSourceContext, type ModelSource } from "../../sessions/ui/modelSource";
import { notifyGitChanged } from "../../../platform/tauri/fs";
import type { Worktree } from "../../source-control/model/worktrees";
import { useProjectBranchesState } from "../../source-control/hooks/useProjectBranches";
import { registerRemoteSessionActions } from "../model/remoteSessionActions";
import { HOST_UPDATE_NOTICE, SESSION_REWIND, SESSION_SHELL } from "../model/remoteCapabilities";
import { canRewindConversation } from "../../sessions/model/conversationRewind";
import { parseShellCommand, SHELL_FOLLOW_UP_PROMPT } from "../../sessions/model/shellRun";
import { loadResumeAtReset } from "../../settings/model/settings";
import {
  clearPendingRemoteCommand,
  loadRemoteBlock,
  loadRemoteHistoryPage,
  loadRemoteSession,
  OPEN_CONNECTIONS_EVENT,
  pendingRemoteCommand,
  pendingRemoteFollowup,
  rememberRemotePendingWorktree,
  rememberRemoteSession,
  REMOTE_HISTORY_CHANGE,
  remoteRequest,
  reportRemoteMachineStatus,
  remotePendingWorktree,
  remoteSessionFor,
  savePendingRemoteCommand,
  sessionAccessForMachine,
  useRemoteMachines,
} from "../model/connections";
import { blocksSending, needsSignIn, sendAfterReconnect } from "../model/remoteConnection";
import { CONTINUE_PROMPT } from "../../sessions/model/inFlight";
import { consumeOperatorCommand } from "../../sessions/model/operatorCommand";
import { sameQueuedModelTarget } from "../../sessions/model/messageQueue";
import {
  canEnqueueRemoteMessage,
  nextRemoteQueuedMessage,
  queueSessionFields,
  shouldQueueRemoteMessage,
  type RemoteQueueDraft,
} from "../model/remoteQueue";
import { remoteTurnInterrupted } from "../model/remoteRecovery";
import { forgetRemoteQueue, subscribePersistedRemoteQueues } from "../model/useRemoteQueue";
import { useSharedRemoteQueue } from "../model/useSharedRemoteQueue";
import { useRemoteRecovery } from "../model/useRemoteRecovery";
import { reportRemoteConnection, subscribeRemoteRecovered } from "../model/remoteHealth";
import { useRemoteConnection } from "../model/useRemoteConnection";
import { RemoteConnectionBanner } from "./RemoteConnectionBanner";
import {
  parseRemotePath,
  remotePath,
  remoteProjectFor,
  verifyRemoteProjectAlias,
  type RemoteProject,
} from "../model/remoteProjects";
import {
  carryModelSettings,
  findRemoteModel,
  remoteModelControls,
  sameModelSettings,
} from "../model/remoteModels";
import {
  isRemoteProvider,
  REMOTE_PROVIDERS,
  requireHostDescriptor,
  type CommandReceipt,
  type HostCommand,
  type HostDescriptor,
  type HostModelCatalog,
  type HostSession,
  type HostWorktree,
  type RemoteAttachment,
  type RemoteMachine,
  type RemoteProvider,
} from "../model/protocol";

export type RemoteSessionOverrides = Partial<SessionPaneProps> & {
  remoteSession: boolean;
  remoteFeatures: { attachments: boolean; plan: boolean; draft: boolean; steer?: boolean };
  remoteSessionLoading: boolean;
  remoteSessionStarted: boolean;
  workingMachine?: string;
  /** The host recorded that this chat's last turn was lost; Continue is offered. */
  interruptedTurn: boolean;
  sendBlockedReason?: string;
  allowedModelHarnesses: readonly HarnessId[];
};

type Configuration = {
  harness: RemoteProvider;
  model: string;
  settings: Record<string, string>;
  mode: RuntimeMode;
};

type OptimisticTurn = {
  queued?: HostCommand["queued"];
  commandId: string;
  text: string;
  attachments: Attachment[];
  intent: "default" | "plan" | "build";
  draft?: boolean;
  draftBlockId?: string;
  planBlockId?: string;
  startedAt: number;
  turnModel: NonNullable<Block["turnModel"]>;
  acceptedRun?: { sessionId: string; runId: string };
};

const noop = () => {};
const cachedSessionSnapshots = new Map<string, HostSession>();
const cachedDescriptors = new Map<string, HostDescriptor>();
const cachedCatalogs = new Map<string, HostModelCatalog>();
function boundedSet<K, V>(cache: Map<K, V>, key: K, value: V, limit = 64) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > limit) cache.delete(cache.keys().next().value!);
}
const snapshotKey = (machineId: string, sessionId: string) => `${machineId}:${sessionId}`;
const catalogKey = (machineId: string, projectId: string) => JSON.stringify([machineId, projectId]);
function rememberSessionSnapshot(key: string, snapshot: HostSession, environmentId?: string) {
  if (!canCacheRemoteSnapshot(snapshot)) return;
  const existing = cachedSessionSnapshots.get(key);
  if (existing && existing.revision > snapshot.revision) return;
  cachedSessionSnapshots.delete(key);
  cachedSessionSnapshots.set(key, snapshot);
  if (cachedSessionSnapshots.size > 8)
    cachedSessionSnapshots.delete(cachedSessionSnapshots.keys().next().value!);
  let bytes = 0;
  for (const value of [...cachedSessionSnapshots.values()].reverse()) {
    bytes += snapshotWeight(value);
    if (bytes > 32 * 1024 * 1024) {
      for (const [entryKey, entry] of cachedSessionSnapshots)
        if (entry === value) cachedSessionSnapshots.delete(entryKey);
    }
  }
  if (environmentId)
    void writeRemotePageCache({ environmentId, sessionId: snapshot.session.id }, snapshot);
}

/** Isolate UI harnesses that intentionally reuse machine/session identifiers. */
export function resetRemoteSessionCachesForTests() {
  cachedSessionSnapshots.clear();
  cachedDescriptors.clear();
  cachedCatalogs.clear();
}

/** Fetches a host conversation into the snapshot cache, so its tab opens with
 * the transcript already laid out, as a local session read from disk does. */
export async function preloadRemoteSession(machineId: string, sessionId: string): Promise<void> {
  const key = snapshotKey(machineId, sessionId);
  if (cachedSessionSnapshots.has(key)) return;
  let host = cachedDescriptors.get(machineId);
  if (!host) {
    host = requireHostDescriptor(
      await remoteRequest<HostDescriptor>(machineId, "environment.describe", {
        supportedProviders: REMOTE_PROVIDERS,
      }),
    );
    boundedSet(cachedDescriptors, machineId, host);
  }
  const lazyHistory = host.capabilities.includes("sessions.lazyHistory");
  const pages = lazyHistory || host.capabilities.includes("sessions.pages");
  const snapshot = await loadRemoteSession(machineId, sessionId, undefined, {
    pages,
    partialHistory: lazyHistory,
    ...(pages ? { onPreviews: noop } : {}),
  });
  rememberSessionSnapshot(key, snapshot, host.environmentId);
}

/** A tab in a project on another machine. The host owns the session; this
 * renders the normal session pane with actions routed to the host. */
export function RemoteSession({
  shell,
  visible,
  onSnapshot,
  onOpenFile,
  onOpenDiff,
  onOpenPlan,
  render,
}: {
  /** The tab's local session, which provides its ID and new-session defaults. */
  shell: Session;
  visible: boolean;
  onSnapshot?: (shellId: string, snapshot?: HostSession) => void;
  onOpenFile: SessionPaneProps["onOpenFile"];
  onOpenDiff: SessionPaneProps["onOpenDiff"];
  onOpenPlan: SessionPaneProps["onOpenPlan"];
  render: (overrides: RemoteSessionOverrides) => ReactNode;
}) {
  useLocale();
  const project = remoteProjectFor(shell.cwd);
  const { machines, loaded } = useRemoteMachines(!!project);
  const machine = project
    ? machines.find((entry) => entry.environmentId === project.environmentId)
    : undefined;
  if (!project || !machine)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-[13px] text-(--ui-text-muted)">
          {!project
            ? t(
                "This project’s machine details are missing. Add the project again from the project rail.",
              )
            : loaded
              ? t("The machine for this project isn’t connected on this computer.")
              : t("Connecting to the machine…")}
        </p>
        {project && loaded ? (
          <Button
            type="button"

            onClick={() => window.dispatchEvent(new Event(OPEN_CONNECTIONS_EVENT))}
            variant="secondary"
          >
            {t("Manage machines")}
          </Button>
        ) : null}
      </div>
    );
  return (
    <ConnectedRemoteSession
      key={`${machine.id}:${shell.id}`}
      shell={shell}
      visible={visible}
      onSnapshot={onSnapshot}
      onOpenFile={onOpenFile}
      onOpenDiff={onOpenDiff}
      onOpenPlan={onOpenPlan}
      machine={machine}
      project={project}
      render={render}
    />
  );
}

function ConnectedRemoteSession({
  shell,
  visible,
  onSnapshot,
  onOpenFile,
  onOpenDiff,
  onOpenPlan,
  machine,
  project,
  render,
}: {
  shell: Session;
  visible: boolean;
  onSnapshot?: (shellId: string, snapshot?: HostSession) => void;
  onOpenFile: SessionPaneProps["onOpenFile"];
  onOpenDiff: SessionPaneProps["onOpenDiff"];
  onOpenPlan: SessionPaneProps["onOpenPlan"];
  machine: RemoteMachine;
  project: RemoteProject;
  render: (overrides: RemoteSessionOverrides) => ReactNode;
}) {
  useLocale();
  const visibleRef = useRef(visible);
  const wake = useRef<() => void>(() => {});
  useEffect(() => {
    visibleRef.current = visible;
    wake.current();
  }, [visible]);
  const [descriptor, setDescriptor] = useState<HostDescriptor | undefined>(() =>
    cachedDescriptors.get(machine.id),
  );
  const [attachmentOwner] = useState(() => attachmentOwnerId("desktop-composer", shell.id));
  const ownsAttachments = !!descriptor?.capabilities.includes(ATTACHMENT_OWNERSHIP_CAPABILITY);
  const ownership = useMemo(
    () =>
      ownsAttachments
        ? attachmentOwnershipScope(
            machine.id,
            machine.environmentId,
            attachmentOwner,
            (method, params) => remoteRequest(machine.id, method, params),
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
        remoteRequest(machine.id, method, params),
      ).catch(console.warn);
  }, [ownership, online, machine.id, machine.environmentId]);
  const connection = useRemoteConnection(project.key);
  const [error, setError] = useState("");
  const [sessionId, setSessionId] = useState(() => remoteSessionFor(shell.id));
  const boundSession = useRef(sessionId);
  const bindingVersion = useRef(0);
  const deletedHostBinding = useRef<string | undefined>(undefined);
  const remoteBindingKey = JSON.stringify([machine.id, machine.environmentId, sessionId]);
  const currentRemoteBindingKey = useRef(remoteBindingKey);
  currentRemoteBindingKey.current = remoteBindingKey;
  const boundOwner = useRef(`${machine.id}:${machine.environmentId}`);
  const deletingSession = useRef<string | undefined>(undefined);
  useEffect(() => {
    const changed = () => {
      const next = remoteSessionFor(shell.id);
      const owner = `${machine.id}:${machine.environmentId}`;
      if (owner !== boundOwner.current) {
        boundOwner.current = owner;
        deletedHostBinding.current = undefined;
        setRemoteDeleted(false);
      }
      if (next !== boundSession.current) {
        bindingVersion.current++;
        deletedHostBinding.current = undefined;
        historyPageRequest.current = null;
        forceTailRead.current = true;
        setPageCacheOnly(false);
        setRemoteHistoryLoading(false);
        boundSession.current = next;
        setStarting(undefined);
        setUnseenSend(undefined);
        setChanges(undefined);
        applied.current = undefined;
        setError("");
        contentRefreshInFlight.current = false;
        const cached = next ? cachedSessionSnapshots.get(snapshotKey(machine.id, next)) : undefined;
        publishRemoteDataState(
          cached ? { phase: "stale" } : next ? { phase: "loading" } : { phase: "empty" },
        );
        setRemovingDraft(undefined);
        preparingRef.current = false;
        setSnapshot(next ? cachedSessionSnapshots.get(snapshotKey(machine.id, next)) : undefined);
      }
      setPending(pendingRemoteCommand(project.key, machine.environmentId, next ?? null, shell.id));
      setSessionId(next);
    };
    window.addEventListener(REMOTE_HISTORY_CHANGE, changed);
    changed();
    return () => window.removeEventListener(REMOTE_HISTORY_CHANGE, changed);
  }, [shell.id, machine.id, machine.environmentId]);
  const [snapshot, setSnapshot] = useState<HostSession | undefined>(() =>
    sessionId ? cachedSessionSnapshots.get(snapshotKey(machine.id, sessionId)) : undefined,
  );
  const [pageCacheOnly, setPageCacheOnly] = useState(false);
  const [remoteDeleted, setRemoteDeleted] = useState(false);
  const [remoteDataState, setRemoteDataState] = useState<RemoteDataState>(() =>
    !sessionId
      ? { phase: "empty" }
      : cachedSessionSnapshots.has(snapshotKey(machine.id, sessionId))
        ? { phase: "stale" }
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
      updatedAt: current.updatedAt,
    });
  };
  const refreshOwnerContent = () => {
    if (
      deletedHostBinding.current === currentRemoteBindingKey.current ||
      contentRefreshInFlight.current
    )
      return;
    beginOwnerVerification();
    setRefresh((value) => value + 1);
  };
  useEffect(() => {
    if (!sessionId) return;
    let current = true;
    void readRemotePageCache({ environmentId: machine.environmentId, sessionId }).then((cached) => {
      if (
        !current ||
        !cached ||
        snapshotRef.current ||
        deletedHostBinding.current === currentRemoteBindingKey.current
      )
        return;
      const saved = cached as HostSession;
      // The disk projection has a clipped block window; invalidate any poll
      // closure that may have captured an earlier in-memory baseline.
      forceTailRead.current = true;
      snapshotRef.current = saved;
      setSnapshot(saved);
      setPageCacheOnly(true);
      publishRemoteDataState({ phase: "stale" });
    });
    return () => {
      current = false;
    };
  }, [machine.environmentId, sessionId]);
  const [catalog, setCatalog] = useState<HostModelCatalog | undefined>(() =>
    cachedCatalogs.get(catalogKey(machine.id, project.projectId)),
  );
  const [catalogError, setCatalogError] = useState("");
  const [catalogRefresh, setCatalogRefresh] = useState(0);
  const [selectedCwd, setSelectedCwd] = useState(
    () => remotePendingWorktree(shell.id) ?? project.cwd,
  );
  const [draftWorkspaceMode, setDraftWorkspaceMode] = useState<WorkspaceMode>("current");
  const [draftWorktreeBase, setDraftWorktreeBase] = useState("HEAD");
  const [sending, setSending] = useState(false);
  const [rewinding, setRewinding] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ offset: number; size: number }>();
  const sendingRef = useRef(false);
  const sendingOwner = useRef<symbol | undefined>(undefined);
  const rewindOwner = useRef<symbol | undefined>(undefined);
  const preparingRef = useRef(false);
  const submissionGeneration = useRef(0);
  const preparingTurn = useRef<OptimisticTurn | undefined>(undefined);
  const [unseenSend, setUnseenSend] = useState<
    Pick<
      OptimisticTurn,
      "commandId" | "text" | "startedAt" | "turnModel" | "attachments" | "draftBlockId"
    > & {
      sessionId: string;
      runId?: string;
    }
  >();
  // A first message waits here while its session is created on the host.
  const [starting, setStarting] = useState<OptimisticTurn & { failed?: boolean }>();
  const [pending, setPending] = useState(() =>
    pendingRemoteCommand(project.key, machine.environmentId, sessionId ?? null, shell.id),
  );
  const [draft, setDraft] = useState<Configuration>(() => ({
    harness: isRemoteProvider(shell.harness) ? shell.harness : "codex",
    model: shell.model,
    settings: shell.modelSettings ?? {},
    mode: shell.runtimeMode,
  }));
  // Changes to a started session, applied when it is idle.
  const [changes, setChanges] = useState<Configuration>();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    setPending(
      pendingRemoteCommand(project.key, machine.environmentId, sessionId ?? null, shell.id),
    );
  }, [project.key, machine.environmentId, sessionId]);

  const hostSession = snapshot && snapshot.session.id === sessionId ? snapshot.session : undefined;
  useEffect(() => {
    if (hostSession) rememberRemotePendingWorktree(shell.id);
  }, [hostSession?.id, shell.id]);
  const executionCwd = hostSession?.cwd ?? selectedCwd;
  const { branches } = useProjectBranchesState(
    remotePath(machine.environmentId, executionCwd),
    online,
  );
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
  );
  useEffect(() => {
    if (!ownership || !online || !queue.loaded) return;
    let stopped = false;
    let chain = Promise.resolve();
    let draftIds = "";
    let queueIds = "";
    const reconcile = () => {
      chain = chain
        .catch(() => {})
        .then(async () => {
          if (stopped) return;
          const sources = await desktopAttachmentInventory(
            ownership,
            machine.id,
            machine.environmentId,
            shell.id,
            project.key,
            sharedQueueEnabled ? undefined : activeSessionId,
          );
          if (stopped) return;
          await ownership.reconcileDurable(sources);
          await retireClosedAttachmentOwners(
            machine.id,
            machine.environmentId,
            ownership,
            sources,
            (method, params) => remoteRequest(machine.id, method, params),
          );
        });
      void chain.catch(console.warn);
    };
    const releaseDraft = subscribePersistedComposerDrafts((id, files) => {
      const next = JSON.stringify(files.map((file) => file.id).sort());
      if (id === shell.id && draftIds !== next) {
        draftIds = next;
        reconcile();
      }
    });
    const releaseQueue = subscribePersistedRemoteQueues((key, value) => {
      const next = JSON.stringify(
        value.messages.flatMap((row) => row.attachments.map((file) => file.id)).sort(),
      );
      if (key === activeSessionId && queueIds !== next) {
        queueIds = next;
        reconcile();
      }
    });
    reconcile();
    return () => {
      stopped = true;
      releaseDraft();
      releaseQueue();
    };
  }, [
    ownership,
    online,
    queue.loaded,
    machine.id,
    machine.environmentId,
    shell.id,
    project.key,
    sharedQueueEnabled,
    activeSessionId,
  ]);
  const reservedFollowUp = useRef<RemoteQueueDraft | undefined>(undefined);
  const followUpGeneration = useRef(0);
  const remoteCanSteer =
    !snapshot?.desktop &&
    !!descriptor?.capabilities.includes("sessions.steer") &&
    !!hostSession &&
    ["codex", "claude", "cursor", "opencode", "pi", "omp", "hermes"].includes(hostSession.harness);
  // An accepted turn stays on screen until a sync shows the host's copy, so
  // the transcript never drops it for a moment in between.
  useEffect(() => {
    if (starting && !starting.failed && hasHostBlock(starting.commandId)) setStarting(undefined);
  }, [hostSession, starting]);
  // A draft being removed leaves the transcript at once, as it does locally,
  // and returns if the host turns the removal down.
  const [removingDraft, setRemovingDraft] = useState<string>();
  useEffect(() => {
    if (removingDraft && !hostSession?.blocks.some((block) => block.id === removingDraft))
      setRemovingDraft(undefined);
  }, [hostSession, removingDraft]);
  useEffect(() => {
    if (
      unseenSend &&
      hostSession?.id === unseenSend.sessionId &&
      hostSession.blocks.some((block) => block.id === unseenSend.commandId)
    )
      setUnseenSend((current) =>
        current?.commandId === unseenSend.commandId ? undefined : current,
      );
  }, [hostSession, unseenSend]);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let contentRetryTimer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribeChannel: (() => void) | undefined;
    const bindingKey = remoteBindingKey;
    let deletedOnHost = deletedHostBinding.current === bindingKey;
    let controlChannelFailed = false;
    let failed = 0;
    let polling = false;
    let ownerReadPending = false;
    let ownerResetGeneration = 0;
    const historyGeneration = createRemoteHistoryGeneration();
    const version = bindingVersion.current;
    const stale = () =>
      disposed ||
      deletedHostBinding.current === bindingKey ||
      version !== bindingVersion.current ||
      (!!sessionId && deletingSession.current === sessionId);
    // Every request carries the expected host identity; describe again only
    // after a failure, when the host may have been replaced.
    let described = false;
    const verifiedProjects = new Set([project.projectId]);
    const poll = async () => {
      if (disposed || deletedHostBinding.current === bindingKey) return;
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
            await remoteRequest<HostDescriptor>(machine.id, "environment.describe", {
              supportedProviders: REMOTE_PROVIDERS,
            }),
          );
          if (host.environmentId !== machine.environmentId)
            throw new Error("Host identity changed. Reconnect this machine before continuing.");
          if (stale()) return;
          boundedSet(cachedDescriptors, machine.id, host);
          setDescriptor(host);
          described = true;
          if (
            visibleRef.current &&
            !document.hidden &&
            host.capabilities.includes("machine.changes") &&
            sessionId &&
            !unsubscribeChannel
          ) {
            const lastActiveAt = Date.now();
            unsubscribeChannel = subscribeRemoteMachineChannel(
              machine.id,
              () => ({
                active: { projectId: project.projectId, sessionId, lastActiveAt },
                sessions: [{ sessionId, revision: snapshotRef.current?.revision ?? 0 }],
                inlineSync:
                  host.capabilities.includes("machine.changes.inlineSync") &&
                  !!snapshotRef.current &&
                  !snapshotRef.current.history &&
                  !snapshotRef.current.historyLoading,
              }),
              (changes) => {
                if (stale()) return;
                const recoveredControlChannel = controlChannelFailed;
                if (controlChannelFailed) {
                  controlChannelFailed = false;
                }
                const hint = changes.sessions.find((entry) => entry.sessionId === sessionId);
                if (hint?.deleted) {
                  deletedOnHost = true;
                  deletedHostBinding.current = bindingKey;
                  clearTimeout(timer);
                  if (contentRetryTimer) clearTimeout(contentRetryTimer);
                  unsubscribeChannel?.();
                  unsubscribeChannel = undefined;
                  historyPageRequest.current = null;
                  setRemoteHistoryLoading(false);
                  setRemoteDeleted(true);
                  const currentData = remoteDataStateRef.current;
                  publishRemoteDataState({
                    phase: currentData.updatedAt ? "stale" : "error",
                    updatedAt: currentData.updatedAt,
                    error: "This conversation was deleted on the host.",
                  });
                  setError("This conversation was deleted on the host.");
                  return;
                }
                if (changes.reset) {
                  ownerResetGeneration++;
                  forceTailRead.current = true;
                  historyPageRequest.current = null;
                  snapshotRef.current = undefined;
                  setRemoteHistoryLoading(false);
                }
                const current = snapshotRef.current;
                if (
                  !changes.reset &&
                  !recoveredControlChannel &&
                  failed === 0 &&
                  hint?.sync?.kind === "delta" &&
                  current &&
                  !polling &&
                  !forceTailRead.current
                ) {
                  if (hint.sync.value.revision <= current.revision) return;
                  if (
                    !current.history &&
                    !current.historyLoading &&
                    hint.sync.base === current.revision
                  ) {
                    try {
                      const next = applySessionSync(current, hint.sync);
                      if (
                        !verifiedProjects.has(next.projectId) ||
                        next.projectId !== current.projectId ||
                        next.session.id !== sessionId
                      )
                        throw new Error("Inline sync does not match this host session");
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
                      return;
                    } catch {
                      /* A history/window mismatch uses the normal sync path. */
                    }
                  }
                }
                const ownerReadNeeded =
                  recoveredControlChannel ||
                  changes.reset ||
                  // A content request can fail while the control lane stays
                  // healthy. An unchanged host has no revision hint to wake us.
                  failed > 0 ||
                  (hint !== undefined && hint.revision !== snapshotRef.current?.revision);
                if (ownerReadNeeded) {
                  const currentData = remoteDataStateRef.current;
                  if (failed === 0 && currentData.phase !== "refreshing")
                    publishRemoteDataState({
                      phase:
                        snapshotRef.current || currentData.updatedAt ? "refreshing" : "loading",
                      updatedAt: currentData.updatedAt,
                    });
                  if (failed === 0) void poll();
                  else if (!contentRetryTimer)
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
              },
              (reason) => {
                if (stale()) return;
                controlChannelFailed = true;
                setOnline(false);
                reportRemoteMachineStatus(machine.id, false, reason);
                const currentData = remoteDataStateRef.current;
                publishRemoteDataState({
                  phase: currentData.updatedAt ? "stale" : "error",
                  error: String(reason).replace(/^Error: /, ""),
                  updatedAt: currentData.updatedAt,
                });
              },
            );
          }
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
              isCurrent: () => !stale() && readGeneration === ownerResetGeneration,
              onHistoryError: (reason) => {
                if (stale() || readGeneration !== ownerResetGeneration) return;
                // A changed revision restarts tail loading without overwriting
                // the transcript that has already been displayed.
                snapshotRef.current = undefined;
                forceTailRead.current = true;
                historyGeneration.failed();
                setError(`History loading failed: ${String(reason)}. Retrying.`);
              },
              onPreviews: (preview) => {
                const current = snapshotRef.current;
                if (
                  stale() ||
                  readGeneration !== ownerResetGeneration ||
                  !canApplyRemotePreview(current, preview) ||
                  !current
                )
                  return;
                const blocks = mergePreviewBlocks(current.session.blocks, preview.session.blocks);
                if (blocks === current.session.blocks) return;
                const merged = { ...current, session: { ...current.session, blocks } };
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
        if (stale() || readGeneration !== ownerResetGeneration) return;
        if (next && !verifiedProjects.has(next.projectId)) {
          await verifyRemoteProjectAlias(
            (method, params) => remoteRequest(machine.id, method, params),
            { projectId: project.projectId, cwd: project.cwd },
            next.projectId,
          );
          if (stale() || readGeneration !== ownerResetGeneration) return;
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
        if (failed) setCatalogRefresh((value) => value + 1);
        failed = 0;
        if (next && sessionId)
          rememberSessionSnapshot(snapshotKey(machine.id, sessionId), next, machine.environmentId);
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
        if (stale() || readGeneration !== ownerResetGeneration) return;
        const currentData = remoteDataStateRef.current;
        publishRemoteDataState({
          phase: "error",
          error: String(reason).replace(/^Error: /, ""),
          updatedAt: currentData.updatedAt,
        });
        setOnline(false);
        reportRemoteMachineStatus(machine.id, false, reason);
        described = false;
        failed++;
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
      if (deletedHostBinding.current === bindingKey) return;
      clearTimeout(timer);
      if (!document.hidden) beginOwnerVerification();
      if (polling) {
        ownerReadPending = true;
        return;
      }
      // The active channel stays subscribed; pending reads use current visibility.
      if (!document.hidden) void poll();
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
      subscribeRemoteRecovered(() => {
        if (deletedHostBinding.current === currentRemoteBindingKey.current) return;
        beginOwnerVerification();
        setRefresh((value) => value + 1);
        setCatalogRefresh((value) => value + 1);
      }),
    [],
  );

  useEffect(() => {
    if (!descriptor || !visible) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      void remoteRequest<HostModelCatalog>(machine.id, "models.list", {
        projectId: project.projectId,
        progressive: true,
      })
        .then((value) => {
          if (disposed) return;
          boundedSet(cachedCatalogs, catalogKey(machine.id, project.projectId), value);
          setCatalog(value);
          setCatalogError("");
          if (value.pending?.length) timer = setTimeout(load, 1000);
        })
        .catch((reason) => {
          if (!disposed) setCatalogError(String(reason));
        });
    load();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [machine.id, descriptor?.environmentId, project.projectId, catalogRefresh, visible]);

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
    const models = (catalog.models[harness] ?? []).filter((model) => isModelEnabled(model.id));
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
        : { ...current, harness, model: model.id, settings };
    });
  }, [online, catalog, providers, sessionId, draft.harness, draft.model]);

  const saved: Configuration | undefined = hostSession && {
    harness: hostSession.harness as RemoteProvider,
    model: hostSession.model,
    settings: hostSession.modelSettings ?? {},
    mode: hostSession.runtimeMode,
  };
  const configuration = saved ? (changes ?? saved) : draft;
  const updateConfiguration = (update: (current: Configuration) => Configuration) => {
    if (saved) setChanges(update(changes ?? saved));
    else setDraft(update);
  };

  const selectedTurnModel = (): NonNullable<Block["turnModel"]> => ({
    harness: configuration.harness,
    id: configuration.model,
    name:
      findRemoteModel(catalog?.models[configuration.harness] ?? [], configuration.model)?.name ??
      configuration.model.replace(/^[^:]+:/, ""),
  });
  const optimisticTurn = (
    text: string,
    attachments: Attachment[] = [],
    intent: "default" | "plan" | "build" = "default",
    draft = false,
    draftBlockId?: string,
    planBlockId?: string,
  ): OptimisticTurn => ({
    commandId: crypto.randomUUID(),
    text,
    attachments,
    intent,
    draft,
    draftBlockId,
    planBlockId,
    startedAt: Date.now(),
    turnModel: selectedTurnModel(),
  });

  const run = async (
    command: HostCommand,
    optimistic?: OptimisticTurn,
    followup?: HostCommand,
    recoveredReceipt?: CommandReceipt,
    generation?: number,
  ): Promise<CommandReceipt | undefined> => {
    if (optimistic?.queued && ["send", "compact"].includes(command.type))
      command = { ...command, queued: optimistic.queued };
    if (sendingRef.current || pageCacheOnly || remoteDeleted) return undefined;
    if (
      !recoveredReceipt &&
      generation !== undefined &&
      generation !== submissionGeneration.current
    )
      return undefined;
    const version = bindingVersion.current;
    const owner = Symbol();
    sendingOwner.current = owner;
    sendingRef.current = true;
    setSending(true);
    setError("");
    if (command.type === "send" || command.type === "compact")
      setUnseenSend((current) =>
        current?.commandId === command.commandId
          ? current
          : {
              sessionId: command.sessionId,
              commandId: command.commandId,
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
      if (!recoveredReceipt)
        savePendingRemoteCommand(project.key, machine.environmentId, command, shell.id, followup);
      setPending(command);
      const traceId = sessionPerformanceTrace(shell.id);
      let receipt = recoveredReceipt;
      if (!receipt) {
        const dispatchDone = startPerformanceSpan("dispatch", {}, traceId);
        try {
          receipt = await sessionAccessForMachine(machine.id, false, true).dispatch(command);
        } finally {
          dispatchDone();
        }
      }
      if (!receipt) throw new Error("The host did not confirm the request.");
      recordPerformanceEvent("host-ack", { revision: receipt.revision }, traceId);
      const stopped =
        (generation !== undefined && generation !== submissionGeneration.current) ||
        remoteCommandWasStopped(project.key, machine.environmentId, command.commandId);
      if (stopped) {
        markRemoteCommandStopped(project.key, machine.environmentId, command.commandId);
        if (receipt.runId) {
          // A newer turn may already exist. Cancel only the run this command
          // accepted, never whichever run happens to be in the latest snapshot.
          await sessionAccessForMachine(machine.id, false, true).dispatch({
            type: "cancel",
            commandId: crypto.randomUUID(),
            sessionId: receipt.sessionId,
            runId: receipt.runId,
          });
        } else if (
          command.type === "send" ||
          command.type === "compact" ||
          (command.type === "create" && command.firstTurn?.type === "send")
        ) {
          throw new Error(
            "The host confirmed the stopped request without its run ID. It was kept for recovery; check the host before retrying.",
          );
        }
        clearPendingRemoteCommand(project.key, machine.environmentId, command.commandId);
        const handedOff =
          command.type === "create" ? command.firstTurn?.commandId : command.commandId;
        if (handedOff && ownership) {
          ownership.finishJob(`submit:${handedOff}`);
          void ownership.replaceDurable(`submit:${handedOff}`, []).catch(console.warn);
        }
        if (alive.current && version === bindingVersion.current) {
          if (command.type === "create" && !preparingTurn.current) openSession(receipt.sessionId);
          setStarting((current) =>
            current?.commandId === optimistic?.commandId ? undefined : current,
          );
          setUnseenSend((current) =>
            current?.commandId === command.commandId ? undefined : current,
          );
          setPending(
            pendingRemoteCommand(
              project.key,
              machine.environmentId,
              boundSession.current ?? null,
              shell.id,
            ),
          );
          setRefresh((value) => value + 1);
        }
        return receipt;
      }
      if (command.type === "create") {
        const next = pendingRemoteFollowup(project.key, machine.environmentId, command.commandId);
        if (next && next.type !== "create")
          savePendingRemoteCommand(
            project.key,
            machine.environmentId,
            { ...next, sessionId: receipt.sessionId },
            shell.id,
          );
        if (version === bindingVersion.current) openSession(receipt.sessionId);
      }
      clearPendingRemoteCommand(project.key, machine.environmentId, command.commandId);
      const handedOff =
        command.type === "create" ? command.firstTurn?.commandId : command.commandId;
      if (handedOff && ownership) {
        ownership.finishJob(`submit:${handedOff}`);
        void ownership.replaceDurable(`submit:${handedOff}`, []).catch(console.warn);
      }
      if (!alive.current || version !== bindingVersion.current) return receipt;
      if (receipt.runId) {
        setUnseenSend((current) =>
          current?.commandId === command.commandId ? { ...current, runId: receipt.runId } : current,
        );
        if (command.type === "create")
          setStarting((current) =>
            current && optimistic && current.commandId === optimistic.commandId
              ? { ...current, acceptedRun: { sessionId: receipt.sessionId, runId: receipt.runId! } }
              : current,
          );
      }
      if (command.type === "draft") {
        // Accepted drafts are actionable before the next snapshot arrives.
        setSnapshot((current) => ({
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
        }));
        setStarting(undefined);
      }
      setPending(
        pendingRemoteCommand(
          project.key,
          machine.environmentId,
          command.type === "create" ? receipt.sessionId : (sessionId ?? null),
          shell.id,
        ),
      );
      setRefresh((value) => value + 1);
      return receipt;
    } catch (reason) {
      reportRemoteConnection(project.key, "session", reason);
      if (!alive.current || version !== bindingVersion.current) return undefined;
      const message = String(reason);
      if (message.includes("Host rejected request:")) {
        if (command.type === "send" || command.type === "compact")
          setUnseenSend((current) =>
            current?.commandId === command.commandId ? undefined : current,
          );
        clearPendingRemoteCommand(project.key, machine.environmentId, command.commandId);
        setPending(
          pendingRemoteCommand(project.key, machine.environmentId, sessionId ?? null, shell.id),
        );
      }
      setError(message.replace(/^Error: /, ""));
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
    const version = bindingVersion.current;
    deletingSession.current = id;
    try {
      await sessionAccessForMachine(machine.id, false, true).delete(id, project.projectId);
      cachedSessionSnapshots.delete(snapshotKey(machine.id, id));
      forgetRemoteQueue(id);
      if (!alive.current || version !== bindingVersion.current) return;
      setSnapshot(undefined);
      rememberRemoteSession(shell.id);
      onSnapshot?.(shell.id, undefined);
    } catch (reason) {
      if (!alive.current || version !== bindingVersion.current) return;
      deletingSession.current = undefined;
      setRefresh((value) => value + 1);
      setRemovingDraft(undefined);
      setError(String(reason).replace(/^Error: /, ""));
    }
  };

  const openSession = (id: string) => {
    boundSession.current = id;
    rememberRemoteSession(shell.id, id);
    setSessionId(id);
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
      sameModelSettings(a.settings, b.settings);
    if (same(changes, saved)) {
      applied.current = undefined;
      setChanges(undefined);
      return;
    }
    if (applied.current && same(changes, applied.current)) return;
    if (busy || !online || pending || applying.current) return;
    applying.current = true;
    const sent = changes;
    void run({
      type: "configure",
      commandId: crypto.randomUUID(),
      sessionId: hostSession.id,
      ...(descriptor?.capabilities.includes("sessions.harnessSwitch")
        ? { harness: changes.harness }
        : {}),
      model: changes.model,
      modelSettings: changes.settings,
      runtimeMode: changes.mode,
    })
      .then((receipt) => {
        if (receipt) applied.current = sent;
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
    const version = bindingVersion.current;
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
              version === bindingVersion.current &&
              generation === submissionGeneration.current
            )
              setUploadProgress({ offset, size });
          },
        })));
    if (
      !alive.current ||
      version !== bindingVersion.current ||
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
          ),
      turn,
      undefined,
      undefined,
      generation,
    );
  };

  const startSession = async (turn: OptimisticTurn, generation = submissionGeneration.current) => {
    const version = bindingVersion.current;
    try {
      const uploaded = await uploadRemoteAttachments(machine.id, turn.attachments, {
        environmentId: machine.environmentId,
        ownership,
        ownershipSource: `submit:${turn.commandId}`,
        resumable: descriptor?.capabilities.includes("attachments.resume"),
        onProgress: (_id, offset, size) => {
          if (
            alive.current &&
            version === bindingVersion.current &&
            generation === submissionGeneration.current
          )
            setUploadProgress({ offset, size });
        },
      });
      if (
        !alive.current ||
        version !== bindingVersion.current ||
        generation !== submissionGeneration.current
      )
        return;
      setUploadProgress(undefined);
      let worktreeCwd = selectedCwd;
      let autoWorktreeBranch: string | undefined;
      if (draftWorkspaceMode === "worktree") {
        try {
          const tree = await remoteRequest<HostWorktree>(machine.id, "git.worktreeCreate", {
            projectId: project.projectId,
            cwd: selectedCwd,
            branch: temporaryWorktreeBranchName(),
            base: draftWorktreeBase,
            existing: false,
          });
          if (version !== bindingVersion.current || generation !== submissionGeneration.current)
            return;
          worktreeCwd = tree.path;
          autoWorktreeBranch = tree.branch ?? undefined;
          rememberRemotePendingWorktree(shell.id, tree.path);
          if (alive.current) {
            setSelectedCwd(tree.path);
            setDraftWorkspaceMode("current");
          }
        } catch (reason) {
          if (
            alive.current &&
            version === bindingVersion.current &&
            generation === submissionGeneration.current
          ) {
            setError(String(reason));
            setStarting({ ...turn, failed: true });
          }
          return;
        }
      }
      const followup: Exclude<HostCommand, { type: "create" }> = turn.draft
        ? {
            type: "draft",
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
          );
      const atomic = descriptor?.capabilities.includes("sessions.createFirstTurn") ?? false;
      const receipt = await run(
        {
          type: "create",
          commandId: crypto.randomUUID(),
          projectId: project.projectId,
          ...(worktreeCwd !== project.cwd ? { worktreeCwd } : {}),
          ...(autoWorktreeBranch ? { autoWorktreeBranch } : {}),
          harness: draft.harness,
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
      if (version !== bindingVersion.current || generation !== submissionGeneration.current) return;
      if (!receipt) {
        if (alive.current) setStarting({ ...turn, failed: true });
        return;
      }
      if (version !== bindingVersion.current) return;
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
        version === bindingVersion.current &&
        generation === submissionGeneration.current
      )
        if (!sent) setStarting({ ...turn, failed: true });
    } catch (reason) {
      if (
        alive.current &&
        version === bindingVersion.current &&
        generation === submissionGeneration.current
      ) {
        setError(String(reason));
        setStarting({ ...turn, failed: true });
      }
    } finally {
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
  ): Extract<HostCommand, { type: "send" | "compact" }> =>
    text.trim().toLowerCase() === "/compact" &&
    !attachments.length &&
    !draftBlockId &&
    intent === "default"
      ? {
          type: "compact",
          commandId,
          sessionId: id,
          resumeAtReset: loadResumeAtReset(),
        }
      : {
          type: "send",
          commandId,
          sessionId: id,
          resumeAtReset: loadResumeAtReset(),
          text,
          attachments,
          intent,
          ...(draftBlockId ? { draftBlockId } : {}),
          ...(planBlockId ? { planBlockId } : {}),
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
    const version = bindingVersion.current;
    void dispatchTurn(hostSession.id, turn, undefined, generation)
      .then((receipt) => {
        onAcceptance?.(!!receipt);
        if (
          alive.current &&
          version === bindingVersion.current &&
          generation === submissionGeneration.current
        )
          if (!receipt) setStarting({ ...turn, failed: true });
      })
      .catch((reason) => {
        onAcceptance?.(false);
        if (
          alive.current &&
          version === bindingVersion.current &&
          generation === submissionGeneration.current
        ) {
          setError(String(reason));
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
  /** Resolves once the poll has reached the machine, or false after a while. */
  const whenOnline = () =>
    onlineRef.current
      ? Promise.resolve(true)
      : new Promise<boolean>((resolve) => {
          const wake = () => {
            clearTimeout(timer);
            resolve(true);
          };
          const timer = setTimeout(() => {
            onlineWaiters.current.delete(wake);
            resolve(false);
          }, 10_000);
          onlineWaiters.current.add(wake);
        });
  // Send while the machine is out of reach: reconnect first, then send. The
  // composer has let go of the message, so when that fails it goes back there
  // (or stays here as a failed message with Try again); it is never dropped.
  const sendWhenConnected = async (
    turn: OptimisticTurn,
    options?: ComposerTurnOptions,
    generation = submissionGeneration.current,
  ) => {
    const version = bindingVersion.current;
    const outcome = await sendAfterReconnect({
      status: connection.status,
      reconnect: () => connection.reconnect(),
      ready: whenOnline,
      send: () =>
        alive.current &&
        version === bindingVersion.current &&
        generation === submissionGeneration.current &&
        launchRef.current(turn, generation),
    });
    if (
      outcome.sent ||
      !alive.current ||
      version !== bindingVersion.current ||
      generation !== submissionGeneration.current
    )
      return;
    preparingRef.current = false;
    preparingTurn.current = undefined;
    // The connection banner already says why a reconnect failed.
    if (outcome.failure === "offline") setError(outcome.error ?? "");
    if (options?.onSendRejected?.())
      setStarting((current) => (current?.commandId === turn.commandId ? undefined : current));
    else setStarting({ ...turn, failed: true });
  };

  // `!commands` this window sent; the agent carries on once each one finishes.
  const shellFollowUps = useRef(new Set<string>());
  const dispatchShell = (id: string, command: string) => {
    const commandId = crypto.randomUUID();
    return sessionAccessForMachine(machine.id, false, true)
      .dispatch({
        type: "shell",
        commandId,
        sessionId: id,
        line: command,
      })
      .then(() => {
        shellFollowUps.current.add(commandId);
        if (alive.current) setRefresh((value) => value + 1);
      });
  };
  useEffect(() => {
    for (const id of [...shellFollowUps.current]) {
      const block = hostSession?.blocks.find((entry) => entry.id === id);
      if (!block?.shell || block.shell.running) continue;
      shellFollowUps.current.delete(id);
      submit(SHELL_FOLLOW_UP_PROMPT);
    }
  }, [hostSession]);

  /** Runs a `!command` on the host. It is not a turn: nothing is queued or
   * retried, and a refused one stays in the composer. */
  const runShell = (command: string): boolean => {
    if (!descriptor) {
      setError("This project’s machine isn’t connected yet.");
      return false;
    }
    if (!descriptor.capabilities.includes(SESSION_SHELL)) {
      setError(HOST_UPDATE_NOTICE);
      return false;
    }
    if (sendingRef.current || preparingRef.current) return false;
    const version = bindingVersion.current;
    const failed = (reason: unknown) => {
      reportRemoteConnection(project.key, "session", reason);
      if (alive.current && version === bindingVersion.current)
        setError(String(reason).replace(/^Error: /, ""));
    };
    setError("");
    if (hostSession) {
      void dispatchShell(hostSession.id, command).catch(failed);
      return true;
    }
    // A new conversation: the command needs a session to run in.
    if (sessionId || !draft.model) return false;
    if (draftWorkspaceMode === "worktree") {
      setError("Send a message first to create the worktree, then run commands in it.");
      return false;
    }
    preparingRef.current = true;
    void run({
      type: "create",
      commandId: crypto.randomUUID(),
      projectId: project.projectId,
      ...(selectedCwd !== project.cwd ? { worktreeCwd: selectedCwd } : {}),
      harness: draft.harness,
      model: draft.model,
      modelSettings: draft.settings,
      runtimeMode: draft.mode,
    })
      .then((receipt) => (receipt ? dispatchShell(receipt.sessionId, command) : undefined))
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
    if (rewindOwner.current) return false;
    if (pageCacheOnly || remoteDeleted || snapshotRef.current?.historyLoading || queue.error)
      return false;
    const hostDraft = options?.draftBlockId
      ? hostSession?.blocks.find((block) => block.id === options.draftBlockId)
      : undefined;
    // A host-accepted follow-up is already owned by its delivery chain. Until
    // it settles, sending its draft action must not queue a second copy.
    if (
      hostDraft?.followUpDelivery &&
      (hostDraft.followUpDelivery === "pending" || busy || pending || !online)
    )
      return false;
    beginSessionPerformanceTrace(shell.id);
    const shellCommand =
      asDraft || queuedId || attachments.length || options?.draftBlockId || planBlockId
        ? undefined
        : parseShellCommand(text);
    if (shellCommand) return runShell(shellCommand);
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
      const version = bindingVersion.current;
      const targetSessionId = hostSession.id;
      const runId = snapshot.runId;
      const unsent = {
        id: queuedId ?? crypto.randomUUID(),
        text,
        attachments,
        intent: options?.intent,
        modelTarget: {
          harness: hostSession.harness,
          model: hostSession.model,
          modelSettings: { ...hostSession.modelSettings },
        },
      };
      if (
        !queue.current().messages.some((message) => message.id === unsent.id) &&
        !canEnqueueRemoteMessage(queue.current(), unsent)
      ) {
        setError("Remote queue is full. Send or remove queued messages before adding more.");
        return false;
      }
      // Reserve recovery space while upload/steering is in flight. New queued
      // submissions cannot consume the slot needed if this follow-up is refused.
      reservedFollowUp.current = unsent;
      const holdFollowUp = () => {
        queue.enqueue(unsent);
        queue.pause();
      };
      preparingRef.current = true;
      void (async () => {
        const commandId = crypto.randomUUID();
        let accepted = false;
        try {
          const files = await uploadRemoteAttachments(machine.id, attachments, {
            ownership,
            ownershipSource: `submit:${commandId}`,
            environmentId: machine.environmentId,
            resumable: descriptor?.capabilities.includes("attachments.resume"),
          });
          if (
            !alive.current ||
            version !== bindingVersion.current ||
            generation !== followUpGeneration.current
          ) {
            if (alive.current && version === bindingVersion.current) holdFollowUp();
            return;
          }
          const receipt = await run({
            type: "steer",
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
            version === bindingVersion.current &&
            pendingRemoteCommand(project.key, machine.environmentId, targetSessionId, shell.id)
              ?.commandId !== commandId
          )
            holdFollowUp();
        } catch (reason) {
          if (alive.current && version === bindingVersion.current) {
            holdFollowUp();
            setError(`Could not deliver the follow-up: ${String(reason)}`);
          }
        } finally {
          onAcceptance?.(accepted);
          ownership?.finishJob(`submit:${commandId}`);
          if (reservedFollowUp.current === unsent) reservedFollowUp.current = undefined;
          if (submission === submissionGeneration.current) preparingRef.current = false;
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
        id: crypto.randomUUID(),
        text,
        attachments,
        intent: options?.intent,
        modelTarget: {
          harness: configuration.harness,
          model: configuration.model,
          modelSettings: { ...configuration.settings },
        },
      };
      const currentQueue = queue.current();
      const reserved = reservedFollowUp.current;
      const capacityQueue =
        reserved && !currentQueue.messages.some((message) => message.id === reserved.id)
          ? { ...currentQueue, messages: [...currentQueue.messages, reserved] }
          : currentQueue;
      if (!canEnqueueRemoteMessage(capacityQueue, queued)) {
        setError("Remote queue is full. Send or remove queued messages before adding more.");
        return false;
      }
      return queue.enqueue(queued) !== false;
    }
    if (sending || preparingRef.current || pending || busy || (!text.trim() && !attachments.length))
      return false;
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

  const working = sending || !!pending;
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
  const [drainRetry, setDrainRetry] = useState(0);
  const submitRef = useRef(submit);
  submitRef.current = submit;
  // Send the head of the queue once the turn is over and the machine is
  // reachable. A held queue loses nothing: it simply waits for both.
  useEffect(() => {
    if (!nextQueued || pageCacheOnly || remoteDeleted) return;
    const target = nextQueued.modelTarget;
    if (
      target &&
      saved &&
      !sameQueuedModelTarget(target, {
        harness: saved.harness,
        model: saved.model,
        modelSettings: saved.settings,
      })
    ) {
      if (
        !providers.includes(target.harness as RemoteProvider) ||
        (target.harness !== saved.harness &&
          !descriptor?.capabilities.includes("sessions.harnessSwitch"))
      ) {
        setError("The queued message's provider is unavailable on this machine.");
        return;
      }
      setChanges({
        harness: target.harness as RemoteProvider,
        model: target.model,
        settings: { ...target.modelSettings },
        mode: saved.mode,
      });
      return;
    }
    const timer = setTimeout(() => {
      const currentQueue = queue.current();
      if (
        currentQueue.status === "paused" ||
        currentQueue.status === "restored" ||
        currentQueue.status === "resuming" ||
        currentQueue.messages[0] !== nextQueued
      )
        return;
      const accepted = submitRef.current(
        nextQueued.text,
        nextQueued.attachments,
        {
          intent: nextQueued.intent,
        },
        false,
        undefined,
        nextQueued.id,
      );
      if (accepted) queue.sent(nextQueued.id);
      else setDrainRetry((value) => value + 1);
    }, 0);
    return () => clearTimeout(timer);
  }, [
    nextQueued,
    drainRetry,
    saved?.harness,
    saved?.model,
    saved?.settings,
    providers,
    descriptor?.capabilities,
    pageCacheOnly,
  ]);

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

  const modelSource = useMemo<ModelSource>(() => {
    const models = (harness: HarnessId) => catalog?.models[harness as RemoteProvider] ?? [];
    const savedModel = hostSession?.model;
    const savedSettings = hostSession?.modelSettings ?? {};
    return {
      id: `remote:${machine.environmentId}`,
      modelsFor: models,
      resolve: (harness, id = "") => {
        const provider = harness as RemoteProvider;
        // Keep the saved model's effort visible even when the host catalog is
        // loading, failed, or no longer lists it.
        const controls = remoteModelControls(
          catalog,
          provider,
          id,
          id === savedModel ? savedSettings : {},
          savedModel,
        );
        const listed = controls.model;
        return {
          ...(listed ?? {
            id,
            harness,
            name: id ? id.replace(/^[a-z]+:/, "") : "Loading models…",
            nativeId: id.replace(/^[a-z]+:/, ""),
          }),
          settings: controls.settings,
        } satisfies AgentModel;
      },
      find: (id) => providers.flatMap((harness) => models(harness)).find((m) => m.id === id),
      available: (harness) =>
        providers.includes(harness as RemoteProvider) &&
        (!hostSession ||
          descriptor?.capabilities.includes("sessions.harnessSwitch") === true ||
          hostSession.harness === harness),
      probed: () => !!descriptor,
      // The host re-probes when a provider CLI changes or its catalog ages,
      // so each picker opening asks again.
      refresh: () => setCatalogRefresh((value) => value + 1),
    };
  }, [
    catalog,
    catalogError,
    descriptor,
    providers,
    machine.environmentId,
    hostSession?.harness,
    hostSession?.model,
    hostSession?.modelSettings,
  ]);

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
    cwd: remotePath(machine.environmentId, project.cwd),
    worktreeCwd:
      executionCwd === project.cwd ? undefined : remotePath(machine.environmentId, executionCwd),
    workspaceMode: hostSession ? undefined : draftWorkspaceMode,
    worktreeBase: hostSession ? undefined : draftWorktreeBase,
    branch: branches?.current ?? hostSession?.branch,
    harness: configuration.harness,
    model: configuration.model,
    modelSettings: configuration.settings,
    runtimeMode: configuration.mode,
    busy,
    blocks: unconfirmed ? [...blocks, unconfirmed] : blocks,
    historyPartial: snapshot?.history?.before !== undefined,
    historyLoading: !!snapshot?.historyLoading || remoteHistoryLoading,
    ...queueSessionFields(queue.queue),
  };

  const catalogProblem = catalog?.errors[configuration.harness] ?? catalogError;
  const retryPending = async () => {
    if (!pending || sendingRef.current) return;
    const risky =
      pending.type === "shell" ||
      pending.type === "cancel" ||
      pending.type === "approve" ||
      pending.type === "answer";
    const needsVerification = remoteCommandNeedsVerification(
      project.key,
      machine.environmentId,
      pending.commandId,
    );
    const stopped = remoteCommandWasStopped(project.key, machine.environmentId, pending.commandId);
    let recovered: CommandReceipt | null | undefined;
    if (descriptor?.capabilities.includes("commands.status")) {
      try {
        recovered = await sessionAccessForMachine(machine.id, false, true).status(
          pending.commandId,
        );
      } catch (reason) {
        setError(
          `Couldn’t check whether the host accepted this request: ${String(reason).replace(/^Error: /, "")}`,
        );
        return;
      }
    }
    if (
      (recovered === null || recovered === undefined) &&
      (risky || needsVerification || stopped)
    ) {
      setError(
        "The host cannot confirm whether this request ran. Check the host before clearing it; it was kept for recovery.",
      );
      return;
    }
    const version = bindingVersion.current;
    if (!stopped) setStarting((current) => (current ? { ...current, failed: false } : current));
    const receipt = recovered
      ? await run(pending, undefined, undefined, recovered)
      : await run(pending);
    if (receipt && pending.type === "create" && !stopped && version === bindingVersion.current) {
      const next = pendingRemoteCommand(
        project.key,
        machine.environmentId,
        receipt.sessionId,
        shell.id,
      );
      if (next) await run(next);
    }
  };
  const notice = queue.error
    ? {
        text: t(
          "Could not load queued messages. Sending is held until the saved queue can be read.",
        ),
        detail: queue.error,
        action: {
          get label() {
            return t("Retry");
          },
          run: queue.retry,
        },
      }
    : pending && !sending
      ? {
          text: "Waiting for the host to confirm your request.",
          detail: error,
          action: {
            get label() {
              return t("Retry");
            },
            run: () => void retryPending(),
          },
        }
      : starting?.failed
        ? {
            text: `Couldn’t ${starting.draft ? "save the draft" : "send the message"} on ${machine.name}.`,
            detail: error,
            action: {
              get label() {
                return t("Try again");
              },
              run: () => {
                const turn = { ...starting, failed: false };
                const version = bindingVersion.current;
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
                        version === bindingVersion.current &&
                        generation === submissionGeneration.current
                      )
                        if (!sent) setStarting({ ...turn, failed: true });
                    })
                    .catch((reason) => {
                      if (
                        alive.current &&
                        version === bindingVersion.current &&
                        generation === submissionGeneration.current
                      ) {
                        setError(String(reason));
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
        : error
          ? {
              text: error,
              action: {
                get label() {
                  return t("Dismiss");
                },
                run: () => setError(""),
              },
            }
          : catalogProblem
            ? {
                text: `Couldn’t load models from ${machine.name}.`,
                detail: catalogProblem,
                action: {
                  get label() {
                    return t("Retry");
                  },
                  run: () => setCatalogRefresh((value) => value + 1),
                },
              }
            : undefined;

  const selectWorktree = async (tree: Worktree) => {
    const parsed = parseRemotePath(tree.path);
    if (!parsed || parsed.environmentId !== machine.environmentId)
      throw new Error("Choose a worktree on this machine");
    if (sessionId)
      throw new Error("This session’s worktree is fixed. Start a new session to use another.");
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
      setError("Select that model in the composer before building this remote plan.");
      return;
    }
    submit(`Build the approved plan:\n\n${block.text}`, [], { intent: "build" }, false, blockId);
  };

  const stopTurn = () => {
    followUpGeneration.current += 1;
    submissionGeneration.current += 1;
    const stoppedTurn = preparingTurn.current;
    preparingTurn.current = undefined;
    preparingRef.current = false;
    setUploadProgress(undefined);
    if (stoppedTurn)
      setStarting((current) =>
        current?.commandId === stoppedTurn.commandId ? { ...current, failed: true } : current,
      );
    const inFlight = pendingRemoteCommand(
      project.key,
      machine.environmentId,
      boundSession.current ?? null,
      shell.id,
    );
    if (inFlight?.type === "send" || inFlight?.type === "compact" || inFlight?.type === "create")
      markRemoteCommandStopped(project.key, machine.environmentId, inFlight.commandId);
    queue.pause();
    const target =
      unseenActive && unseenSend?.runId
        ? { sessionId: unseenSend.sessionId, runId: unseenSend.runId }
        : startingActive && starting?.acceptedRun
          ? starting.acceptedRun
          : snapshot?.status === "running" && hostSession && snapshot.runId
            ? { sessionId: hostSession.id, runId: snapshot.runId }
            : undefined;
    if (!pageCacheOnly && target) {
      // What is queued waits for the user instead of sending as the turn ends.
      // Stop must reach the host even while a follow-up is being acknowledged.
      void sessionAccessForMachine(machine.id, false, true)
        .dispatch({
          type: "cancel",
          commandId: crypto.randomUUID(),
          ...target,
        })
        .catch((reason) => setError(`Could not stop the turn: ${String(reason)}`));
    }
  };
  const approve = (requestId: number, decision: Parameters<SessionPaneProps["onApproval"]>[2]) => {
    if (!hostSession || !snapshot?.runId) return;
    void run({
      type: "approve",
      commandId: crypto.randomUUID(),
      sessionId: hostSession.id,
      runId: snapshot.runId,
      requestId,
      decision,
    });
  };
  // The host owns the limit; a local edit would be undone by its next snapshot.
  const usageLimit = (action: "arm" | "disarm" | "dismiss") => {
    if (!hostSession?.usageLimit) return;
    void run({
      type: "usageLimit",
      commandId: crypto.randomUUID(),
      sessionId: hostSession.id,
      action,
    });
  };
  const answer = (requestId: number, reply: Parameters<SessionPaneProps["onQuestionReply"]>[2]) => {
    if (!hostSession || !snapshot?.runId) return;
    void run({
      type: "answer",
      commandId: crypto.randomUUID(),
      sessionId: hostSession.id,
      runId: snapshot.runId,
      requestId,
      reply,
    });
  };
  const compact = () => {
    if (!hostSession || busy || pending || changes || !online) return false;
    void run(message(hostSession.id, "/compact"));
    return true;
  };
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
    const targetBindingVersion = bindingVersion.current;
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
      const receipt = await sessionAccessForMachine(machine.id, false, true).dispatch({
        type: "rewind",
        commandId: crypto.randomUUID(),
        sessionId: targetSessionId,
        blockId,
        expectedRevision: known.revision,
      });
      if (receipt.sessionId !== targetSessionId || receipt.revision <= known.revision) return false;
      const stillCurrent = () =>
        alive.current &&
        boundSession.current === targetSessionId &&
        bindingVersion.current === targetBindingVersion &&
        currentRemoteBindingKey.current === targetBinding &&
        rewindOwner.current === owner;
      const pages =
        !!descriptor.capabilities.includes("sessions.pages") ||
        !!descriptor.capabilities.includes("sessions.lazyHistory");
      const partialHistory = !!descriptor.capabilities.includes("sessions.lazyHistory");
      let updated: HostSession | undefined;
      for (let attempt = 0; attempt < 3 && stillCurrent(); attempt += 1) {
        const candidate = await loadRemoteSession(machine.id, targetSessionId, known, {
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
        bindingVersion.current === targetBindingVersion &&
        boundSession.current === targetSessionId
      ) {
        reportRemoteConnection(project.key, "session", reason);
        setError(String(reason).replace(/^Error: /, ""));
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
  useEffect(
    () =>
      registerRemoteSessionActions(shell.id, {
        buildPlan,
        submit: (text, attachments, options) => submit(text, attachments, options),
        saveDraft,
        stop: stopTurn,
        rewind,
        compact,
        approve,
        answer,
      }),
    [shell.id, buildPlan, saveDraft, stopTurn, rewind, compact, approve, answer],
  );

  const hostFilePath = (path: string) => {
    const existing = parseRemotePath(path);
    if (existing) return path;
    const absolute =
      path.startsWith("/") || path.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(path)
        ? path
        : `${executionCwd.replace(/[\\/]+$/, "")}/${path.replace(/^\.\//, "")}`;
    return remotePath(machine.environmentId, absolute);
  };

  const outboxIssues = useRemoteOutboxIssues(project.key, machine.environmentId);
  const loadEarlierRemote = async (): Promise<number> => {
    const current = snapshotRef.current;
    if (!sessionId || !current?.history || historyPageRequest.current) return 0;
    const binding = bindingVersion.current;
    const request = { revision: current.revision, before: current.history.before, binding };
    historyPageRequest.current = request;
    const stillCurrent = () =>
      alive.current &&
      deletedHostBinding.current !== remoteBindingKey &&
      historyPageRequest.current === request &&
      bindingVersion.current === binding &&
      boundSession.current === sessionId &&
      snapshotRef.current?.revision === current.revision &&
      snapshotRef.current?.history?.before === current.history?.before;
    setRemoteHistoryLoading(true);
    setRemoteHistoryError("");
    try {
      const next = await loadRemoteHistoryPage(machine.id, sessionId, current, stillCurrent);
      if (!stillCurrent()) return 0;
      if (!next) {
        setRemoteHistoryError(
          "The conversation changed while loading. Try again to continue from its current version.",
        );
        setRefresh((value) => value + 1);
        return 0;
      }
      const added = Math.max(0, next.session.blocks.length - current.session.blocks.length);
      snapshotRef.current = next;
      setSnapshot(next);
      onSnapshot?.(shell.id, next);
      rememberSessionSnapshot(snapshotKey(machine.id, sessionId), next, machine.environmentId);
      return added;
    } catch (reason) {
      if (
        alive.current &&
        deletedHostBinding.current !== remoteBindingKey &&
        bindingVersion.current === binding &&
        historyPageRequest.current === request
      )
        setRemoteHistoryError(
          `Couldn’t load earlier messages: ${String(reason).replace(/^Error: /, "")}`,
        );
      return 0;
    } finally {
      if (historyPageRequest.current === request) {
        historyPageRequest.current = null;
        if (
          alive.current &&
          deletedHostBinding.current !== remoteBindingKey &&
          bindingVersion.current === binding
        )
          setRemoteHistoryLoading(false);
      }
    }
  };
  const loadLargeRemoteBlock = async (blockId: string, revision: number) => {
    const current = snapshotRef.current;
    if (
      !sessionId ||
      !current ||
      current.revision !== revision ||
      loadingRemoteBlocks.current.has(blockId)
    )
      return;
    const binding = bindingVersion.current;
    const ownerSessionId = current.session.id;
    const stub = current.session.blocks.find((block) => block.id === blockId);
    if (!stub?.remoteContent || stub.remoteContent.revision !== revision) return;
    loadingRemoteBlocks.current.add(blockId);
    try {
      const full = await loadRemoteBlock(machine.id, sessionId, blockId, revision);
      const latest = snapshotRef.current;
      if (
        !alive.current ||
        deletedHostBinding.current === remoteBindingKey ||
        bindingVersion.current !== binding ||
        boundSession.current !== sessionId ||
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
      snapshotRef.current = next;
      setSnapshot(next);
      onSnapshot?.(shell.id, next);
    } catch (reason) {
      if (
        alive.current &&
        deletedHostBinding.current !== remoteBindingKey &&
        bindingVersion.current === binding
      )
        setRemoteHistoryError(
          `Couldn’t load full output: ${String(reason).replace(/^Error: /, "")}`,
        );
    } finally {
      loadingRemoteBlocks.current.delete(blockId);
    }
  };
  const overrides: RemoteSessionOverrides = {
    workingMachine:
      online && hostSession && snapshot?.status === "running" ? machine.name : undefined,
    session,
    remoteSession: true,
    remoteFeatures: {
      attachments: !!descriptor?.capabilities.includes("attachments.upload"),
      plan: !!descriptor?.capabilities.includes("sessions.plan"),
      draft: !!descriptor?.capabilities.includes("sessions.draft"),
      steer: remoteCanSteer && !changes,
    },
    remoteSessionLoading: !!sessionId && !hostSession && !session.blocks.length,
    remoteSessionStarted: !!sessionId,
    remoteHistoryHasMore: snapshot?.history?.before !== undefined,
    remoteHistoryLoading,
    remoteHistoryError: remoteHistoryError || undefined,
    onLoadRemoteHistory: loadEarlierRemote,
    onLoadRemoteBlock: loadLargeRemoteBlock,
    sendBlockedReason: remoteDeleted
      ? "This conversation was deleted on the host."
      : pageCacheOnly
        ? "Showing a saved transcript preview. Reconnect to confirm the host before sending."
        : queue.error
          ? "Could not load queued messages. Retry loading the saved queue above."
          : snapshot?.historyLoading
            ? "Loading earlier messages…"
            : outboxIssues.length
              ? "An unfinished request needs recovery. Check the host and review the request above."
              : blocksSending(connection.status)
                ? needsSignIn(connection.status)
                  ? `${machine.name} needs you to sign in first. Use “Sign in and reconnect” above.`
                  : `Can’t reach ${machine.name}. Send reconnects first.`
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
          requestedSessionId === hostSession?.id ? rewind(blockId) : Promise.resolve(false)
      : undefined,
    onApproval: (_, requestId, decision) => approve(requestId, decision),
    onQuestionReply: (_, requestId, reply) => answer(requestId, reply),
    onCompactContext: compact,
    onModelChange: (_, harness, model) => {
      if (!isRemoteProvider(harness)) return;
      updateConfiguration((current) => ({
        ...current,
        harness,
        model,
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
    onRemoveDraft: (_, draftBlockId) => {
      if (!hostSession || busy || pending || !online || removingDraft) return false;
      if (
        hostSession.blocks.find((block) => block.id === draftBlockId)?.followUpDelivery ===
        "pending"
      )
        return false;
      setRemovingDraft(draftBlockId);
      if (hostSession.blocks.every((block) => block.id === draftBlockId))
        void discardSession(hostSession.id);
      else
        void run({
          type: "removeDraft",
          commandId: crypto.randomUUID(),
          sessionId: hostSession.id,
          draftBlockId,
        }).then((receipt) => {
          if (!receipt && alive.current) setRemovingDraft(undefined);
        });
      return true;
    },
    onPlaceSessionInFolder: noop,
    onDeleteQueuedMessage: (_, id) => queue.remove(id),
    onEditQueuedMessage: (_, id, text, attachments) => queue.edit(id, text, attachments),
    onQueuedMessageEditingChange: (_, id) => queue.setEditing(id),
    onReorderQueuedMessages: (_, ids) => queue.reorder(ids),
    onSteerQueuedMessage: async (_, id) => {
      if (!online || !hostSession || !remoteCanSteer || sending || pending || preparingRef.current)
        throw new Error(t("This conversation is still preparing. Wait and try again."));
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
      if (queue.current().editingId)
        throw new Error(t("Finish editing the queued message before resuming."));
      if (queue.current().messages[0]?.attachments.some((file) => file.missing))
        throw new Error(t("An attachment is missing. Edit the queued message before resuming."));
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
    onUsageLimitResume: noop,
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
      <div className="relative flex h-full min-h-0 flex-col">
        {uploadProgress ? (
          <div role="status" className="shrink-0 px-4 py-2 text-xs text-(--ui-text-muted)">
            {t("Uploading attachment: ")}
            {Math.round(
              uploadProgress.size ? (uploadProgress.offset / uploadProgress.size) * 100 : 100,
            )}
            %
          </div>
        ) : null}
        {snapshot?.historyLoading ? (
          <div role="status" className="shrink-0 px-4 py-2 text-xs text-(--ui-text-muted)">
            {t("Loading earlier messages…")}
          </div>
        ) : null}
        <RemoteConnectionBanner cwd={project.key} stale={!!hostSession} />
        <RemoteDataStatus
          state={remoteDataState}
          onRefresh={refreshOwnerContent}
          label={t("conversation")}
          disabled={remoteDeleted}
          connectionIssueHandled={
            connection.status !== "connected" &&
            (connection.status !== "connecting" || connection.reconnecting)
          }
        />
        <RemoteOutboxNotice project={project.key} environment={machine.environmentId} />
        {notice ? (
          <div
            role={error ? "alert" : "status"}
            className="flex shrink-0 items-center gap-3 border-b border-stroke px-4 py-2 text-[12px] text-(--ui-text-muted)"
          >
            <span className="min-w-0 flex-1 truncate" title={notice.detail}>
              {notice.text}
              {notice.detail ? (
                <span className="text-(--ui-text-muted)"> {notice.detail}</span>
              ) : null}
            </span>
            {notice.action ? (
              <Button
                type="button"
                disabled={!online && !queue.error && notice.action.label !== "Dismiss"}

                onClick={notice.action.run}
                variant="secondary"
              >
                {notice.action.label}
              </Button>
            ) : null}
          </div>
        ) : null}
        <div className="min-h-0 flex-1">{render(overrides)}</div>
      </div>
    </ModelSourceContext.Provider>
  );
}
