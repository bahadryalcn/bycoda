import { subscribePreferenceChanges } from "../../../shared/lib/storedSetting";
import { invoke } from "@tauri-apps/api/core";
import { projectName } from "../../../shared/lib/paths";
import type { Session } from "../../sessions/model/session";
import { loadSoundsEnabled, playCue } from "../../settings/model/sounds";
import { isProjectLocked } from "../../group-lock/model/groupLock";
import {
  attentionText,
  createNotificationBatcher,
  decideNotification,
  maskLockedNotification,
  turnKey,
  turnOutcome,
  type AttentionKind,
  type NotificationPayload,
} from "./attention";
import { loadNotificationEvents } from "./notificationEvents";
import { allowsProjectNotification, type NotificationSubject } from "./notificationPreferences";
import { knownNotificationProject } from "./notificationProjects";

const KEY = "bycoda.notifications";

/** Off until the user opts in; enabling asks the OS for permission. */
export const NOTIFICATIONS_DEFAULT = false;

export const NOTIFICATIONS_CHANGE_EVENT = "bycoda:notifications-change";
export const subscribeNotificationsEnabled = (onChange: () => void) => subscribePreferenceChanges([KEY], NOTIFICATIONS_CHANGE_EVENT, onChange);

/** Rust emits this with the session id when a notification is clicked. */
export const NOTIFICATION_CLICK_EVENT = "bycoda:notification-click";

export type NotificationPermission = "prompt" | "granted" | "denied" | "unsupported";

export function loadNotificationsEnabled(): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw == null) return NOTIFICATIONS_DEFAULT;
    return raw === "1" || raw === "true";
  } catch {
    return NOTIFICATIONS_DEFAULT;
  }
}

export function saveNotificationsEnabled(value: boolean) {
  try {
    localStorage.setItem(KEY, value ? "1" : "0");
  } catch {
    // private mode / quota
  }
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<boolean>(NOTIFICATIONS_CHANGE_EVENT, { detail: value }));
}

let permission: NotificationPermission = "prompt";

/** Last permission the OS reported; refreshed by the probes below. */
export function cachedNotificationPermission(): NotificationPermission {
  return permission;
}

export async function probeNotificationPermission(): Promise<NotificationPermission> {
  try {
    permission = await invoke<NotificationPermission>("notification_permission");
  } catch {
    permission = "unsupported";
  }
  return permission;
}

/** Shows the OS prompt when undecided; otherwise reports the current state. */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  try {
    permission = await invoke<NotificationPermission>("request_notification_permission");
  } catch {
    permission = "unsupported";
  }
  return permission;
}

export function openNotificationSettings(): Promise<void> {
  return invoke<void>("open_notification_settings");
}

/**
 * Tracked from Tauri's focus event rather than `document.hasFocus()`, which
 * WKWebView keeps reporting true after the window drops to the background.
 */
let windowFocused = typeof document !== "undefined" ? document.hasFocus() : true;

export function setWindowFocused(focused: boolean) {
  windowFocused = focused;
  for (const listener of attentionListeners) listener();
}

export function isWindowFocused(): boolean {
  return windowFocused;
}

/** Sessions whose finish or failure was announced and not yet looked at. */
const unseenAttention = new Set<string>();
const attentionListeners = new Set<() => void>();

export function unseenAttentionSessions(): ReadonlySet<string> {
  return unseenAttention;
}

export function replaceUnseenAttention(next: ReadonlySet<string>) {
  if (next.size === unseenAttention.size && [...next].every((id) => unseenAttention.has(id))) {
    return;
  }
  unseenAttention.clear();
  for (const id of next) unseenAttention.add(id);
}

/** Notified when focus or the unseen set changes, so the taskbar can follow. */
export function subscribeAttention(listener: () => void): () => void {
  attentionListeners.add(listener);
  return () => attentionListeners.delete(listener);
}

function markUnseen(sessionId: string) {
  unseenAttention.add(sessionId);
  for (const listener of attentionListeners) listener();
}

/**
 * A banner only earns its place while the user is looking elsewhere: another
 * app, or another session. The transcript already shows the change on the
 * session that is on screen.
 */
export function shouldNotify({
  enabled,
  permission,
  windowFocused,
  sessionVisible,
}: {
  enabled: boolean;
  permission: NotificationPermission;
  windowFocused: boolean;
  sessionVisible: boolean;
}): boolean {
  if (!enabled || (windowFocused && sessionVisible)) return false;
  return permission === "granted" || permission === "prompt";
}

export type InputNotificationEvent = {
  kind: "approval" | "question";
  requestId: number;
};
export type NotificationEvent = "finished" | "failed" | InputNotificationEvent;

type PendingInputNotification = {
  session: Session;
  event: InputNotificationEvent;
};

/** Track each request, including a new request in an already-waiting session. */
export function pendingInputNotifications(
  sessions: Session[],
): Map<string, PendingInputNotification> {
  const pending = new Map<string, PendingInputNotification>();
  for (const session of sessions) {
    if (session.inboxAsk) continue;
    for (const block of session.blocks) {
      if (block.approval && !block.approval.decided) {
        pending.set(JSON.stringify([session.id, "approval", block.approval.requestId]), {
          session,
          event: { kind: "approval", requestId: block.approval.requestId },
        });
      }
    }
    if (session.pendingQuestion) {
      pending.set(JSON.stringify([session.id, "question", session.pendingQuestion.requestId]), {
        session,
        event: {
          kind: "question",
          requestId: session.pendingQuestion.requestId,
        },
      });
    }
  }
  return pending;
}

/** App name, then the session title, then the reply itself. */
export type NotificationText = {
  title: string;
  subtitle: string;
  body: string;
};

export function notificationText(session: Session, event: NotificationEvent): NotificationText {
  return attentionText(session, attentionKind(event), {
    requestId: typeof event === "string" ? undefined : event.requestId,
    projectName: notificationProjectName(session),
  });
}

function attentionKind(event: NotificationEvent): AttentionKind {
  return typeof event === "string" ? event : "input";
}

function notificationProjectName(session: Session): string {
  return knownNotificationProject(session.cwd)?.name ?? projectName(session.cwd);
}

const EVENT_CATEGORY = {
  finished: "agentFinished",
  failed: "agentFailed",
  input: "agentInput",
} as const;

/** Bursts within this window leave as one notification. */
let batchDelayMs = 800;

export function setNotificationBatchDelay(ms: number) {
  batchDelayMs = ms;
}

const batcher = createNotificationBatcher(deliver, () => batchDelayMs);

async function deliver(payload: NotificationPayload): Promise<boolean> {
  try {
    await invoke("show_notification", {
      sessionId: payload.sessionId,
      title: payload.title,
      subtitle: payload.subtitle,
      body: payload.body,
      sound: loadSoundsEnabled(),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Sends the banner when policy allows. Resolves true once the OS accepted it
 * so callers can skip the in-app cue: the OS sound stands in for it. A
 * rejected dispatch resolves false so the cue still plays.
 */
export async function notifySession(
  session: Session,
  event: NotificationEvent,
  sessionVisible: boolean,
): Promise<boolean> {
  if (session.inboxAsk) return false;
  const occurredAt = Date.now();
  const project = knownNotificationProject(session.cwd);
  if (!project) return false;
  return notifyProjectSession(session, event, sessionVisible, {
    projectId: project.id,
    category: EVENT_CATEGORY[attentionKind(event)],
    occurredAt,
  });
}

/** Click targets of background work notifications, sent in place of a session
 * ID. A click on one opens that view instead of a session. */
export const BACKGROUND_NOTIFICATION_TARGETS = {
  tasks: "background:tasks",
  automations: "background:automations",
  summary: "background:summary",
} as const;

/** The daily summary of background work. The global switch applies; it has no
 * event setting of its own beyond the summary's own toggle. */
export async function notifyDailySummary(headline: string): Promise<boolean> {
  if (
    !shouldNotify({
      enabled: loadNotificationsEnabled(),
      permission,
      windowFocused,
      sessionVisible: false,
    })
  )
    return false;
  return deliver({
    sessionId: BACKGROUND_NOTIFICATION_TARGETS.summary,
    kind: "finished",
    title: "Daily summary",
    subtitle: "",
    body: headline,
    projectName: "",
    sessionTitle: "",
  });
}

/**
 * A task or background automation on some machine changed in a way the owner
 * should hear about. Sent whether or not the window is focused, since no view
 * shows it unasked; the global switch and the event's own setting still apply.
 */
export async function notifyBackground(transition: {
  target: Exclude<keyof typeof BACKGROUND_NOTIFICATION_TARGETS, "summary">;
  kind: AttentionKind;
  message: string;
}): Promise<boolean> {
  if (
    !shouldNotify({
      enabled: loadNotificationsEnabled() && loadNotificationEvents()[transition.kind],
      permission,
      windowFocused,
      sessionVisible: false,
    })
  )
    return false;
  return deliver({
    sessionId: BACKGROUND_NOTIFICATION_TARGETS[transition.target],
    kind: transition.kind,
    title: transition.message,
    subtitle: "",
    body: transition.target === "tasks" ? "Background task" : "Background automation",
    projectName: "",
    sessionTitle: "",
  });
}

/** Turns announced while their background commands still ran, by turn. */
const announcedEarly = new Map<string, string>();

/**
 * The agent is done and only background commands keep the turn open. Announced
 * once per turn; the eventual turn end then stays quiet.
 */
export async function announceBackgroundFinish(
  session: Session,
  sessionVisible: boolean,
): Promise<void> {
  const key = turnKey(session);
  if (announcedEarly.get(session.id) === key) return;
  announcedEarly.set(session.id, key);
  await announceFinished(session, sessionVisible);
}

/**
 * Called when a turn ends. One policy decision covers both the OS banner and
 * its in-app sound fallback. A failure or usage limit gets its own banner; a
 * stop the user asked for gets none.
 */
const announcedIssues = new Map<string, string>();

export async function announceSessionIssue(
  session: Session,
  issue: "retrying" | "failed",
  _sessionVisible: boolean,
): Promise<void> {
  const key = `${turnKey(session)}:${issue}`;
  if (announcedIssues.get(session.id) === key) return;
  if (announcedIssues.size >= 1000) announcedIssues.delete(announcedIssues.keys().next().value!);
  announcedIssues.set(session.id, key);
  await notifySession(session, "failed", false);
}

export async function announceSessionFinished(
  session: Session,
  sessionVisible: boolean,
): Promise<void> {
  if (session.inboxAsk) return;
  const outcome = turnOutcome(session);
  const early = announcedEarly.get(session.id) === turnKey(session);
  announcedEarly.delete(session.id);
  if (outcome === "interrupted") return;
  if (outcome === "failed") {
    await announceSessionIssue(session, "failed", sessionVisible);
    return;
  }
  if (!early) await announceFinished(session, sessionVisible);
}

async function announceFinished(session: Session, sessionVisible: boolean): Promise<void> {
  if (session.inboxAsk) return;
  const occurredAt = Date.now();
  const project = knownNotificationProject(session.cwd);
  if (!project) return;
  const subject: NotificationSubject = {
    projectId: project.id,
    category: "agentFinished",
    occurredAt,
  };
  const sent = await notifyProjectSession(session, "finished", sessionVisible, subject);
  if (!sent) playCue("turnFinished", subject);
}

async function notifyProjectSession(
  session: Session,
  event: NotificationEvent,
  sessionVisible: boolean,
  subject: NotificationSubject,
): Promise<boolean> {
  const kind = attentionKind(event);
  const payload = decideNotification(
    session,
    kind,
    {
      requestId: typeof event === "string" ? undefined : event.requestId,
      projectName: notificationProjectName(session),
    },
    {
      enabled: loadNotificationsEnabled(),
      permission,
      eventEnabled: loadNotificationEvents()[kind],
      projectAllowed: allowsProjectNotification(subject),
      windowFocused,
      sessionVisible,
    },
  );
  if (!payload) return false;
  if (kind !== "input") markUnseen(session.id);
  return batcher.enqueue(isProjectLocked(session.cwd) ? maskLockedNotification(payload) : payload);
}
