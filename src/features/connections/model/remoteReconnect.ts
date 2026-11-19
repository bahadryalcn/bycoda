import {
  isMachineEnabled,
  startNativeDisabledMachinesSync,
  subscribeMachineTurnedOff,
} from "./machineEnabled";
import { closeTurnedOffMachine } from "./machineTurnOff";
import { isMachineFocused, subscribeMachineFocused } from "./machineFocus";
import { elapsedSince, monotonicNow } from "../../../shared/lib/time/timestamps";
import { withTimeout } from "../../../shared/lib/withTimeout";
import {
  knownRemoteMachine,
  recordRemoteCapabilities,
  remoteMachineFor,
  remoteRequest,
  requestMachineReconnect,
} from "./connections";
import {
  loadRemoteAutoReconnect,
  subscribeRemoteAutoReconnect,
} from "../../settings/public/settings";
import {
  AUTO_RETRY_STABLE_MS,
  autoRetryDelay,
  blocksSending,
  connectionOutcome,
  localizeConnectionReason,
  needsSignIn,
  shouldAutoRetry,
  shouldRetryBlocked,
  type ReconnectOutcome,
} from "./remoteConnection";
import { t } from "../../../shared/i18n";
import { presentRemoteError } from "./remoteFailure";
import { watchTunnelExits } from "./remoteTunnelEvents";
import {
  beginConnectionAttempt,
  invalidateConnection,
  isCurrentConnectionAttempt,
  pauseConnectionRecovery,
  recordFeatureHealth,
  resumeConnectionRecovery,
  setConnectionPhase,
  setConnectionRetry,
  subscribeConnectionInvalidated,
  SUPERSEDED_CONNECTION,
} from "./remoteLifecycle";
import {
  listRemoteConnections,
  forgetRemoteConnection,
  notifyRemoteRecovered,
  readRemoteConnection,
  recordRemoteConnection,
  subscribeChanges,
} from "./remoteHealth";

/** Reconnecting a machine, by the user or in the background. Both ask the
 * machine to describe itself: the desktop restarts a dropped SSH tunnel for
 * that request, with the saved key and without any prompt. */

const attempts = new Map<
  string,
  {
    promise: Promise<ReconnectOutcome>;
    token: { generation: number; attempt: number };
  }
>();
const reconnecting = new Set<string>();
/** When each machine's latest attempt began, for any reason. Focus re-checks wait on it. */
const lastAttemptAt = new Map<string, number>();
/** Machines whose reconnect the user asked for; background retries are not in it. */
const requested = new Set<string>();
const reconnectListeners = new Set<() => void>();

/** Any attempt is under way, including a quiet background retry. */
export const isReconnecting = (environmentId: string) => reconnecting.has(environmentId);
/** A reconnect the user asked for is under way. Only this shows progress in
 * project rows and recovery cards; background retries stay quiet there. */
export const isReconnectRequested = (environmentId: string) => requested.has(environmentId);

export function subscribeReconnecting(listener: () => void): () => void {
  reconnectListeners.add(listener);
  return () => reconnectListeners.delete(listener);
}

function setReconnecting(environmentId: string, value: boolean) {
  if (value === reconnecting.has(environmentId)) return;
  if (value) reconnecting.add(environmentId);
  else {
    reconnecting.delete(environmentId);
    requested.delete(environmentId);
  }
  reconnectListeners.forEach((listener) => listener());
}

function setRequested(environmentId: string, value: boolean) {
  if (value === requested.has(environmentId)) return;
  if (value) requested.add(environmentId);
  else requested.delete(environmentId);
  reconnectListeners.forEach((listener) => listener());
}

/** Why this attempt failed, in the user's language: its own reason, never an older one. */
function reconnectFailureReason(reason: unknown): string {
  const outcome = connectionOutcome(reason);
  if (outcome.status && outcome.status !== "connected" && outcome.error)
    return localizeConnectionReason(outcome.error);
  return presentRemoteError(reason, { explicit: true });
}

/** Longest wait for one reconnect's describe. Past it the attempt fails and the
 * backoff schedules the next one; a late answer to the old request is ignored. */
export const RECONNECT_DESCRIBE_TIMEOUT_MS = 30_000;

/** One quiet attempt: never prompts. `fresh` skips the desktop's short memory
 * of a just-failed attempt. Attempts for one machine share a single request. */
function attempt(environmentId: string, fresh: boolean): Promise<ReconnectOutcome> {
  const running = attempts.get(environmentId);
  if (running && isCurrentConnectionAttempt(environmentId, running.token)) return running.promise;
  const token = beginConnectionAttempt(environmentId);
  const startedAt = monotonicNow();
  lastAttemptAt.set(environmentId, startedAt);
  setReconnecting(environmentId, true);
  let unregistered = false;
  const run = (async (): Promise<ReconnectOutcome> => {
    let lookupFailed = false;
    const machine = await remoteMachineFor(environmentId).catch(() => {
      // A failed lookup is not proof the machine is gone; keep its health for the next attempt.
      lookupFailed = true;
      return undefined;
    });
    if (!isCurrentConnectionAttempt(environmentId, token))
      return { ok: false, error: SUPERSEDED_CONNECTION };
    if (!machine && lookupFailed) {
      setConnectionPhase(environmentId, "failed");
      return { ok: false, error: t("Couldn’t read this machine’s connection settings.") };
    }
    if (!machine) {
      // An unregistered machine can never answer: no outage to retry or Reconnect from.
      unregistered = true;
      setConnectionPhase(environmentId, "failed");
      return { ok: false, error: t("This machine is not connected on this computer.") };
    }
    try {
      const host = await withTimeout(
        remoteRequest<{ capabilities?: unknown }>(machine.id, "environment.describe", {}, fresh),
        RECONNECT_DESCRIBE_TIMEOUT_MS,
        "Machine reconnect",
      );
      if (!isCurrentConnectionAttempt(environmentId, token))
        return { ok: false, error: SUPERSEDED_CONNECTION };
      recordRemoteCapabilities(environmentId, host?.capabilities);
      recordFeatureHealth(environmentId, "host", true);
      setConnectionPhase(environmentId, "restoring");
      // Views that gave up on the machine reload now.
      notifyRemoteRecovered(environmentId);
      setConnectionPhase(environmentId, "ready");
      return { ok: true };
    } catch (reason) {
      if (!isCurrentConnectionAttempt(environmentId, token))
        return { ok: false, error: SUPERSEDED_CONNECTION };
      // `startedAt` lets a deadline expiry count toward "unreachable" like any other timeout.
      recordRemoteConnection(environmentId, reason, { startedAt });
      recordFeatureHealth(environmentId, "host", false);
      const status = readRemoteConnection(environmentId).status;
      setConnectionPhase(environmentId, needsSignIn(status) ? "waiting" : "failed", status);
      return { ok: false, error: reconnectFailureReason(reason) };
    }
  })().finally(() => {
    if (attempts.get(environmentId)?.promise !== run) return;
    attempts.delete(environmentId);
    setReconnecting(environmentId, false);
    if (unregistered) forgetRemoteConnection(environmentId);
    if (stopRecovery) schedule();
  });
  attempts.set(environmentId, { promise: run, token });
  return run;
}

/** Reconnects a machine for the user. When SSH needs a password, passphrase or
 * host-key decision, `signIn` hands over to Connections settings, which is
 * where those are answered. */
export async function reconnectRemoteMachine(
  environmentId: string,
  options: { signIn?: boolean } = {},
): Promise<ReconnectOutcome> {
  clearPause(environmentId);
  setRequested(environmentId, true);
  const pending = attempt(environmentId, true);
  // An attempt that replaced this one keeps the mark until it ends too.
  const result = await pending.finally(() => {
    if (!attempts.has(environmentId)) setRequested(environmentId, false);
  });
  if (
    !result.ok &&
    result.error !== SUPERSEDED_CONNECTION &&
    options.signIn &&
    needsSignIn(readRemoteConnection(environmentId).status)
  ) {
    const machine = knownRemoteMachine(environmentId);
    if (machine?.ssh) requestMachineReconnect(machine.id);
  }
  return result;
}

/** Cancels ownership of a quiet recovery, never an existing remote workload. */
export function cancelRemoteReconnect(environmentId: string) {
  invalidateConnection(environmentId);
  pauseConnectionRecovery(environmentId);
  paused.add(environmentId);
  // A pause outlives a bad moment, not the machine's absence: automatic recovery resumes by itself.
  clearTimeout(pauseTimers.get(environmentId));
  pauseTimers.set(
    environmentId,
    setTimeout(() => {
      pauseTimers.delete(environmentId);
      if (!paused.delete(environmentId)) return;
      resumeConnectionRecovery(environmentId);
      if (stopRecovery) schedule();
    }, PAUSE_RESUME_MS),
  );
  attempts.delete(environmentId);
  setReconnecting(environmentId, false);
  clearTimeout(retries.get(environmentId));
  retries.delete(environmentId);
  setConnectionPhase(environmentId, "waiting");
}

// Automatic recovery ------------------------------------------------------

const retries = new Map<string, ReturnType<typeof setTimeout>>();
const retryCounts = new Map<string, number>();
/** When each machine was last seen connecting; its ladder restarts only once that lasted. */
const connectedAt = new Map<string, number>();
/** Quiet attempts at a `connection-blocked` machine since it last answered. */
const blockedRetryCounts = new Map<string, number>();
/** Machines whose automatic recovery the user stopped, until they reconnect or this wait ends. */
const paused = new Set<string>();
const pauseTimers = new Map<string, ReturnType<typeof setTimeout>>();
function clearPause(environmentId: string) {
  paused.delete(environmentId);
  clearTimeout(pauseTimers.get(environmentId));
  pauseTimers.delete(environmentId);
}
/** How long "Stop reconnecting" holds automatic recovery off. */
export const PAUSE_RESUME_MS = 10 * 60_000;
let hiddenSince: number | undefined;
/** While the computer reports no network, timers wait for it to return instead
 * of spending attempts on an unchanged condition. A Reconnect press still dials. */
const offline = () => typeof navigator !== "undefined" && navigator.onLine === false;
let stopRecovery: (() => void) | undefined;

/** A blocked machine gets a few quiet attempts (fresh describes) before the user
 * must press Reconnect. Other machines keep the open-ended schedule. */
function blockedAttempts(environmentId: string, status: string) {
  if (status !== "connection-blocked") blockedRetryCounts.delete(environmentId);
  return status === "connection-blocked" ? (blockedRetryCounts.get(environmentId) ?? 0) : 0;
}

/** A connection that stayed up long enough starts the next drop at the bottom
 * of the ladder; one that dropped again quickly keeps backing off. */
function trackStability(environmentId: string, status: string) {
  const since = connectedAt.get(environmentId);
  if (status === "connected") {
    if (since === undefined) connectedAt.set(environmentId, monotonicNow());
    return;
  }
  if (since === undefined) return;
  connectedAt.delete(environmentId);
  if (elapsedSince(since) >= AUTO_RETRY_STABLE_MS) retryCounts.delete(environmentId);
}

function schedule() {
  const now = Date.now();
  const enabled = loadRemoteAutoReconnect();
  for (const [environmentId, state] of listRemoteConnections()) {
    trackStability(environmentId, state.status);
    const blocked = blockedAttempts(environmentId, state.status);
    const wanted =
      !offline() &&
      !paused.has(environmentId) &&
      isMachineFocused(environmentId) &&
      (state.status === "connection-blocked"
        ? shouldRetryBlocked(blocked, hiddenSince, now, enabled)
        : shouldAutoRetry(state.status, hiddenSince, now, enabled));
    const pending = retries.get(environmentId);
    if (!wanted) {
      if (pending) clearTimeout(pending);
      retries.delete(environmentId);
      setConnectionRetry(environmentId);
      continue;
    }
    if (pending || attempts.has(environmentId)) continue;
    const count =
      state.status === "connection-blocked" ? blocked : (retryCounts.get(environmentId) ?? 0);
    // One jittered delay drives both the countdown label and the timer, so the
    // label always names the moment the attempt actually runs.
    const delay = autoRetryDelay(count);
    setConnectionRetry(environmentId, now + delay);
    retries.set(environmentId, setTimeout(() => void retry(environmentId, false), delay));
  }
}

async function retry(environmentId: string, force: boolean) {
  clearTimeout(retries.get(environmentId));
  retries.delete(environmentId);
  setConnectionRetry(environmentId);
  const status = readRemoteConnection(environmentId).status;
  const blocked = status === "connection-blocked";
  // Focus and network changes also re-check a machine waiting for sign-in: the
  // key may have been fixed outside the app. They never open a prompt. With
  // automatic reconnecting off, nothing here runs. A blocked machine is limited
  // to its quiet attempts, even when the window regains focus.
  // A machine nobody works in is left to the rare status check; only focused ones are dialed.
  const allowed =
    !offline() &&
    !paused.has(environmentId) &&
    isMachineEnabled(environmentId) &&
    isMachineFocused(environmentId) &&
    loadRemoteAutoReconnect() &&
    status !== "identity-mismatch" &&
    (blocked
      ? shouldRetryBlocked(blockedAttempts(environmentId, status), hiddenSince, Date.now())
      : force
        ? blocksSending(status)
        : shouldAutoRetry(status, hiddenSince, Date.now()));
  if (!allowed || attempts.has(environmentId)) return;
  if (blocked) blockedRetryCounts.set(environmentId, blockedAttempts(environmentId, status) + 1);
  retryCounts.set(environmentId, (retryCounts.get(environmentId) ?? 0) + 1);
  // Only this coalesced coordinator bypasses the native failure cache. Ordinary
  // pollers retain that cache, so early scheduled retries actually dial once.
  await attempt(environmentId, true);
  schedule();
}

/** A focus, network or visibility re-check skips a machine attempted this recently,
 * so switching windows cannot repeat SSH logins. A machine waiting for sign-in is
 * re-checked at most this often. */
const FORCED_RECHECK_MS = 15_000;
const SIGN_IN_RECHECK_MS = 5 * 60_000;

/** `recent` false: the network came back or the setting was turned on, so a
 * recent failed attempt says nothing; only the sign-in wait still applies. */
function retryNow(recent = true) {
  for (const [environmentId, state] of listRemoteConnections()) {
    // Skipped here, not in `retry`, so a pending scheduled retry keeps its timer.
    const last = lastAttemptAt.get(environmentId);
    const wait = needsSignIn(state.status) ? SIGN_IN_RECHECK_MS : recent ? FORCED_RECHECK_MS : 0;
    if (last !== undefined && elapsedSince(last) < wait) continue;
    void retry(environmentId, true);
  }
}
const retryOnFocus = () => retryNow();
/** The network returning or the window coming back after being hidden is new
 * evidence, so the ladder starts again from its shortest wait. A plain focus
 * change is not: it re-checks once but keeps the backoff. */
function wake() {
  retryCounts.clear();
  retryNow(false);
}
const retryOnline = () => wake();
const pauseOffline = () => schedule();

/** Starts retrying dropped focused machines (see `machineFocus`) in the background, once per app run, with a
 * jittered wait that doubles from about two seconds to at most five minutes,
 * and at once when the window regains focus or the network returns. Nothing is
 * dialed while the computer is offline. Machines that need a password are left
 * for the user to reconnect. Also starts listening for tunnels that drop. None
 * of the retrying happens while "Automatically reconnect" is off. */
export function startRemoteAutoRecovery(): () => void {
  if (stopRecovery) return stopRecovery;
  startNativeDisabledMachinesSync();
  const onVisibility = () => {
    const wasHidden = hiddenSince !== undefined;
    hiddenSince = document.visibilityState === "hidden" ? Date.now() : undefined;
    if (hiddenSince === undefined) {
      if (wasHidden) wake();
      else retryNow();
    }
    schedule();
  };
  const unsubscribe = subscribeChanges(schedule);
  const stopInvalidation = subscribeConnectionInvalidated((environmentId) => {
    clearTimeout(retries.get(environmentId));
    retries.delete(environmentId);
    retryCounts.delete(environmentId);
    connectedAt.delete(environmentId);
    blockedRetryCounts.delete(environmentId);
    lastAttemptAt.delete(environmentId);
    clearPause(environmentId);
    attempts.delete(environmentId);
    setReconnecting(environmentId, false);
    setConnectionRetry(environmentId);
  });
  // Turning the setting on tries machines that are down at once; turning it off
  // cancels the timers that are waiting.
  const unsubscribeSetting = subscribeRemoteAutoReconnect(() => {
    if (loadRemoteAutoReconnect()) retryNow(false);
    schedule();
  });
  const stopTunnelWatch = watchTunnelExits();
  const stopTurnOff = subscribeMachineTurnedOff(closeTurnedOffMachine);
  // Opening a down machine's project is new demand: dial it now instead of at the next check.
  const stopFocus = subscribeMachineFocused((environmentId) => {
    void retry(environmentId, true);
    schedule();
  });
  window.addEventListener("focus", retryOnFocus);
  window.addEventListener("online", retryOnline);
  window.addEventListener("offline", pauseOffline);
  document.addEventListener("visibilitychange", onVisibility);
  hiddenSince = document.visibilityState === "hidden" ? Date.now() : undefined;
  schedule();
  stopRecovery = () => {
    unsubscribe();
    stopInvalidation();
    unsubscribeSetting();
    stopTunnelWatch();
    stopTurnOff();
    stopFocus();
    window.removeEventListener("focus", retryOnFocus);
    window.removeEventListener("online", retryOnline);
    window.removeEventListener("offline", pauseOffline);
    document.removeEventListener("visibilitychange", onVisibility);
    retries.forEach((timer) => clearTimeout(timer));
    retries.clear();
    retryCounts.clear();
    connectedAt.clear();
    blockedRetryCounts.clear();
    paused.clear();
    pauseTimers.forEach((timer) => clearTimeout(timer));
    pauseTimers.clear();
    for (const environmentId of attempts.keys()) invalidateConnection(environmentId);
    attempts.clear();
    reconnecting.clear();
    requested.clear();
    lastAttemptAt.clear();
    reconnectListeners.forEach((listener) => listener());
    stopRecovery = undefined;
  };
  return stopRecovery;
}
