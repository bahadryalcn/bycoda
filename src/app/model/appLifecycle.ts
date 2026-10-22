import { t } from "../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../shared/lib/productIdentity";
import { serverTerminalRestoreState } from "../../features/connections/model/serverTerminalRestoreState";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask, message } from "@tauri-apps/plugin-dialog";
import { prepareEditorsToClose } from "../../features/files/model/editorClose";
import { confirmCloseTerminals } from "../../features/terminal/model/terminalClose";
import {
  bindHarnessSession,
  forgetHarnessSession,
  isLiveHarness,
} from "../../integrations/harness/core/registry";
import { killAllChildren } from "../../integrations/harness/core/child";
import {
  hasInFlightSessions,
  inFlightRefs,
  isInFlightSession,
  markTurnInterrupted,
  quitWhileBusyMessage,
  wasTurnInterrupted,
  workspaceFromResumed,
  type ResumedWorkspace,
} from "../../features/sessions/model/inFlight";
import { leafIds, type WorkspaceTab } from "../../features/workspace/model/layout";
import { killPty } from "../../platform/tauri/pty";
import {
  projectTerminalFileIds,
  type DockSide,
  type ProjectTerminalDock,
} from "../../features/projects/model/projectTerminal";
import { sessionWorkCwd, type Session } from "../../features/sessions/model/session";
import { sessionChildHarnesses } from "../../features/sessions/model/handoff";
import {
  getSession,
  listInFlightSessions,
  listSessionsByProject,
  loadWorkspaceSnapshot,
  replaceInFlightSessions,
  saveWorkspaceSnapshot,
  setSessionQueue,
  shouldPersistSession,
  upsertSession,
  type SessionSummary,
} from "../../features/sessions/data/sessionStore";
import {
  collectWorkspaceSnapshot,
  hydrateWorkspaceSnapshot,
  parseWorkspaceSnapshot,
} from "../../features/workspace/model/workspaceSnapshot";
import { flushComposerDrafts } from "../../features/sessions/data/composerDraftStore";
import { probeTurnTail, readTurnSteps, type TurnTail } from "../../platform/tauri/turnProbe";
import { markAutoContinueDue } from "../../features/sessions/model/autoContinue";
import {
  classifyTurnRecovery,
  shouldAutoContinue,
  withFinishedTurn,
} from "../../features/sessions/model/turnRecovery";
import type { TurnSteps } from "../../features/sessions/model/turnSteps";
import { loadAutoContinueInterrupted } from "../../features/settings/model/settings";
import { loadWindowTransfer } from "./windowTransferBootstrap";
import type { WindowTransferPayload } from "./windowTransfer";
import {
  lastProjectPath,
  normalizeProjectPath,
  sameProjectPath,
} from "../../features/projects/model/recents";
import type { ProjectReturnMemory } from "../../features/projects/model/projectReturn";
import { appName } from "../../shared/lib/appName";
import { readToolWindow } from "./toolWindows";

export type { ResumedWorkspace };
import {
  captureSessionRecovery,
  dropRecoverySessions,
  parseSessionRecovery,
  setSessionRecovery,
} from "../../features/workspace/model/sessionRecovery";
import {
  isUnsentRemoteChat,
  isUnsentRemoteShell,
} from "../../features/workspace/model/remoteEmptyChats";
import { remoteShellState } from "../../features/connections/model/remoteShellState";
export { hasInFlightSessions };

export type BootWorkspace = {
  windowTransfer: WindowTransferPayload | null;
  resumed: ResumedWorkspace | null;
  /** Sidebar rows listed before first paint, so the rail is not empty. */
  history: SessionSummary[];
  historyCwd: string | null;
};

let resumedPromise: Promise<ResumedWorkspace | null> | null = null;
let bootPromise: Promise<BootWorkspace> | null = null;
let quitting = false;
let quitDialogOpen = false;
let bootingResumed: ResumedWorkspace | null = null;
let liveWorkspace: {
  sessions: () => Session[];
  tabs: () => WorkspaceTab[];
  activeTabId: () => string;
  projectCwd: () => string;
  projectTerminals: () => ProjectTerminalDock[];
  projectReturnMemory: () => ProjectReturnMemory;
  lastDockSide: () => DockSide | null;
  keepTab?: (tab: WorkspaceTab) => boolean;
  flush: () => void;
} | null = null;

export function isAppQuitting(): boolean {
  return quitting;
}

export function setQuitWorkspace(
  sessions: () => Session[],
  tabs: () => WorkspaceTab[],
  activeTabId: () => string,
  projectCwd: () => string,
  projectTerminals: () => ProjectTerminalDock[],
  projectReturnMemory: () => ProjectReturnMemory,
  flush: () => void,
  lastDockSide: () => DockSide | null = () => null,
  keepTab?: (tab: WorkspaceTab) => boolean,
): () => void {
  liveWorkspace = {
    sessions,
    tabs,
    activeTabId,
    projectCwd,
    projectTerminals,
    projectReturnMemory,
    lastDockSide,
    keepTab,
    flush,
  };
  bootingResumed = null;
  return () => {
    if (liveWorkspace?.sessions === sessions) liveWorkspace = null;
  };
}

/**
 * Persist this window for a quit the coordinator has already confirmed.
 * Exiting is `confirm_quit`'s job, once every window has reported ready.
 */
export async function handleQuitRequested(): Promise<boolean> {
  if (liveWorkspace) {
    liveWorkspace.flush();
    quitting = true;
    try {
      if (!(await prepareWindowToClose(liveWorkspace.tabs(), liveWorkspace.projectTerminals()))) {
        quitting = false;
        return false;
      }
      await persistQuitState(
        liveWorkspace.sessions(),
        liveWorkspace.tabs(),
        liveWorkspace.activeTabId(),
        liveWorkspace.projectCwd(),
        liveWorkspace.projectReturnMemory(),
        "quit",
        liveWorkspace.projectTerminals(),
        liveWorkspace.lastDockSide() ?? undefined,
        liveWorkspace.keepTab,
      );
      return true;
    } catch (error) {
      quitting = false;
      await reportCloseFailure(error);
      return false;
    }
  }
  const { resumed } = await loadBootWorkspace();
  const pending = resumed ?? bootingResumed;
  quitting = true;
  if (!pending) return true;
  try {
    await persistBootingResume(pending);
    return true;
  } catch {
    quitting = false;
    return false;
  }
}

/** Each window counts its own live turns; Rust sums them into one decision. */
export async function reportQuitPoll(id: number): Promise<void> {
  let inFlight = 0;
  if (liveWorkspace) {
    liveWorkspace.flush();
    // Every running turn, not just the resumable ones `inFlightRefs` keeps:
    // an Inbox Ask still counts as work nobody agreed to throw away.
    inFlight = liveWorkspace.sessions().filter(isInFlightSession).length;
  }
  await invoke("quit_poll_reply", { id, inFlight }).catch((error) => {
    console.warn("appLifecycle operation failed", error);
  });
}

/** The one quit dialog, shown by whichever window the coordinator picked. */
export async function askQuitConfirmation(id: number, inFlight: number): Promise<void> {
  let confirmed = false;
  if (!quitDialogOpen) {
    quitDialogOpen = true;
    try {
      confirmed = await ask(quitWhileBusyMessage(inFlight), {
        title: appName(),
        kind: "warning",
        get okLabel() {
          return t("Quit");
        },
      });
    } catch {
      confirmed = false;
    } finally {
      quitDialogOpen = false;
    }
  }
  await invoke("quit_decision", { id, confirmed }).catch((error) => {
    console.warn("appLifecycle operation failed", error);
  });
}

export async function commitQuit(id: number): Promise<void> {
  const persisted = await handleQuitRequested();
  await invoke("quit_ready", { id, persisted }).catch((error) => {
    console.warn("appLifecycle operation failed", error);
  });
}

/**
 * A quit that stopped part-way because another window could not save. This
 * window is staying open, so it must go back to persisting on unload.
 */
export function abortQuit(): void {
  quitting = false;
}

/** A successfully drained pop-out must not save a stale workspace on unload. */
export function relinquishTransferredWindow(): void {
  quitting = true;
  liveWorkspace = null;
  bootingResumed = null;
}

/** Confirm and stop this window's work without terminating other windows. */
export async function closeBusyWindow(): Promise<void> {
  if (!liveWorkspace) return;
  liveWorkspace.flush();
  await confirmAndCloseWindow(
    liveWorkspace.sessions(),
    liveWorkspace.tabs(),
    liveWorkspace.activeTabId(),
    liveWorkspace.projectCwd(),
    liveWorkspace.projectReturnMemory(),
    liveWorkspace.projectTerminals(),
    liveWorkspace.lastDockSide() ?? undefined,
    liveWorkspace.keepTab,
  );
}

export function loadResumedWorkspace(): Promise<ResumedWorkspace | null> {
  if (!resumedPromise) resumedPromise = loadResumedWorkspaceOnce();
  return resumedPromise;
}

/** Transfer and restore run once; callers share the same promise. */
export function loadBootWorkspace(): Promise<BootWorkspace> {
  if (readToolWindow()) {
    return Promise.resolve({ windowTransfer: null, resumed: null, history: [], historyCwd: null });
  }
  if (!bootPromise) {
    bootPromise = (async () => {
      const windowTransfer = await loadWindowTransfer();
      if (windowTransfer) {
        // The transfer already contains everything needed to paint its tab.
        // Workspace.refreshHistory loads the sidebar after mounting.
        return {
          windowTransfer,
          resumed: null,
          history: [],
          historyCwd: null,
        };
      }
      const hintedCwd = lastProjectPath();
      const historyHint = listProjectHistory(hintedCwd);
      const [resumed, hinted] = await Promise.all([loadResumedWorkspace(), historyHint]);
      const listed = await historyForCwd(
        resumed?.projectCwd ?? hintedCwd,
        hintedCwd,
        Promise.resolve(hinted),
      );
      return {
        windowTransfer: null,
        resumed,
        history: listed?.rows ?? [],
        historyCwd: listed?.cwd ?? null,
      };
    })();
  }
  return bootPromise;
}

async function listProjectHistory(
  cwd: string | null | undefined,
): Promise<{ cwd: string; rows: SessionSummary[] } | null> {
  if (!cwd || cwd === "~") return null;
  try {
    const rows = await listSessionsByProject(cwd);
    return { cwd: normalizeProjectPath(cwd), rows };
  } catch {
    return null;
  }
}

async function historyForCwd(
  cwd: string | null | undefined,
  hintedCwd: string | null | undefined,
  hinted: Promise<{ cwd: string; rows: SessionSummary[] } | null>,
): Promise<{ cwd: string; rows: SessionSummary[] } | null> {
  if (!cwd || cwd === "~") return null;
  if (hintedCwd && sameProjectPath(cwd, hintedCwd)) return hinted;
  return listProjectHistory(cwd);
}

async function loadResumedWorkspaceOnce(): Promise<ResumedWorkspace | null> {
  let serverRestoreOwner = false;
  try {
    serverRestoreOwner = getCurrentWindow().label === "main";
  } catch {
    // No desktop window authority: leave this optional state uninitialized.
  }
  if (serverRestoreOwner) serverTerminalRestoreState.beginLoad();
  const [snapshotResult, refs] = await Promise.all([
    loadWorkspaceSnapshot()
      .then((raw) => ({ ok: true, raw }))
      .catch(() => ({ ok: false, raw: null })),
    listInFlightSessions().catch(() => []),
  ]);
  const snapshotRaw = snapshotResult.raw;
  if (serverRestoreOwner && snapshotResult.ok) {
    serverTerminalRestoreState.initialize(
      snapshotRaw && typeof snapshotRaw === "object" && "serversRestore" in snapshotRaw
        ? snapshotRaw.serversRestore
        : undefined,
    );
  } else if (serverRestoreOwner) {
    serverTerminalRestoreState.loadFailed();
  }
  const interrupted = new Set(refs.map((ref) => ref.sessionId));
  const snapshot = parseWorkspaceSnapshot(snapshotRaw);
  const savedRecovery = parseSessionRecovery(
    snapshotRaw && typeof snapshotRaw === "object" && "sessionRecovery" in snapshotRaw
      ? snapshotRaw.sessionRecovery
      : null,
  );
  // Entries saved before a remote chat was ever sent are not recoverable history.
  const previousRecovery =
    savedRecovery &&
    dropRecoverySessions(
      savedRecovery,
      savedRecovery.workspace.sessions
        .filter((stub) =>
          isUnsentRemoteShell(
            stub,
            remoteShellState(stub, { bound: !!stub.remoteSessionId, hasDraft: false }),
          ),
        )
        .map((stub) => stub.id),
    );
  setSessionRecovery(previousRecovery);

  const ids = new Set<string>();
  if (snapshot) {
    for (const stub of snapshot.sessions) ids.add(stub.id);
    for (const tab of snapshot.tabs) {
      for (const id of leafIds(tab.layout)) ids.add(id);
    }
  }
  for (const ref of refs) ids.add(ref.sessionId);

  const loaded = new Map<string, Session>();
  await Promise.all(
    [...ids].map(async (id) => {
      const record = await getSession(id).catch(() => null);
      if (record) loaded.set(id, record);
    }),
  );

  let workspace = snapshot ? hydrateWorkspaceSnapshot(snapshot, loaded, interrupted) : null;
  if (!workspace && refs.length > 0) {
    const sessions: Session[] = [];
    for (const ref of refs) {
      const record = loaded.get(ref.sessionId);
      if (!record) continue;
      sessions.push(markTurnInterrupted(record));
    }
    workspace = workspaceFromResumed(sessions);
  }

  if (workspace) {
    const recovered = await Promise.all(
      workspace.sessions.map((session) =>
        interrupted.has(session.id) ? recoverInterruptedTurn(session) : session,
      ),
    );
    workspace = { ...workspace, sessions: recovered };
  }

  bootingResumed = workspace;
  if (workspace) {
    const recoverable = workspace.sessions.filter(
      (session) =>
        !session.inboxAsk &&
        !session.orchestrationLeadId &&
        // Drafts live in their own store and stay with the tab, so they do not keep it here.
        !isUnsentRemoteChat(session, remoteShellState(session, { hasDraft: false })) &&
        (session.cwd.startsWith("remote://") ||
          session.blocks.some((block) => block.role === "user") ||
          (session.rewindHistory?.length ?? 0) > 0),
    );
    if (recoverable.length) {
      setSessionRecovery(
        captureSessionRecovery(
          previousRecovery,
          collectWorkspaceSnapshot(
            workspace.tabs,
            recoverable,
            workspace.activeTabId,
            workspace.projectCwd,
            workspace.projectReturnMemory ?? new Map(),
          ),
        ),
      );
      // Freeze recovery before the first app paint can replace the workspace.
      await saveWorkspaceSnapshot(
        snapshotRaw ??
          collectWorkspaceSnapshot(
            workspace.tabs,
            workspace.sessions,
            workspace.activeTabId,
            workspace.projectCwd,
            workspace.projectReturnMemory ?? new Map(),
            workspace.projectTerminals,
            workspace.lastDockSide,
          ),
      ).catch((error) => console.warn("Could not persist session recovery", error));
    }
  }
  if (workspace) {
    await Promise.all(
      workspace.sessions
        // Idle transcripts already came from disk. Rewriting every open chat
        // here serialized/indexed the entire workspace before first paint.
        .filter((session) => interrupted.has(session.id) && shouldPersistSession(session))
        .map((session) => upsertSession(session).catch(() => null)),
    );
  }
  return workspace;
}

/**
 * Local CLIs cannot outlive Bycoda: on Windows every harness child is in a
 * kill-on-close job object, and on macOS/Linux each runs in its own process
 * group that `kill_all` signals at exit (a crash leaves orphans, and the next
 * launch reaps them). So at launch a chat that was mid-turn has no live
 * process, and only the transcript can say whether the turn got to finish.
 * Remote chats never come through here: their host keeps running and the app
 * re-attaches to its snapshot.
 */
const LOCAL_CHILD_LIVENESS = "dead" as const;
const PROBE_TIMEOUT_MS = 3000;

function transcriptProvider(session: Session): "claude" | "codex" | null {
  const provider = session.harness;
  return (provider === "claude" || provider === "codex") && session.providerSessionId
    ? provider
    : null;
}

/** Bounded so a slow disk cannot hold up the first paint. */
function withinTimeout<T>(work: Promise<T>, fallback: T): Promise<T> {
  const timeout = new Promise<T>((resolve) =>
    window.setTimeout(() => resolve(fallback), PROBE_TIMEOUT_MS),
  );
  return Promise.race([work, timeout]).catch(() => fallback);
}

async function transcriptTail(session: Session): Promise<TurnTail | "unsupported"> {
  const provider = transcriptProvider(session);
  if (!provider) return "unsupported";
  return withinTimeout(
    probeTurnTail({
      provider,
      providerSessionId: session.providerSessionId!,
      cwd: sessionWorkCwd(session),
      providerAccountId: session.providerAccountId,
    }),
    { state: "missing" } as TurnTail,
  );
}

/** What the CLI recorded for the last turn, read alongside the tail probe. */
function readRecordedSteps(session: Session): Promise<TurnSteps | null> {
  const provider = transcriptProvider(session);
  if (!provider) return Promise.resolve(null);
  return withinTimeout(
    readTurnSteps({
      provider,
      providerSessionId: session.providerSessionId!,
      cwd: sessionWorkCwd(session),
      providerAccountId: session.providerAccountId,
    }),
    null,
  );
}

/**
 * Put those steps into the session. Anything that goes wrong leaves it as it
 * was: the quit note and the final reply logic still apply on top.
 */
async function withRecordedSteps(
  session: Session,
  steps: TurnSteps | null,
  outcome: "finished" | "interrupted",
): Promise<Session> {
  if (!steps) return session;
  try {
    // The conversion pulls in the provider adapters; boot only pays for them
    // when there is a turn to rebuild.
    const { withTurnSteps } = await import("../../features/sessions/model/turnSteps");
    return withTurnSteps(session, steps, outcome);
  } catch {
    return session;
  }
}

/**
 * A chat that was mid-turn when Bycoda went away: look at what really
 * happened before anything is sent. A turn that finished is shown as finished;
 * only a turn that was cut off may be continued, and only when that is certain.
 * Either way the steps the CLI recorded while the app was away are filled in.
 */
async function recoverInterruptedTurn(session: Session): Promise<Session> {
  const [tail, steps] = await Promise.all([transcriptTail(session), readRecordedSteps(session)]);
  const recovery = classifyTurnRecovery({
    wasInFlight: true,
    liveness: LOCAL_CHILD_LIVENESS,
    backgroundWorkAlive: false,
    transcript: tail === "unsupported" ? tail : tail.state,
  });
  if (recovery.state === "finished") {
    return withFinishedTurn(
      await withRecordedSteps(session, steps, "finished"),
      tail === "unsupported" ? undefined : tail.finalText,
    );
  }
  const recovered =
    recovery.state === "interrupted"
      ? await withRecordedSteps(session, steps, "interrupted")
      : session;
  if (
    shouldAutoContinue({
      recovery,
      enabled: loadAutoContinueInterrupted(),
      queuedCount: recovered.queuedMessages?.length ?? 0,
    })
  ) {
    markAutoContinueDue(recovered.id);
  }
  return recovered;
}

export function bindResumedSessions(sessions: Session[]): void {
  for (const session of sessions) {
    if (session.worktreeRemoved || !session.providerSessionId || !isLiveHarness(session.harness))
      continue;
    bindHarnessSession(
      session.harness,
      session.id,
      session.providerSessionId,
      sessionWorkCwd(session),
      session.providerAccountId,
      session.blocks,
    );
  }
}

export async function hideCurrentWindow(): Promise<void> {
  await invoke("hide_window");
}

export async function closeCurrentWindow(): Promise<void> {
  await invoke("destroy_window");
}

export async function confirmReload(hasUnsavedFiles: boolean): Promise<boolean> {
  if (!hasUnsavedFiles) return true;
  return ask(t("Reload {p0} and discard unsaved changes?", { p0: PRODUCT_IDENTITY.displayName }), {
    title: appName(),
    kind: "warning",
    get okLabel() {
      return t("Reload");
    },
  });
}

export async function persistLiveTranscripts(sessions: Session[]): Promise<void> {
  await flushComposerDrafts().catch((error) => {
    console.warn("appLifecycle operation failed", error);
  });
  await Promise.all(
    sessions
      .filter(shouldPersistSession)
      .map((session) => upsertSession(session).catch(() => null)),
  );
}

export async function persistQuitState(
  sessions: Session[],
  tabs: WorkspaceTab[],
  activeTabId: string,
  projectCwd: string,
  memory: ProjectReturnMemory,
  mode: "quit" | "unload" = "quit",
  projectTerminals: ProjectTerminalDock[] = [],
  lastDockSide?: DockSide,
  keepTab?: (tab: WorkspaceTab) => boolean,
): Promise<void> {
  const refs = inFlightRefs(sessions, tabs);
  const interrupted = new Set(refs.map((ref) => ref.sessionId));
  // A quit ends the process, so a swallowed write is work that never comes
  // back: let it reject and let the caller call the quit off. An unload is a
  // reload, where best effort is enough and failing loudly helps nobody.
  const write = <T>(pending: Promise<T>): Promise<T | null> =>
    mode === "quit" ? pending : pending.catch(() => null);

  await Promise.all(
    sessions.map(async (session) => {
      if (!shouldPersistSession(session)) return;
      const payload = interrupted.has(session.id) ? markTurnInterrupted(session) : session;
      const saved = await write(upsertSession(payload));
      // A revision conflict resolves without a write. Keep this renderer's
      // unique transcript alive rather than reporting it safely persisted.
      if (mode === "quit" && saved === null) {
        throw new Error(
          "The conversation could not be saved. It may have changed in another window.",
        );
      }
    }),
  );
  // Drafts wait on a short timer; the quit must not.
  await write(flushComposerDrafts());
  // The queue hook writes through as it changes; this settles the last edit
  // before the process goes.
  await Promise.all(
    sessions
      .filter((session) => shouldPersistSession(session) && session.queuedMessages?.length)
      .map((session) => write(setSessionQueue(session.id, session.queuedMessages))),
  );
  await write(
    saveWorkspaceSnapshot(
      collectWorkspaceSnapshot(
        tabs,
        sessions,
        activeTabId,
        projectCwd,
        memory,
        projectTerminals,
        lastDockSide,
        keepTab,
      ),
    ),
  );
  // Vite/webview reload must not wipe a restored snapshot: those chats are idle
  // in this process until Continue runs.
  if (mode === "quit" || refs.length > 0) {
    await write(replaceInFlightSessions(refs));
  }
}

async function persistBootingResume(workspace: ResumedWorkspace): Promise<void> {
  await Promise.all(
    workspace.sessions
      .filter(shouldPersistSession)
      .map((session) => upsertSession(session).catch(() => null)),
  );
  await saveWorkspaceSnapshot(
    collectWorkspaceSnapshot(
      workspace.tabs,
      workspace.sessions,
      workspace.activeTabId,
      workspace.projectCwd,
      workspace.projectReturnMemory ?? new Map(),
      workspace.projectTerminals ?? [],
      workspace.lastDockSide,
    ),
  ).catch((error) => {
    console.warn("appLifecycle operation failed", error);
  });
  await replaceInFlightSessions(
    workspace.sessions.filter(wasTurnInterrupted).map((session) => ({
      sessionId: session.id,
      cwd: session.cwd,
    })),
  ).catch((error) => {
    console.warn("appLifecycle operation failed", error);
  });
}

async function confirmAndCloseWindow(
  sessions: Session[],
  tabs: WorkspaceTab[],
  activeTabId: string,
  projectCwd: string,
  memory: ProjectReturnMemory,
  projectTerminals: ProjectTerminalDock[] = [],
  lastDockSide?: DockSide,
  keepTab?: (tab: WorkspaceTab) => boolean,
): Promise<void> {
  if (quitDialogOpen) return;
  quitDialogOpen = true;
  try {
    if (hasInFlightSessions(sessions)) {
      const ok = await ask(
        t("Close this window and stop its running chats? Other windows will stay open."),
        {
          title: appName(),
          kind: "warning",
          get okLabel() {
            return t("Close window");
          },
        },
      );
      if (!ok) return;
    }
    quitting = true;
    try {
      if (!(await prepareWindowToClose(tabs, projectTerminals))) {
        quitting = false;
        return;
      }
      await persistQuitState(
        sessions,
        tabs,
        activeTabId,
        projectCwd,
        memory,
        "quit",
        projectTerminals,
        lastDockSide,
        keepTab,
      );
      await reapWindowRuntime(sessions, tabs, projectTerminals, false);
      await closeCurrentWindow();
    } catch (error) {
      quitting = false;
      await reportCloseFailure(error);
    }
  } finally {
    quitDialogOpen = false;
  }
}

async function prepareWindowToClose(
  tabs: WorkspaceTab[],
  docks: ProjectTerminalDock[],
): Promise<boolean> {
  const files = [
    ...tabs.flatMap((tab) =>
      [...tab.editorPanes, ...(tab.terminalPanes ?? [])].flatMap((pane) => pane.files),
    ),
    ...docks.flatMap((dock) => dock.pane.files),
  ];
  const unique = [
    ...new Map(files.filter((file) => file.terminal).map((file) => [file.id, file])).values(),
  ];
  if (!(await confirmCloseTerminals(unique))) return false;
  return prepareEditorsToClose();
}

async function reportCloseFailure(error: unknown): Promise<void> {
  console.warn("Persisting close state failed", error);
  await message(
    t(
      "Could not save before closing. The window remains open. Retry closing to try again.\n\n{p0}",
      { p0: String(error) },
    ),
    {
      title: appName(),
      kind: "error",
    },
  ).catch((dialogError) => console.warn("Showing close failure failed", dialogError));
}

export async function reapWindowRuntime(
  sessions: Session[],
  tabs: WorkspaceTab[],
  projectTerminals: ProjectTerminalDock[] = [],
  includeAllChildren = true,
): Promise<void> {
  await forgetSessionChildren(sessions);
  await Promise.all(
    [...terminalFileIds(tabs), ...projectTerminalFileIds(projectTerminals)].map((id) =>
      killPty(id),
    ),
  );
  // Catalog probes, title generators, and usage scrapers are not session
  // children. Drop them so an unused Pi/Codex probe cannot outlive the window.
  if (includeAllChildren)
    await killAllChildren().catch((error) => {
      console.warn("appLifecycle operation failed", error);
    });
}

/**
 * Page unload. Unlike `reapWindowRuntime` this leaves terminals running: a
 * reload (or macOS restarting a crashed web process) restores them under the
 * same ids and reattaches, and the backend reaps them when the window itself
 * is destroyed.
 */
export async function reapUnloadRuntime(sessions: Session[]): Promise<void> {
  await forgetSessionChildren(sessions);
  await killAllChildren().catch((error) => {
    console.warn("appLifecycle operation failed", error);
  });
}

async function forgetSessionChildren(sessions: Session[]): Promise<void> {
  await Promise.all(
    sessions.map((session) =>
      Promise.all(
        sessionChildHarnesses(session).map((harness) => forgetHarnessSession(harness, session.id)),
      ),
    ),
  );
}

function terminalFileIds(tabs: WorkspaceTab[]): string[] {
  const ids: string[] = [];
  for (const tab of tabs) {
    for (const pane of [...tab.editorPanes, ...(tab.terminalPanes ?? [])]) {
      for (const file of pane.files) {
        if (file.terminal) ids.push(file.id);
      }
    }
  }
  return ids;
}
