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
} from "../../settings/model/settings";
import {
  autoRetryDelay,
  blocksSending,
  needsSignIn,
  sanitizeConnectionError,
  shouldAutoRetry,
  type ReconnectOutcome,
} from "./remoteConnection";
import { remoteErrorText } from "./remoteFailure";
import { watchTunnelExits } from "./remoteTunnelEvents";
import {
  listRemoteConnections,
  notifyRemoteRecovered,
  readRemoteConnection,
  recordRemoteConnection,
  subscribeChanges,
} from "./remoteHealth";

/** Reconnecting a machine, by the user or in the background. Both ask the
 * machine to describe itself: the desktop restarts a dropped SSH tunnel for
 * that request, with the saved key and without any prompt. */

const attempts = new Map<string, Promise<ReconnectOutcome>>();
const reconnecting = new Set<string>();
const reconnectListeners = new Set<() => void>();

export const isReconnecting = (environmentId: string) => reconnecting.has(environmentId);

export function subscribeReconnecting(listener: () => void): () => void {
  reconnectListeners.add(listener);
  return () => reconnectListeners.delete(listener);
}

function setReconnecting(environmentId: string, value: boolean) {
  if (value === reconnecting.has(environmentId)) return;
  if (value) reconnecting.add(environmentId);
  else reconnecting.delete(environmentId);
  reconnectListeners.forEach((listener) => listener());
}

/** One quiet attempt: never prompts. `fresh` skips the desktop's short memory
 * of a just-failed attempt. Attempts for one machine share a single request. */
function attempt(environmentId: string, fresh: boolean): Promise<ReconnectOutcome> {
  const running = attempts.get(environmentId);
  if (running) return running;
  const run = (async (): Promise<ReconnectOutcome> => {
    const machine = await remoteMachineFor(environmentId).catch(() => undefined);
    if (!machine) {
      recordRemoteConnection(environmentId, "Machine is no longer connected");
      return { ok: false, error: "This machine is not connected on this computer." };
    }
    try {
      const host = await remoteRequest<{ capabilities?: unknown }>(
        machine.id,
        "environment.describe",
        {},
        fresh,
      );
      recordRemoteCapabilities(environmentId, host?.capabilities);
      // Views that gave up on the machine reload now.
      notifyRemoteRecovered(environmentId);
      return { ok: true };
    } catch (reason) {
      recordRemoteConnection(environmentId, reason);
      return {
        ok: false,
        error:
          readRemoteConnection(environmentId).error ??
          (sanitizeConnectionError(remoteErrorText(reason)) || "The machine did not answer."),
      };
    }
  })().finally(() => attempts.delete(environmentId));
  attempts.set(environmentId, run);
  return run;
}

/** Reconnects a machine for the user. When SSH needs a password, passphrase or
 * host-key decision, `signIn` hands over to Connections settings, which is
 * where those are answered. */
export async function reconnectRemoteMachine(
  environmentId: string,
  options: { signIn?: boolean } = {},
): Promise<ReconnectOutcome> {
  setReconnecting(environmentId, true);
  try {
    const result = await attempt(environmentId, true);
    if (!result.ok && options.signIn && needsSignIn(readRemoteConnection(environmentId).status)) {
      const machine = knownRemoteMachine(environmentId);
      if (machine?.ssh) requestMachineReconnect(machine.id);
    }
    return result;
  } finally {
    setReconnecting(environmentId, false);
  }
}

// Automatic recovery ------------------------------------------------------

const retries = new Map<string, ReturnType<typeof setTimeout>>();
const retryCounts = new Map<string, number>();
let hiddenSince: number | undefined;
let stopRecovery: (() => void) | undefined;

function schedule() {
  const now = Date.now();
  for (const [environmentId, state] of listRemoteConnections()) {
    const wanted = shouldAutoRetry(state.status, hiddenSince, now, loadRemoteAutoReconnect());
    const pending = retries.get(environmentId);
    if (!wanted) {
      if (pending) clearTimeout(pending);
      retries.delete(environmentId);
      if (state.status === "connected") retryCounts.delete(environmentId);
      continue;
    }
    if (pending || attempts.has(environmentId)) continue;
    const count = retryCounts.get(environmentId) ?? 0;
    retries.set(
      environmentId,
      setTimeout(() => void retry(environmentId, false), autoRetryDelay(count)),
    );
  }
}

async function retry(environmentId: string, force: boolean) {
  clearTimeout(retries.get(environmentId));
  retries.delete(environmentId);
  const status = readRemoteConnection(environmentId).status;
  // Focus and network changes also re-check a machine waiting for sign-in: the
  // key may have been fixed outside the app. They never open a prompt. With
  // automatic reconnecting off, nothing here runs.
  const allowed =
    loadRemoteAutoReconnect() &&
    status !== "identity-mismatch" &&
    (force ? blocksSending(status) : shouldAutoRetry(status, hiddenSince, Date.now()));
  if (!allowed || attempts.has(environmentId)) return;
  retryCounts.set(environmentId, (retryCounts.get(environmentId) ?? 0) + 1);
  await attempt(environmentId, false);
  schedule();
}

function retryNow() {
  for (const [environmentId] of listRemoteConnections()) void retry(environmentId, true);
}

/** Starts retrying dropped machines in the background, once per app run: after
 * 2, 5, 15 and 30 seconds, then every minute, and at once when the window
 * regains focus or the network returns. Machines that need a password are left
 * for the user to reconnect. Also starts listening for tunnels that drop. None
 * of the retrying happens while "Automatically reconnect" is off. */
export function startRemoteAutoRecovery(): () => void {
  if (stopRecovery) return stopRecovery;
  const onVisibility = () => {
    hiddenSince = document.visibilityState === "hidden" ? Date.now() : undefined;
    if (hiddenSince === undefined) retryNow();
    schedule();
  };
  const unsubscribe = subscribeChanges(schedule);
  // Turning the setting on tries machines that are down at once; turning it off
  // cancels the timers that are waiting.
  const unsubscribeSetting = subscribeRemoteAutoReconnect(() => {
    if (loadRemoteAutoReconnect()) retryNow();
    schedule();
  });
  const stopTunnelWatch = watchTunnelExits();
  window.addEventListener("focus", retryNow);
  window.addEventListener("online", retryNow);
  document.addEventListener("visibilitychange", onVisibility);
  hiddenSince = document.visibilityState === "hidden" ? Date.now() : undefined;
  schedule();
  stopRecovery = () => {
    unsubscribe();
    unsubscribeSetting();
    stopTunnelWatch();
    window.removeEventListener("focus", retryNow);
    window.removeEventListener("online", retryNow);
    document.removeEventListener("visibilitychange", onVisibility);
    retries.forEach((timer) => clearTimeout(timer));
    retries.clear();
    retryCounts.clear();
    stopRecovery = undefined;
  };
  return stopRecovery;
}
