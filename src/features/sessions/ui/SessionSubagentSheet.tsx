import { useCallback, useEffect, useMemo, useState, type ComponentProps } from "react";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { t, useT } from "../../../shared/i18n";
import { Text } from "../../../shared/ui/Text";
import type { DockAgent } from "../model/activityDock";
import {
  delegatedAgentBlock,
  delegationParentOf,
  isDelegatedChildOf,
  isDelegatedDescendantOf,
} from "../model/delegatedAgents";
import { useDelegatedDockAgents, useNestedDelegationOwner } from "../model/reactiveReads";
import {
  sessionNeedsInput,
  type Attachment,
  type Block,
  type ComposerTurnOptions,
} from "../model/session";
import type { ParentAdmission } from "../data/parentInputClosure";
import {
  getSessions,
  selectSessionById,
  usePaneSession,
  useSession,
  useSessionsSelector,
} from "../model/sessionsStore";
import {
  DelegatedSessionRequests,
  useDelegatedMessageReceipts,
} from "../../connections/public/DelegatedSessionRequests";
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
  registerDelegatedRetry,
  registerDelegatedStop,
  VIEW_DELEGATED_EVENT,
} from "./delegatedFocus";
import { requestViewSubagent } from "./subagentFocus";
import { InlineError } from "../../../shared/ui/InlineError";
import { useStopRequests } from "./useStopRequests";
import { SubagentChatComposer } from "./SubagentMessageForm";
import { SubagentSheet, type SubagentRelay } from "./SubagentSheet";
import { NestedSubagentList } from "./NestedSubagentList";

const NO_BLOCKS: Block[] = [];

function isHostChild(
  session: NonNullable<ReturnType<typeof useSession>>,
  readBinding: ReturnType<typeof useHostSessionBindingReader>,
): boolean {
  try {
    return !!readBinding(session) || !!parseRemotePath(session.cwd);
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

/**
 * Which Host serves this child, for its message receipts: the local binding, or the
 * remote project's environment with the session it is paired to. Anything unreadable
 * reads as no authority, never as another one.
 */
function receiptAuthority(
  session: NonNullable<ReturnType<typeof useSession>>,
  readHostBinding: ReturnType<typeof useHostSessionBindingReader>,
  remoteBindings: ReturnType<typeof useRemoteSessionBindings>,
): { environmentId: string; sessionId: string; machineId?: string } | undefined {
  try {
    const remote = parseRemotePath(session.cwd);
    if (remote) {
      const sessionId = remoteBindings.sessionFor(session.id);
      return sessionId ? { environmentId: remote.environmentId, sessionId } : undefined;
    }
    const binding = readHostBinding(session);
    return binding
      ? {
          environmentId: binding.environmentId,
          sessionId: binding.sessionId,
          machineId: binding.machineId,
        }
      : undefined;
  } catch {
    return undefined;
  }
}

function readyOwner(id: string) {
  const captured = captureRemoteSessionActions(id);
  return captured?.current() && captured.actions.approvalSource?.() ? captured : undefined;
}

function stopChild(id: string, fallback: (sessionId: string) => unknown): unknown {
  const child = getSessions().find((session) => session.id === id);
  if (!child) throw new Error(t("This local conversation is unavailable or inaccessible."));
  if (!isHostChild(child, hostSessionBinding)) return fallback(id);
  const captured = readyOwner(id);
  if (!captured) throw new Error(t("This local conversation is unavailable or inaccessible."));
  return captured.actions.stop();
}

/** Sends text to a child session: straight to it, or through its Host owner. */
function submitToChild(
  child: NonNullable<ReturnType<typeof useSession>>,
  text: string,
  options: ComposerTurnOptions,
  onSubmitToSession: (sessionId: string, text: string, options: ComposerTurnOptions) => unknown,
): boolean | void {
  if (!isHostChild(child, hostSessionBinding))
    return onSubmitToSession(child.id, text, options) as boolean | void;
  const captured = captureRemoteSessionActions(child.id);
  return captured?.current() && captured.actions.approvalSource?.()
    ? captured.actions.submit(text, [], options)
    : false;
}

type SubmitToSession = (
  sessionId: string,
  text: string,
  options: ComposerTurnOptions,
  attachments?: Attachment[],
  admission?: ParentAdmission,
) => boolean | void;

type ChildQueueActions = Pick<
  ComponentProps<typeof SubagentChatComposer>,
  | "onDeleteQueuedMessage"
  | "onEditQueuedMessage"
  | "onQueuedMessageEditingChange"
  | "onReorderQueuedMessages"
  | "onSteerQueuedMessage"
  | "onResumeQueue"
>;

// Module level: React Compiler cannot lower try/finally inside a hook.
async function retryChild(
  id: string,
  onSubmitToSession: SubmitToSession,
  setConnecting: (update: (current: readonly string[]) => readonly string[]) => void,
): Promise<void> {
  const child = getSessions().find((session) => session.id === id);
  const unavailable = () => new Error(t("This local conversation is unavailable or inaccessible."));
  if (!child) throw unavailable();
  // A Host child's owner connects only for a request: hold it until the task is sent.
  setConnecting((current) => (current.includes(id) ? current : [...current, id]));
  try {
    if (isHostChild(child, hostSessionBinding) && !readyOwner(id) && !(await waitForOwner(id)))
      throw unavailable();
    if (submitToChild(child, t("Retry the same task."), {}, onSubmitToSession) === false)
      throw new Error(t("Request was not accepted. Your message is kept here; try again."));
  } finally {
    setConnecting((current) => current.filter((entry) => entry !== id));
  }
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
  onSubmitToSession,
  closeNative,
}: {
  sessionId: string;
  blocks: Block[];
  onStopSession: (sessionId: string) => unknown;
  onSubmitToSession: SubmitToSession;
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
  // Children whose Host owner is held open while a Retry reaches them.
  const [connecting, setConnecting] = useState<readonly string[]>([]);
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
      if (child && parent && isDelegatedDescendantOf(child, parent, sessions)) open(child.id);
    };
    window.addEventListener(VIEW_DELEGATED_EVENT, consume);
    consume();
    return () => window.removeEventListener(VIEW_DELEGATED_EVENT, consume);
  }, [sessionId, open]);
  const stop = useCallback(
    async (id: string) => {
      const child = getSessions().find((session) => session.id === id);
      if (child && isHostChild(child, hostSessionBinding) && !readyOwner(id)) {
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
  const retry = useStableCallback((id: string) => retryChild(id, onSubmitToSession, setConnecting));
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- registers this pane as the owner of its children's Retry for the module registry until unmount
  useEffect(() => registerDelegatedRetry(sessionId, retry), [sessionId, retry]);
  /** Ends the running children; their own sessions then report cancelled. */
  const stopRunning = useCallback(async () => {
    await Promise.all(
      agents
        .filter((agent) => agent.sessionId && agent.status === "running")
        .map((agent) => stop(agent.sessionId!)),
    );
  }, [agents, stop]);
  return { childId, isOpen, open, close, agents, stop, stopRunning, stopping, connecting };
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
  onSubmitToSession,
  native,
  btwOpen,
}: {
  sessionId: string;
  blocks: Block[];
  busy: boolean;
  perItemStop: boolean;
  stopBackground: (callId?: string) => Promise<void>;
  onStop: (sessionId: string) => unknown;
  onSubmitToSession: SubmitToSession;
  native: { open: (blockId: string) => void; close: () => void };
  /** A side question takes over the pane: only one sheet over it at a time. */
  btwOpen: boolean;
}) {
  const { open: openNative, close: closeNative } = native;
  const delegated = useDelegatedSheet({
    sessionId,
    blocks,
    onStopSession: onStop,
    onSubmitToSession,
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
  localQueueActions,
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
    liveSessionId?: string;
    relay: SubagentRelay;
    blockedReason?: string;
    close: () => void;
    open: (blockId: string) => void;
    showInTranscript: (blockId: string) => boolean;
    /** Present when the harness can stop one run without the whole turn. */
    stopRun?: (callId?: string) => Promise<void>;
  };
  delegated: DelegatedSheetState;
  onSubmitToSession: SubmitToSession;
  localQueueActions?: (sessionId: string) => ChildQueueActions;
  onStopSession: (sessionId: string) => unknown;
  onLoadRemoteBlock?: (blockId: string, revision: number) => Promise<void> | void;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
}) {
  const translate = useT();
  const panelSelected = !native.block && delegated.isOpen !== false;
  // Keep the closed sheet's last child so its scroll and disclosure state survive.
  // Reopening selects the current snapshot, including everything received while closed.
  const child = usePaneSession(
    native.block ? undefined : delegated.childId,
    visible && panelSelected,
    (a, b) => a === b || (!panelSelected && a?.id === b?.id),
  );
  // The pane skips running command output. An open details sheet follows its own block.
  const currentBlock = useSessionsSelector((sessions) => {
    if (!visible || !native.block || !native.liveSessionId) return native.block;
    const blocks = selectSessionById(sessions, native.liveSessionId)?.blocks;
    if (!blocks) return native.block;
    for (let index = blocks.length - 1; index >= 0; index--) {
      if (blocks[index].id === native.block.id) return blocks[index];
    }
    return native.block;
  });
  const selected = !currentBlock && !!child && delegated.isOpen !== false;
  const composerStops = useStopRequests();
  // A child's Host owner connects only while its panel is open or a Stop needs it;
  // children otherwise leave no sessions, queues or notices in the parent.
  const stopping = new Set([...(delegated.stopping ?? []), ...(delegated.connecting ?? [])]);
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
  // Receipts of the sends to the open child, from the authority that serves it and no other.
  const receiptTarget =
    visible && selected ? receiptAuthority(child, readHostBinding, remoteBindings) : undefined;
  const receipts = useDelegatedMessageReceipts(
    receiptTarget?.environmentId,
    receiptTarget?.sessionId,
    receiptTarget?.machineId,
  );
  // The panel reads the whole conversation; the parent's inline card keeps the latest round.
  const childBlock = useMemo(
    () => (child ? delegatedAgentBlock(child, { history: true, receipts }) : undefined),
    [child, receipts],
  );
  // A subagent's own subagents: listed at the top of its sheet, and their
  // requests answered here, so nothing waits unseen one level down.
  const nestedAgents = useDelegatedDockAgents(
    selected ? child.id : "",
    selected ? child.blocks : NO_BLOCKS,
  );
  const waitingIds = nestedAgents.flatMap((agent) =>
    agent.needsInput && agent.sessionId ? [agent.sessionId] : [],
  );
  const waiting = useSessionsSelector(
    (sessions) => sessions.filter((session) => waitingIds.includes(session.id)),
    (a, b) => a.length === b.length && a.every((entry, index) => entry === b[index]),
  );
  const owner = useNestedDelegationOwner(selected ? child.id : undefined);

  if (currentBlock) {
    const callId = currentBlock.agentRun?.workflow ? undefined : currentBlock.tool?.callId;
    return (
      <>
        {owners}
        <SubagentSheet
          block={currentBlock}
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
          relay={
            currentBlock.agentRun?.workflow
              ? undefined
              : { ...native.relay, blockedReason: native.blockedReason }
          }
        />
      </>
    );
  }
  if (!child || !childBlock) return <>{owners}</>;
  const running = !!child.busy || !!child.continuingElsewhere;
  const parentSessionId = delegationParentOf(child)?.parentSessionId;
  const nestedRequests = selected
    ? waiting.filter(canOwn).map((session) => (
        <section key={session.id} data-nested-requests={session.id}>
          <Text as="p" size="caption" tone="secondary" className="px-4 pt-2">
            {translate("Subagent: {p0}", { p0: delegatedAgentBlock(session).text })}
          </Text>
          <DelegatedSessionRequests
            child={session}
            visible={visible}
            onOpenFile={onOpenFile}
            onOpenDiff={onOpenDiff}
          />
        </section>
      ))
    : [];
  const ownRequests =
    selected && canOwn(child) ? (
      <DelegatedSessionRequests
        key={child.id}
        child={child}
        visible={visible}
        composer={{ name: childBlock.text, parentSessionId }}
        onOpenFile={onOpenFile}
        onOpenDiff={onOpenDiff}
      />
    ) : null;
  return (
    <>
      {owners}
      <SubagentSheet
        block={childBlock}
        busy={running}
        // Same child state as the dock row; a settled child never claims it waits.
        needsInput={running && sessionNeedsInput(child)}
        visible={visible && (delegated.isOpen ?? true)}
        agentRole={delegationParentOf(child)?.kind}
        nested={
          <NestedSubagentList
            agents={nestedAgents}
            onOpen={(id) => {
              const target = getSessions().find((session) => session.id === id);
              if (!target || !isDelegatedChildOf(target, child)) return false;
              delegated.open(id);
              return true;
            }}
          />
        }
        back={
          owner
            ? { name: delegatedAgentBlock(owner).text, open: () => delegated.open(owner.id) }
            : undefined
        }
        requests={
          nestedRequests.length ? (
            <>
              {nestedRequests}
              {ownRequests}
            </>
          ) : (
            (ownRequests ?? undefined)
          )
        }
        cwd={child.cwd}
        onClose={delegated.close}
        onShowInTranscript={
          // A subagent's own subagent has no row in this transcript.
          owner
            ? undefined
            : (blockId) => {
                delegated.close();
                const shown = native.showInTranscript(blockId);
                if (!shown) delegated.open(child.id);
                return shown;
              }
        }
        onStop={
          running
            ? async () => {
                await stopChild(child.id, onStopSession);
              }
            : undefined
        }
        onOpenFile={onOpenFile}
        onOpenDiff={onOpenDiff}
        composer={
          selected && !isHostChild(child, readHostBinding) ? (
            <>
              {composerStops.failed.has(child.id) ? (
                <InlineError inset="row">{translate("Could not stop this subagent.")}</InlineError>
              ) : null}
              <SubagentChatComposer
                {...localQueueActions?.(child.id)}
                key={child.id}
                name={childBlock.text}
                session={child}
                visible={visible}
                parentSessionId={parentSessionId}
                onStop={() =>
                  composerStops.request(child.id, async () => {
                    await onStopSession(child.id);
                  })
                }
                onSubmit={(text, attachments, options, admission) =>
                  onSubmitToSession(child.id, text, options ?? {}, attachments, admission)
                }
              />
            </>
          ) : undefined
        }
      />
    </>
  );
}
