import { useSyncExternalStore } from "react";
import { t } from "../../../shared/i18n";
import { isRunningCompaction } from "./compactionStatus";
import type { Block } from "./session";
import { sessionRetryNotice } from "./sessionIssue";
import { isStartupStatusBlock } from "./startupStatus";
import { isHiddenTool, isThinkingBlock, isToolBlock, toolCallState } from "./transcriptActivity";

/**
 * What a running turn is doing while the transcript has nothing to show for
 * it. Every phase comes from state the client already holds; none is guessed:
 * - `preparing`: the app is still starting the send (`session.worktreePreparing`).
 * - `starting`: a start-up status row ("Starting your message…", "Starting Claude…").
 * - `retrying` / `reconnecting`: the provider reported a retry (`session.retryMessage`).
 * - `waiting`: the turn was sent and the provider has not answered at all yet.
 * - `thinking`: the provider answered (turn started, reasoning arrived) but
 *   nothing readable has streamed, or only private reasoning has.
 * - `working`: only provider-internal (hidden) calls are running.
 */
export type TurnActivityPhase =
  | "preparing"
  | "starting"
  | "retrying"
  | "reconnecting"
  | "waiting"
  | "thinking"
  | "working";

export type TurnActivity = {
  phase: TurnActivityPhase;
  label: string;
  /**
   * The turn already shows output; the line only appears once it has been
   * silent for a while, and then counts the silence rather than the turn.
   */
  afterSilence: boolean;
};

export type TurnActivityInput = {
  /** The live turn's blocks, user prompt first. */
  turn: readonly Block[];
  /** The provider has answered this run at least once (its clock started). */
  responded: boolean;
  /** Display name of the provider running the turn. */
  provider?: string;
  retryMessage?: string;
  /** The app is still starting the send (lease, workspace, usage checks). */
  preparing?: boolean;
  /** An approval, a question or background work already says what the turn waits on. */
  waiting?: boolean;
};

/** The live phase for the turn's activity line, or null when visible rows already say it. */
export function deriveTurnActivity({
  turn,
  responded,
  provider,
  retryMessage,
  preparing = false,
  waiting = false,
}: TurnActivityInput): TurnActivity | null {
  if (waiting) return null;
  for (let index = turn.length - 1; index >= 0; index -= 1) {
    const block = turn[index];
    const text = isStartupStatusBlock(block) ? block.text.trim() : "";
    if (text) return { phase: "starting", label: text, afterSilence: false };
  }
  if (preparing) {
    return { phase: "preparing", label: t("Starting your message…"), afterSilence: false };
  }
  if (retryMessage?.trim()) {
    const reconnecting = sessionRetryNotice(retryMessage).reconnecting;
    if (reconnecting) {
      return {
        phase: "reconnecting",
        label: provider ? t("Reconnecting to {p0}", { p0: provider }) : t("Reconnecting…"),
        afterSilence: false,
      };
    }
    return {
      phase: "retrying",
      label: provider ? t("{p0} is retrying", { p0: provider }) : t("Working…"),
      afterSilence: false,
    };
  }

  let output = false;
  let onlyThinking = true;
  let visiblyRunning = false;
  let hiddenRunning = false;
  for (const block of turn) {
    if (block.role === "user" || block.role === "handoff") continue;
    if (block.role === "system") {
      // Status rows are not output, except a compaction that is still running:
      // its own row carries the spinner and the clock.
      if (isRunningCompaction(block)) visiblyRunning = true;
      continue;
    }
    if (isHiddenTool(block)) {
      if (toolCallState(block) === "pending") hiddenRunning = true;
      continue;
    }
    if ((block.role === "assistant" || block.role === "reasoning") && !block.text.trim()) continue;
    output = true;
    if (!isThinkingBlock(block)) onlyThinking = false;
    // A running call (or subagent) has its own live row.
    if (isToolBlock(block) && toolCallState(block) === "pending") visiblyRunning = true;
  }

  if (visiblyRunning) return null;
  if (!output) {
    if (hiddenRunning) return { phase: "working", label: t("Working…"), afterSilence: false };
    return responded
      ? { phase: "thinking", label: t("Thinking…"), afterSilence: false }
      : provider
        ? { phase: "waiting", label: t("Waiting for {p0}…", { p0: provider }), afterSilence: false }
        : { phase: "waiting", label: t("Working…"), afterSilence: false };
  }
  // Private reasoning only: the line stands in for it until the answer starts.
  if (onlyThinking) return { phase: "thinking", label: t("Thinking…"), afterSilence: false };
  return hiddenRunning
    ? { phase: "working", label: t("Working…"), afterSilence: true }
    : { phase: "thinking", label: t("Thinking…"), afterSilence: true };
}

/**
 * When each running turn was first seen here, so its clock counts from the
 * send rather than from the provider's first answer. Bounded: only the last
 * few turns can still be running.
 */
const firstSeen = new Map<string, number>();
const FIRST_SEEN_LIMIT = 64;

/**
 * The epoch ms a running turn's clock counts from: the earlier of when the
 * provider started it and when this window first saw it. A finished owner
 * block (it has a duration) means the next run's prompt has not landed yet, so
 * its old start is not this run's.
 */
export function turnClockOrigin(owner: Block | undefined): number | undefined {
  if (!owner) return undefined;
  const finished = owner.durationMs != null;
  const key = finished ? `${owner.id}:next` : owner.id;
  let seen = firstSeen.get(key);
  if (seen === undefined) {
    seen = Date.now();
    firstSeen.set(key, seen);
    if (firstSeen.size > FIRST_SEEN_LIMIT) {
      const oldest = firstSeen.keys().next().value;
      if (oldest !== undefined) firstSeen.delete(oldest);
    }
  }
  const startedAt = finished ? undefined : owner.startedAt;
  return startedAt === undefined ? seen : Math.min(seen, startedAt);
}

/**
 * Sessions whose transcript currently shows the running turn's clock on its
 * activity line. The composer's activity dock leaves its own clock out then,
 * so the same number never ticks in two places.
 */
const clockClaims = new Map<string, number>();
const clockListeners = new Set<() => void>();

function subscribeClockClaims(listener: () => void): () => void {
  clockListeners.add(listener);
  return () => {
    clockListeners.delete(listener);
  };
}

/** Claims the turn clock for `sessionId`; the returned function releases it. */
export function claimTurnClock(sessionId: string): () => void {
  clockClaims.set(sessionId, (clockClaims.get(sessionId) ?? 0) + 1);
  clockListeners.forEach((notify) => notify());
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = (clockClaims.get(sessionId) ?? 1) - 1;
    if (left > 0) clockClaims.set(sessionId, left);
    else clockClaims.delete(sessionId);
    clockListeners.forEach((notify) => notify());
  };
}

export function useTurnClockInTranscript(sessionId: string): boolean {
  return useSyncExternalStore(
    subscribeClockClaims,
    () => (clockClaims.get(sessionId) ?? 0) > 0,
    () => false,
  );
}
