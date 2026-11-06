import { useCallback, useEffect, useMemo, useState } from "react";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import type { DockAgent } from "../model/activityDock";
import { delegatedAgentBlock } from "../model/delegatedAgents";
import { useDelegatedDockAgents } from "../model/reactiveReads";
import type { Block, ComposerTurnOptions } from "../model/session";
import { useSession } from "../model/sessionsStore";
import { localReferenceForSession } from "../model/localSessionNavigation";
import { useLocalSessionReferenceNavigation } from "./LocalSessionReferenceContext";
import { requestViewSubagent } from "./subagentFocus";
import { useDelegatedMessage } from "./useDelegatedMessage";
import { SubagentSheet, type SubagentRelay } from "./SubagentSheet";

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
  const agents = useDelegatedDockAgents(sessionId, blocks);
  const open = useCallback(
    (id: string) => {
      closeNative();
      setChildId(id);
    },
    [closeNative],
  );
  const close = useCallback(() => setChildId(undefined), []);
  const stop = useCallback(
    async (id: string) => {
      await onStopSession(id);
    },
    [onStopSession],
  );
  /** Ends the running children; their own sessions then report cancelled. */
  const stopRunning = useCallback(async () => {
    await Promise.all(
      agents
        .filter((agent) => agent.sessionId && agent.status === "running")
        .map((agent) => stop(agent.sessionId!)),
    );
  }, [agents, stop]);
  return { childId, open, close, agents, stop, stopRunning };
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
  const navigation = useLocalSessionReferenceNavigation();
  // Keyed by child, so another child's sheet never shows a stale error.
  const [openFailure, setOpenFailure] = useState<{ childId?: string; message: string }>();
  const openError =
    openFailure && openFailure.childId === delegated.childId ? openFailure.message : undefined;
  const childBlock = useMemo(() => (child ? delegatedAgentBlock(child) : undefined), [child]);
  const message = useDelegatedMessage({
    childSessionId: child?.id,
    blocked: !child,
    onSubmit: (text, options) => onSubmitToSession(child?.id ?? "", text, options),
  });

  if (native.block) {
    const callId = native.block.tool?.callId;
    return (
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
    );
  }
  if (!child || !childBlock) return null;
  const running = !!child.busy || !!child.continuingElsewhere;
  return (
    <SubagentSheet
      block={childBlock}
      busy={running}
      visible={visible}
      cwd={child.cwd}
      onClose={delegated.close}
      onStop={
        running
          ? async () => {
              await onStopSession(child.id);
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
        openError,
        ...(navigation
          ? {
              onOpenConversation: () => {
                setOpenFailure(undefined);
                void localReferenceForSession(child)
                  .then((locator) => navigation.open({ locator }))
                  .then(delegated.close)
                  .catch((cause: unknown) =>
                    setOpenFailure({
                      childId: child.id,
                      message: cause instanceof Error ? cause.message : String(cause),
                    }),
                  );
              },
            }
          : {}),
      }}
    />
  );
}
