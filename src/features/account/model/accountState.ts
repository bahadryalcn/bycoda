import type { AccountContext } from "@bycoda/account-contracts";

/** Why the account is signed out, shown once as a plain notice. */
export type AccountNotice = "session-ended" | "device-revoked" | "sign-in-failed" | "declined";

export type AccountState =
  /** Reading the native status and the cache. */
  | { phase: "starting" }
  /** This build has no account service configured; the account UI stays hidden. */
  | { phase: "unavailable" }
  | { phase: "signed-out"; notice: AccountNotice | null; message: string | null }
  | { phase: "signing-in" }
  | {
      phase: "signed-in";
      context: AccountContext;
      deviceId: string | null;
      /** Unix ms of the last server confirmation. */
      verifiedAt: number;
      /** True while the context comes from the cache because the service was unreachable. */
      stale: boolean;
    };

export type AccountEvent =
  | { type: "unavailable" }
  | { type: "no-session" }
  | { type: "cached"; context: AccountContext; deviceId: string | null; verifiedAt: number }
  | { type: "sign-in-requested" }
  | { type: "sign-in-cancelled" }
  | { type: "sign-in-declined" }
  | { type: "sign-in-failed"; message: string | null }
  | { type: "verified"; context: AccountContext; deviceId: string | null; now: number }
  | { type: "offline" }
  | { type: "session-ended"; reason: "session-ended" | "device-revoked" }
  | { type: "signed-out" };

export const INITIAL_ACCOUNT_STATE: AccountState = { phase: "starting" };

const signedOut = (
  notice: AccountNotice | null = null,
  message: string | null = null,
): AccountState => ({ phase: "signed-out", notice, message });

/**
 * Pure transitions of the account. Signed out is the resting state and the app works fully
 * in it; nothing here touches local data.
 */
export function accountReducer(state: AccountState, event: AccountEvent): AccountState {
  switch (event.type) {
    case "unavailable":
      return { phase: "unavailable" };
    case "no-session":
      return signedOut();
    case "cached":
      return {
        phase: "signed-in",
        context: event.context,
        deviceId: event.deviceId,
        verifiedAt: event.verifiedAt,
        stale: true,
      };
    case "sign-in-requested":
      return state.phase === "signed-out" ? { phase: "signing-in" } : state;
    case "sign-in-cancelled":
      return state.phase === "signing-in" ? signedOut() : state;
    case "sign-in-declined":
      return state.phase === "signing-in" ? signedOut("declined") : state;
    case "sign-in-failed":
      return state.phase === "signing-in" ? signedOut("sign-in-failed", event.message) : state;
    case "verified":
      if (state.phase === "signed-out" || state.phase === "unavailable") return state;
      return {
        phase: "signed-in",
        context: event.context,
        deviceId: event.deviceId,
        verifiedAt: event.now,
        stale: false,
      };
    case "offline":
      return state.phase === "signed-in" && !state.stale ? { ...state, stale: true } : state;
    case "session-ended":
      return state.phase === "signed-in" || state.phase === "starting"
        ? signedOut(event.reason)
        : state;
    case "signed-out":
      return signedOut();
  }
}

export function isSignedIn(
  state: AccountState,
): state is Extract<AccountState, { phase: "signed-in" }> {
  return state.phase === "signed-in";
}
