import type { ReactNode } from "react";
import { LiveBackgroundLayer } from "../../settings/public/LiveBackgroundCanvas";
import { useDelegatedCardBlocks } from "../model/reactiveReads";
import type { Block, Session } from "../model/session";
import { usePaneSession, usePaneSessionBlocks } from "../model/sessionsStore";
import { DelegatedRunOwner } from "./SubagentCards";

/**
 * The live blocks of a session, for the parts of a pane that follow streamed
 * text. The pane itself renders from a session that ignores that text, so only
 * this component re-renders on a frame. While `enabled` is off it renders
 * `fallback` and does not subscribe.
 */
export function LiveSessionBlocks({
  sessionId,
  visible,
  enabled,
  fallback,
  delegatedCards = false,
  children,
}: {
  sessionId: string;
  visible: boolean;
  enabled: boolean;
  fallback: Block[];
  /** The transcript shows this session's delegated runs as cards. */
  delegatedCards?: boolean;
  children: (blocks: Block[]) => ReactNode;
}) {
  const live = usePaneSessionBlocks(sessionId, visible, enabled) ?? fallback;
  const blocks = useDelegatedCardBlocks(sessionId, live, delegatedCards);
  return delegatedCards ? (
    <DelegatedRunOwner.Provider value={sessionId}>{children(blocks)}</DelegatedRunOwner.Provider>
  ) : (
    <>{children(blocks)}</>
  );
}

/** The animated chat background, driven by the streamed text of the live session. */
export function LiveSessionBackground({
  sessionId,
  fallback,
  follow,
  active,
  visible,
}: {
  sessionId: string;
  fallback: Session;
  /** False for a remote session, whose current state is `fallback`. */
  follow: boolean;
  active: boolean;
  visible: boolean;
}) {
  const live = usePaneSession(sessionId, visible);
  const session = follow ? (live ?? fallback) : fallback;
  return (
    <LiveBackgroundLayer
      active={active}
      visible={visible}
      speech={streamingReplyLength(session)}
      activity={liveTurnActivity(session)}
    />
  );
}

/** Length of the assistant reply currently streaming, or -1 when none is. */
export function streamingReplyLength(session: Session): number {
  const last = session.blocks[session.blocks.length - 1];
  return session.busy && last?.role === "assistant" && last.streaming ? last.text.length : -1;
}

/**
 * Everything the running turn has streamed since the latest user message:
 * reply, reasoning and tool progress. Each step also counts as a short burst,
 * so the live background reacts to tool calls that stream no text. -1 when idle.
 */
function liveTurnActivity(session: Session): number {
  if (!session.busy) return -1;
  let length = 0;
  for (let i = session.blocks.length - 1; i >= 0; i--) {
    const block = session.blocks[i];
    if (block.role === "user") break;
    length += 12 + block.text.length + (block.tool?.detail?.length ?? 0);
  }
  return length;
}
