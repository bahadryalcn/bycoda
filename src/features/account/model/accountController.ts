import { AccountApiError, type AccountClient } from "@bycoda/account-contracts";
import {
  clearAccountCache,
  readAccountCache,
  readDeviceId,
  writeAccountCache,
  writeDeviceId,
} from "./accountCache";
import { createAccountApi } from "./accountClient";
import { AccountNativeError, toNativeError, type AccountNative } from "./accountNative";
import {
  INITIAL_ACCOUNT_STATE,
  accountReducer,
  isSignedIn,
  type AccountEvent,
  type AccountState,
} from "./accountState";
import { buildDeviceRegistration } from "./deviceRegistration";

export type AccountControllerDeps = {
  native: AccountNative;
  openExternal: (url: string) => Promise<void>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  fetchImpl?: typeof fetch;
  /** Poll interval of the browser sign-in; default 1 s. */
  pollMs?: number;
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function isNetworkFailure(error: unknown): boolean {
  return (
    (error instanceof AccountNativeError && error.kind === "offline") ||
    // fetch rejects with a TypeError when there is no response at all.
    (error instanceof TypeError && !(error instanceof AccountApiError))
  );
}

/**
 * Owns the account state of this window: start-up from the cache and the native session,
 * browser sign-in, device registration, sign-out and failure handling. Signed out is the
 * resting state; nothing here touches local sessions, projects or settings.
 */
export function createAccountController(deps: AccountControllerDeps) {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const pollMs = deps.pollMs ?? 1000;
  const storage = deps.storage;
  const listeners = new Set<() => void>();
  let state: AccountState = INITIAL_ACCOUNT_STATE;
  let baseUrl: string | null = null;
  let deviceId: string | null = null;
  let api: AccountClient | null = null;
  let activeSignIn: { handle: string | null; cancelled: boolean } | null = null;

  const dispatch = (event: AccountEvent) => {
    const next = accountReducer(state, event);
    if (next === state) return;
    state = next;
    for (const listener of Array.from(listeners)) listener();
  };

  const getAccessToken = async (): Promise<string | null> => {
    try {
      return (await deps.native.accessToken()).accessToken;
    } catch (error) {
      await handleFailure(error);
      return null;
    }
  };

  /** The contract client; null until the native status gave the API address. */
  function client(): AccountClient {
    if (!baseUrl) throw new AccountNativeError("notConfigured", "Account is not set up.");
    api ??= createAccountApi({
      baseUrl,
      getAccessToken,
      getDeviceId: () => deviceId,
      fetchImpl: deps.fetchImpl,
    });
    return api;
  }

  async function endSession(reason: "session-ended" | "device-revoked") {
    deviceId = null;
    clearAccountCache(storage);
    dispatch({ type: "session-ended", reason });
  }

  /** Classifies a failure. Returns after updating state; callers rethrow what is theirs. */
  async function handleFailure(error: unknown): Promise<void> {
    if (error instanceof AccountNativeError) {
      if (error.kind === "sessionExpired" || error.kind === "signedOut") {
        await endSession("session-ended");
      } else if (error.kind === "offline") {
        dispatch({ type: "offline" });
      }
    } else if (error instanceof AccountApiError && error.code === "account_deactivated") {
      await probeDeactivated(); // -- the account page shows the deactivated state.
    } else if (error instanceof AccountApiError && error.code === "device_revoked") {
      // Deactivation revokes every device; the account then answers without a device header.
      if (await probeDeactivated()) return;
      // Signed out remotely: forget the tokens too, local data stays.
      await deps.native.signOut().catch(() => undefined); // -- the session ends locally either way.
      await endSession("device-revoked");
    } else if (isNetworkFailure(error)) {
      dispatch({ type: "offline" });
    }
  }

  /** True when the account is deactivated: the view then stays signed in without a device. */
  async function probeDeactivated(): Promise<boolean> {
    const known = deviceId;
    deviceId = null;
    try {
      const context = await client().getMe();
      if (context.user.status === "deactivated") {
        const verifiedAt = now();
        writeAccountCache({ context, deviceId: null, verifiedAt }, storage);
        dispatch({ type: "verified", context, deviceId: null, now: verifiedAt });
        return true;
      }
    } catch {
      // -- the probe failing means the session is really gone; the caller signs out.
    }
    deviceId = known;
    return false;
  }

  async function registerDevice(userId: string, fresh: boolean): Promise<string | null> {
    const known = readDeviceId(userId, storage);
    const info = await deps.native.deviceInfo();
    const attempt = (id: string | null) =>
      client().registerDevice({ body: buildDeviceRegistration(info, id) });
    try {
      const device = await attempt(known);
      writeDeviceId(userId, device.id, storage);
      return device.id;
    } catch (error) {
      // After a fresh sign-in a revoked id is simply replaced by a new device.
      if (fresh && known && error instanceof AccountApiError && error.code === "device_revoked") {
        const device = await attempt(null);
        writeDeviceId(userId, device.id, storage);
        return device.id;
      }
      throw error;
    }
  }

  /** Confirms the session with the service, registers this device and caches the result. */
  async function verify(fresh: boolean): Promise<void> {
    const context = await client().getMe();
    deviceId = readDeviceId(context.user.id, storage);
    // A deactivated account has no live device; it registers a new one when it is reactivated.
    if (context.user.status === "deactivated") {
      deviceId = null;
      const verifiedAt = now();
      writeAccountCache({ context, deviceId, verifiedAt }, storage);
      dispatch({ type: "verified", context, deviceId, now: verifiedAt });
      return;
    }
    try {
      deviceId = await registerDevice(context.user.id, fresh);
    } catch (error) {
      if (error instanceof AccountApiError && error.code === "device_revoked") throw error;
      // Registration is retried at the next start; the account view itself is verified.
    }
    const verifiedAt = now();
    writeAccountCache({ context, deviceId, verifiedAt }, storage);
    dispatch({ type: "verified", context, deviceId, now: verifiedAt });
  }

  return {
    getState: (): AccountState => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /** The contract client for screens; throws `notConfigured` before `start`. */
    api: client,

    /** Reads the native session and the cache, then confirms with the service when it can. */
    async start(): Promise<void> {
      try {
        const status = await deps.native.status();
        if (!status.configured) {
          dispatch({ type: "unavailable" });
          return;
        }
        baseUrl = status.apiBaseUrl;
        if (!status.signedIn) {
          clearAccountCache(storage);
          dispatch({ type: "no-session" });
          return;
        }
        const cached = readAccountCache(now(), storage);
        if (cached) {
          deviceId = cached.deviceId;
          dispatch({ type: "cached", ...cached });
        }
        await verify(false);
      } catch (error) {
        await handleFailure(error);
        // Offline with no cached view: stay usable signed out; `start` can be retried.
        if (state.phase === "starting") dispatch({ type: "no-session" });
      }
    },

    /** Runs the browser sign-in and resolves when it ends, successfully or not. */
    async signIn(): Promise<void> {
      if (state.phase !== "signed-out") return;
      dispatch({ type: "sign-in-requested" });
      const flow = { handle: null as string | null, cancelled: false };
      activeSignIn = flow;
      try {
        const started = await deps.native.signInStart();
        flow.handle = started.handle;
        if (flow.cancelled) {
          await deps.native.signInCancel(started.handle);
          return;
        }
        await deps.openExternal(started.authorizeUrl);
        for (;;) {
          await sleep(pollMs);
          if (flow.cancelled) return;
          const poll = await deps.native.signInPoll(started.handle);
          if (poll.status === "pending") continue;
          if (poll.status === "done") break;
          if (poll.status === "denied") dispatch({ type: "sign-in-declined" });
          else if (poll.status === "cancelled") dispatch({ type: "sign-in-cancelled" });
          else dispatch({ type: "sign-in-failed", message: poll.error?.message ?? null });
          return;
        }
        baseUrl ??= (await deps.native.status()).apiBaseUrl;
        await verify(true);
      } catch (error) {
        if (flow.cancelled) return;
        const native = toNativeError(error);
        dispatch({
          type: "sign-in-failed",
          message: error instanceof AccountApiError ? error.message : native.message,
        });
      } finally {
        if (activeSignIn === flow) activeSignIn = null;
      }
    },

    /** Gives up a running browser sign-in and frees its local port. */
    async cancelSignIn(): Promise<void> {
      const flow = activeSignIn;
      if (!flow) return;
      flow.cancelled = true;
      dispatch({ type: "sign-in-cancelled" });
      if (flow.handle) await deps.native.signInCancel(flow.handle).catch(() => undefined); // -- already gone is fine.
    },

    /** Forgets the tokens and the cached view. Sessions, projects and settings are untouched. */
    async signOut(): Promise<void> {
      await deps.native.signOut();
      deviceId = null;
      clearAccountCache(storage);
      dispatch({ type: "signed-out" });
    },

    /** Deactivates the account (data kept, devices signed out) and keeps the view signed in. */
    async deactivate(reason?: string): Promise<void> {
      await client().deactivateAccount({ body: reason ? { reason } : {} });
      deviceId = null;
      await verify(false);
    },

    /** Restores a deactivated account and registers this computer again. */
    async reactivate(): Promise<void> {
      await client().reactivateAccount();
      await verify(true);
    },

    /** Re-confirms an open account view, for example when the window regains focus. */
    async refresh(): Promise<void> {
      if (!isSignedIn(state)) return;
      try {
        await verify(false);
      } catch (error) {
        await handleFailure(error);
      }
    },

    /** Reports failures of screen-level calls (revoked device, expired session, offline). */
    handleFailure,
  };
}

export type AccountController = ReturnType<typeof createAccountController>;
