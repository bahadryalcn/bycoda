import {
  HARNESS_TITLE,
  sessionDisplayTitle,
  sessionNeedsInput,
  type Block,
  type Session,
} from "../../sessions/model/session";
import { deriveActivityDock } from "../../sessions/model/activityDock";
import { isProviderFailureText } from "../../sessions/model/plan";
import type { NotificationPermission } from "./notifications";

/** The three moments that reach the user outside the window. */
export type AttentionKind = "finished" | "failed" | "input";

export type NotificationPayload = {
  /** Session a click opens. */
  sessionId: string;
  kind: AttentionKind;
  title: string;
  subtitle: string;
  body: string;
  /** Kept so a burst can name its projects and sessions. */
  projectName: string;
  sessionTitle: string;
};

const SUMMARY_MAX = 140;

/** Blocks since the user's latest prompt: the turn that just ended. */
function latestTurn(blocks: Block[]): Block[] {
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].role === "user" && !blocks[i].draft) {
      return blocks.slice(i + 1);
    }
  }
  return blocks;
}

/** Identifies the turn, so a finish announced early is not announced twice. */
export function turnKey(session: Pick<Session, "blocks">): string {
  for (let i = session.blocks.length - 1; i >= 0; i--) {
    const block = session.blocks[i];
    if (block.role === "user" && !block.draft) return block.id;
  }
  return "";
}

export type TurnOutcome = "finished" | "failed" | "interrupted";

/**
 * How the turn that just ended went. An error notice, a provider usage-limit
 * flag, or a reply that is only a limit/auth refusal is a failure; a stop the
 * user asked for is neither failure nor finish.
 */
export function turnOutcome(session: Session): TurnOutcome {
  const turn = latestTurn(session.blocks);
  const reply = lastAssistantText(turn);
  if (
    session.usageLimit ||
    turn.some((block) => block.notice === "error") ||
    isProviderFailureText(reply)
  ) {
    return "failed";
  }
  return turn.some((block) => block.notice === "interrupt") ? "interrupted" : "finished";
}

function lastAssistantText(turn: Block[]): string {
  for (let i = turn.length - 1; i >= 0; i--) {
    const block = turn[i];
    if (block.role === "assistant" && block.text.trim()) return block.text;
  }
  return "";
}

/** The last non-empty line, with list/heading markers and fences removed. */
export function lastLine(text: string, max = SUMMARY_MAX): string {
  const line =
    text
      .split(/\r?\n/)
      .map((part) =>
        part
          .replace(/^[\s>#*+-]+/, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter((part) => part && !part.startsWith("```"))
      .pop() ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function firstLine(text: string, max = SUMMARY_MAX): string {
  const line =
    text
      .split(/\r?\n/)
      .map((part) => part.replace(/\s+/g, " ").trim())
      .find(Boolean) ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export type SessionPhase = "idle" | "working" | "waiting" | "background" | "needs-input";

/** The composer dock's state for a session, without the "done" afterglow. */
export function sessionPhase(session: Session): SessionPhase {
  const { state } = deriveActivityDock({
    blocks: session.blocks,
    busy: !!session.busy,
    pendingQuestion: session.pendingQuestion != null,
    backgroundTasks: session.backgroundTasks,
    backgroundAgents: session.backgroundAgents,
    unseenDone: false,
  });
  return state === "done" ? "idle" : state;
}

/**
 * The agent finished and only background commands keep the turn open. Yielding
 * to subagents (`waiting`) is not a finish; leaving `background` is not a
 * second one.
 */
export function enteredBackgroundFinish(
  previous: SessionPhase | undefined,
  next: SessionPhase,
): boolean {
  return next === "background" && previous !== "background";
}

/** What the OS banner says for one session and moment. */
export function attentionText(
  session: Session,
  kind: AttentionKind,
  detail: { requestId?: number; projectName: string },
): Pick<NotificationPayload, "title" | "subtitle" | "body"> {
  const harness = HARNESS_TITLE[session.harness];
  const subtitle = sessionDisplayTitle(session.title, session.harness);
  const where = (label: string) => `${label} · ${detail.projectName}`;
  const turn = latestTurn(session.blocks);
  if (kind === "finished") {
    return {
      title: where("Finished"),
      subtitle,
      body: lastLine(lastAssistantText(turn)) || `${harness} finished`,
    };
  }
  if (kind === "failed") {
    const error = [...turn].reverse().find((b) => b.notice === "error");
    return {
      title: where(
        session.retryMessage && (session.busy || session.continuingElsewhere)
          ? "Retrying"
          : session.usageLimit
            ? "Usage limit reached"
            : "Failed",
      ),
      subtitle,
      body:
        firstLine(
          session.retryMessage && (session.busy || session.continuingElsewhere)
            ? session.retryMessage
            : (error?.text ?? ""),
        ) ||
        lastLine(lastAssistantText(turn)) ||
        `${harness} could not finish`,
    };
  }
  const question =
    session.pendingQuestion &&
    (detail.requestId === undefined || session.pendingQuestion.requestId === detail.requestId)
      ? session.pendingQuestion
      : undefined;
  if (question) {
    return {
      title: where("Has a question"),
      subtitle,
      body:
        firstLine(question.title || question.questions[0]?.prompt || "") ||
        `${harness} has a question for you`,
    };
  }
  const pending = session.blocks.find(
    (block) =>
      block.approval &&
      !block.approval.decided &&
      (detail.requestId === undefined || block.approval.requestId === detail.requestId),
  );
  const what = pending?.tool?.title || pending?.text;
  return {
    title: where("Needs approval"),
    subtitle,
    body: what ? `Approve: ${firstLine(what, SUMMARY_MAX - 9)}` : `${harness} needs your approval`,
  };
}

export type NotificationContext = {
  /** Master switch in Settings. */
  enabled: boolean;
  permission: NotificationPermission;
  /** Per-event toggle in Settings. */
  eventEnabled: boolean;
  /** False for a muted project or a category switched off for it. */
  projectAllowed: boolean;
  windowFocused: boolean;
  /** The session is the one on screen. */
  sessionVisible: boolean;
};

/**
 * Whether to notify at all. A banner only earns its place while the user is
 * looking elsewhere: another app (window unfocused) or another session.
 */
export function shouldNotifyFor(context: NotificationContext): boolean {
  if (!context.enabled || !context.eventEnabled || !context.projectAllowed) {
    return false;
  }
  if (context.windowFocused && context.sessionVisible) return false;
  return context.permission === "granted" || context.permission === "prompt";
}

export const LOCKED_NOTIFICATION_TEXT = "A session in a locked group needs attention";

/** The same notification with nothing that names the project or the session. */
export function maskLockedNotification(payload: NotificationPayload): NotificationPayload {
  return {
    ...payload,
    title: LOCKED_NOTIFICATION_TEXT,
    subtitle: "",
    body: "",
    projectName: "Locked group",
    sessionTitle: "Locked session",
  };
}

/** Decision and text in one: null means stay quiet. */
export function decideNotification(
  session: Session,
  kind: AttentionKind,
  detail: { requestId?: number; projectName: string },
  context: NotificationContext,
): NotificationPayload | null {
  if (!shouldNotifyFor(context)) return null;
  return {
    sessionId: session.id,
    kind,
    ...attentionText(session, kind, detail),
    projectName: detail.projectName,
    sessionTitle: sessionDisplayTitle(session.title, session.harness),
  };
}

const URGENCY: Record<AttentionKind, number> = {
  input: 3,
  failed: 2,
  finished: 1,
};

/** One entry per session: the more urgent wins, the later one on a tie. */
export function dedupeBySession(items: NotificationPayload[]): NotificationPayload[] {
  const bySession = new Map<string, NotificationPayload>();
  for (const item of items) {
    const kept = bySession.get(item.sessionId);
    if (!kept || URGENCY[item.kind] >= URGENCY[kept.kind]) {
      bySession.set(item.sessionId, item);
    }
  }
  return [...bySession.values()];
}

/** A burst becomes one notification that counts what happened. */
export function coalesceNotifications(items: NotificationPayload[]): NotificationPayload {
  const unique = dedupeBySession(items);
  const urgent = unique.reduce((best, item) =>
    URGENCY[item.kind] > URGENCY[best.kind] ? item : best,
  );
  if (unique.length === 1) return urgent;
  const kinds = new Set(unique.map((item) => item.kind));
  const count = unique.length;
  const title =
    kinds.size > 1
      ? `${count} sessions need attention`
      : urgent.kind === "finished"
        ? `${count} sessions finished`
        : urgent.kind === "failed"
          ? `${count} sessions failed`
          : `${count} sessions need you`;
  const projects = [...new Set(unique.map((item) => item.projectName))];
  const shown = unique.slice(0, 3).map((item) => item.sessionTitle);
  const more = unique.length - shown.length;
  return {
    sessionId: urgent.sessionId,
    kind: urgent.kind,
    title,
    subtitle:
      projects.slice(0, 3).join(", ") + (projects.length > 3 ? `, +${projects.length - 3}` : ""),
    body: shown.join(" · ") + (more > 0 ? ` · +${more} more` : ""),
    projectName: urgent.projectName,
    sessionTitle: urgent.sessionTitle,
  };
}

export type NotificationBatcher = {
  /** Resolves true once the coalesced notification was accepted. */
  enqueue(payload: NotificationPayload): Promise<boolean>;
};

/**
 * Holds notifications for `delay()` ms after the first, then delivers them as
 * one. Every caller learns whether its notification went out.
 */
export function createNotificationBatcher(
  deliver: (payload: NotificationPayload) => Promise<boolean>,
  delay: () => number,
): NotificationBatcher {
  let items: NotificationPayload[] = [];
  let waiters: Array<(sent: boolean) => void> = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    const batch = items;
    const done = waiters;
    items = [];
    waiters = [];
    timer = undefined;
    deliver(coalesceNotifications(batch)).then(
      (sent) => done.forEach((resolve) => resolve(sent)),
      () => done.forEach((resolve) => resolve(false)),
    );
  };
  return {
    enqueue(payload) {
      items.push(payload);
      const result = new Promise<boolean>((resolve) => waiters.push(resolve));
      timer ??= setTimeout(flush, delay());
      return result;
    },
  };
}

/** Sessions with unseen finished/failed turns, minus the ones now in view. */
export function pruneUnseen(
  unseen: ReadonlySet<string>,
  sessions: readonly Session[],
  activeSessionId: string | undefined,
  windowFocused: boolean,
): Set<string> {
  const live = new Set(sessions.map((session) => session.id));
  return new Set(
    [...unseen].filter((id) => live.has(id) && !(windowFocused && id === activeSessionId)),
  );
}

export type TaskbarAttention = {
  count: number;
  /** At least one session is waiting on an approval or question. */
  hasInput: boolean;
};

/**
 * Sessions that want the user: pending input (whose project allows it) plus
 * unseen finished/failed turns. The session in view in a focused window never
 * counts, so looking at it clears it.
 */
export function taskbarAttention(
  sessions: readonly Session[],
  unseen: ReadonlySet<string>,
  activeSessionId: string | undefined,
  windowFocused: boolean,
  inputAllowed: (session: Session) => boolean,
): TaskbarAttention {
  let count = 0;
  let hasInput = false;
  for (const session of sessions) {
    if (session.inboxAsk) continue;
    if (windowFocused && session.id === activeSessionId) continue;
    const input = sessionNeedsInput(session) && inputAllowed(session);
    if (input) hasInput = true;
    if (input || unseen.has(session.id)) count++;
  }
  return { count, hasInput };
}

export type FlashRequest = "none" | "info" | "critical";

/** Flash only when the count grew while the user was elsewhere. */
export function flashFor(
  previousCount: number,
  next: TaskbarAttention,
  windowFocused: boolean,
): FlashRequest {
  if (windowFocused || next.count <= previousCount) return "none";
  return next.hasInput ? "critical" : "info";
}
