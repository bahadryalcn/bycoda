import { useCallback, useEffect, useMemo, useState } from "react";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { t } from "../../../shared/i18n";
import type { DockAgent } from "../model/activityDock";
import {
  delegatedAgentBlock,
  delegationParentOf,
  isDelegatedChildOf,
} from "../model/delegatedAgents";
import { useDelegatedDockAgents } from "../model/reactiveReads";
import type { Block, ComposerTurnOptions } from "../model/session";
import { getSessions, useSession, useSessionsSelector } from "../model/sessionsStore";
import { DelegatedSessionRequests } from "../../connections/public/DelegatedSessionRequests";
import { hostSessionBinding } from "../../connections/public/sessionExecutionBinding";
import { useHostSessionBindingReader } from "../../connections/public/useHostSessionBinding";
import { useRemoteSessionBindings } from "../../connections/public/useRemoteSessionBinding";
import { parseRemotePath } from "../../connections/public/remoteProjects";
import {
  captureRemoteSessionActions,
  subscribeRemoteSessionActions,
} from "../../connections/public/remoteSessionActions";
import {
  consumeViewDelegated,
  registerDelegatedStop,
  VIEW_DELEGATED_EVENT,
} from "./delegatedFocus";
import { requestViewSubagent } from "./subagentFocus";
import { useDelegatedMessage } from "./useDelegatedMessage";
import { SubagentSheet, type SubagentRelay } from "./SubagentSheet";

function isHostChild(session: NonNullable<ReturnType<typeof useSession>>): boolean {
  try {
    return !!hostSessionBinding(session) || !!parseRemotePath(session.cwd);
  } catch {
    return true;
  }
}

function canOwnDelegatedSession(
  session: NonNullable<ReturnType<typeof useSession>>,
  readHostBinding: ReturnType<typeof useHostSessionBindingReader>,
  remoteBindings: ReturnType<typeof useRemoteSessionBindings>,
): boolean {
  try {
    return (
      !!readHostBinding(session) ||
      (!!parseRemotePath(session.cwd) && !!remoteBindings.sessionFor(session.id))
    );
  } catch {
    return false;
  }
}

function readyOwner(id: string) {
  const captured = captureRemoteSessionActions(id);
  return captured?.current() && captured.actions.approvalSource?.() ? captured : undefined;
}

function stopChild(id: string, fallback: (sessionId: string) => unknown): unknown {
  const child = getSessions().find((session) => session.id === id);
  if (!child) throw new Error(t("This local conversation is unavailable or inaccessible."));
  if (!isHostChild(child)) return fallback(id);
  const captured = readyOwner(id);
  if (!captured) throw new Error(t("This local conversation is unavailable or inaccessible."));
  return captured.actions.stop();
}

/** How long a Stop waits for the child's Host owner to connect. */
const OWNER_DEADLINE_MS = 15_000;

function waitForOwner(id: string): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ready: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(ready);
    };
    const timer = setTimeout(() => finish(false), OWNER_DEADLINE_MS);
    const unsubscribe = subscribeRemoteSessionActions(id, () => {
      if (readyOwner(id)) finish(true);
    });
    if (readyOwner(id)) finish(true);
  });
}

/**
 * The cross-provider children of one session: their dock rows, the open panel
 * and stopping them. Native subagents keep `useSubagentSheet`; opening one
 * closes the other.
 */
export function useDelegatedSheet({
  sessionId,
  blocks,
  onStopSession,
  closeNative,
}: {
  sessionId: string;
  blocks: Block[];
  onStopSession: (sessionId: string) => unknown;
  closeNative: () => void;
}) {
  const [childId, setChildId] = useState<string | undefined>(undefined);
  const [isOpen, setOpen] = useState(false);
  // Host children whose Stop needs their owner: it connects only for that request.
  const [stopping, setStopping] = useState<readonly string[]>([]);
  const agents = useDelegatedDockAgents(sessionId, blocks);
  const running = agents
    .filter((agent) => agent.status === "running")
    .map((agent) => agent.sessionId);
  const stillStopping = stopping.filter((id) => running.includes(id));
  if (stillStopping.length !== stopping.length) setStopping(stillStopping);
  const open = useCallback(
    (id: string) => {
      closeNative();
      setChildId(id);
      setOpen(true);
    },
    [closeNative],
  );
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    const consume = () => {
      const id = consumeViewDelegated(sessionId);
      const sessions = getSessions();
      const child = id && sessions.find((session) => session.id === id);
      const parent = sessions.find((session) => session.id === sessionId);
      if (child && parent && isDelegatedChildOf(child, parent)) open(child.id);
    };
    window.addEventListener(VIEW_DELEGATED_EVENT, consume);
    consume();
    return () => window.removeEventListener(VIEW_DELEGATED_EVENT, consume);
  }, [sessionId, open]);
  const stop = useCallback(
    async (id: string) => {
      const child = getSessions().find((session) => session.id === id);
      if (child && isHostChild(child) && !readyOwner(id)) {
        setStopping((current) => (current.includes(id) ? current : [...current, id]));
        if (!(await waitForOwner(id))) {
          setStopping((current) => current.filter((entry) => entry !== id));
          throw new Error(t("This local conversation is unavailable or inaccessible."));
        }
      }
      await stopChild(id, onStopSession);
    },
    [onStopSession],
  );
  useEffect(() => registerDelegatedStop(sessionId, stop), [sessionId, stop]);
  /** Ends the running children; their own sessions then report cancelled. */
  const stopRunning = useCallback(async () => {
    await Promise.all(
      agents
        .filter((agent) => agent.sessionId && agent.status === "running")
        .map((agent) => stop(agent.sessionId!)),
    );
  }, [agents, stop]);
  return { childId, isOpen, open, close, agents, stop, stopRunning, stopping };
}

export type DelegatedSheetState = ReturnType<typeof useDelegatedSheet>;

/**
 * Everything the dock does for a session's children and native runs: which panel
 * a row opens, and what Stop means for each kind of row.
 */
export function useDockActions({
  sessionId,
  blocks,
  busy,
  perItemStop,
  stopBackground,
  onStop,
  native,
  btwOpen,
}: {
  sessionId: string;
  blocks: Block[];
  busy: boolean;
  perItemStop: boolean;
  stopBackground: (callId?: string) => Promise<void>;
  onStop: (sessionId: string) => unknown;
  native: { open: (blockId: string) => void; close: () => void };
  /** A side question takes over the pane: only one sheet over it at a time. */
  btwOpen: boolean;
}) {
  const { open: openNative, close: closeNative } = native;
  const delegated = useDelegatedSheet({
    sessionId,
    blocks,
    onStopSession: onStop,
    closeNative,
  });
  const { open: openChild, close: closeChild } = delegated;
  useEffect(() => {
    if (!btwOpen) return;
    closeNative();
    closeChild();
  }, [btwOpen, closeNative, closeChild]);
  const openDockAgent = useCallback(
    (agent: DockAgent) => {
      if (agent.sessionId) openChild(agent.sessionId);
      else if (agent.kind === "agent") requestViewSubagent(agent.blockId);
      else openNative(agent.blockId);
    },
    [openNative, openChild],
  );
  const stopDockAgent = useStableCallback((agent: DockAgent) =>
    agent.sessionId
      ? delegated.stop(agent.sessionId)
      : agent.callId
        ? stopBackground(agent.callId)
        : Promise.reject(new Error("No call to stop")),
  );
  const stopDockAll = useStableCallback(async () => {
    await delegated.stopRunning();
    if (busy) await (perItemStop ? stopBackground() : onStop(sessionId));
  });
  return {
    delegated,
    delegatedAgents: delegated.agents,
    openDockAgent,
    stopDockAgent,
    stopDockAll,
  };
}

/**
 * The subagent panel over a session pane. A native run keeps its relay through
 * the main agent; a delegated child is its own session, so its message is sent
 * straight to it. Always mounted, so a child's draft survives closing the panel.
 */
export function SessionSubagentSheet({
  visible,
  busy,
  cwd,
  native,
  delegated,
  onSubmitToSession,
  onStopSession,
  onLoadRemoteBlock,
  onOpenFile,
  onOpenDiff,
}: {
  visible: boolean;
  /** Whether the pane's own turn is busy; used for the native run. */
  busy: boolean;
  cwd?: string;
  native: {
    block?: Block;
    relay: SubagentRelay;
    blockedReason?: string;
    close: () => void;
    open: (blockId: string) => void;
    showInTranscript: (blockId: string) => boolean;
    onOpenMain: () => void;
    /** Present when the harness can stop one run without the whole turn. */
    stopRun?: (callId?: string) => Promise<void>;
  };
  delegated: DelegatedSheetState;
  onSubmitToSession: (
    sessionId: string,
    text: string,
    options: ComposerTurnOptions,
  ) => boolean | void;
  onStopSession: (sessionId: string) => unknown;
  onLoadRemoteBlock?: (blockId: string, revision: number) => Promise<void> | void;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
}) {
  const child = useSession(delegated.childId);
  const selected = !native.block && !!child && delegated.isOpen !== false;
  // A child's Host owner connects only while its panel is open or a Stop needs it;
  // children otherwise leave no sessions, queues or notices in the parent.
  const stopping = new Set(delegated.stopping ?? []);
  if (selected) stopping.delete(child.id);
  const pending = useSessionsSelector(
    (sessions) => sessions.filter((session) => stopping.has(session.id)),
    (a, b) => a.length === b.length && a.every((entry, index) => entry === b[index]),
  );
  const readHostBinding = useHostSessionBindingReader();
  const remoteBindings = useRemoteSessionBindings();
  const canOwn = (session: NonNullable<typeof child>) =>
    canOwnDelegatedSession(session, readHostBinding, remoteBindings);
  const owners = pending
    .filter(canOwn)
    .map((session) => (
      <DelegatedSessionRequests
        key={session.id}
        child={session}
        visible={visible}
        renderRequests={false}
        onOpenFile={onOpenFile}
        onOpenDiff={onOpenDiff}
      />
    ));
  const childBlock = useMemo(() => (child ? delegatedAgentBlock(child) : undefined), [child]);
  const message = useDelegatedMessage({
    childSessionId: child?.id,
    blocked: !child,
    onSubmit: (text, options) => {
      if (!child) return false;
      if (!isHostChild(child)) return onSubmitToSession(child.id, text, options);
      const captured = captureRemoteSessionActions(child.id);
      return captured?.current() && captured.actions.approvalSource?.()
        ? captured.actions.submit(text, [], options)
        : false;
    },
  });

  if (native.block) {
    const callId = native.block.tool?.callId;
    return (
      <>
        {owners}
        <SubagentSheet
          block={native.block}
          busy={busy}
          visible={visible}
          cwd={cwd}
          onClose={native.close}
          onStop={native.stopRun && callId ? () => native.stopRun!(callId) : undefined}
          onShowInTranscript={(blockId) => {
            native.close();
            const shown = native.showInTranscript(blockId);
            // Not in the transcript (virtualized away, filtered): keep the
            // details open rather than losing the reader's context.
            if (!shown) native.open(blockId);
            return shown;
          }}
          onLoadRemoteBlock={onLoadRemoteBlock}
          onOpenFile={onOpenFile}
          onOpenDiff={onOpenDiff}
          relay={{
            ...native.relay,
            blockedReason: native.blockedReason,
            onOpenConversation: native.onOpenMain,
          }}
        />
      </>
    );
  }
  if (!child || !childBlock) return <>{owners}</>;
  const running = !!child.busy || !!child.continuingElsewhere;
  return (
    <>
      {owners}
      <SubagentSheet
        block={childBlock}
        busy={running}
        visible={visible && (delegated.isOpen ?? true)}
        agentRole={delegationParentOf(child)?.kind}
        requests={
          selected && canOwn(child) ? (
            <DelegatedSessionRequests
              child={child}
              visible={visible}
              onOpenFile={onOpenFile}
              onOpenDiff={onOpenDiff}
            />
          ) : undefined
        }
        cwd={child.cwd}
        onClose={delegated.close}
        onStop={
          running
            ? async () => {
                await stopChild(child.id, onStopSession);
              }
            : undefined
        }
        onOpenFile={onOpenFile}
        onOpenDiff={onOpenDiff}
        relay={{
          mode: "direct",
          draft: message.draft,
          status: message.status,
          setDraft: message.setDraft,
          send: message.send,
        }}
      />
    </>
  );
}
