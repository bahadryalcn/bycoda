import type { AccountContext } from "@bycoda/account-contracts";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { accountController, restartAccount, startAccount } from "../model/accountService";
import { isSignedIn, type AccountState } from "../model/accountState";

export function useAccountState(): AccountState {
  const controller = accountController();
  return useSyncExternalStore(controller.subscribe, controller.getState);
}

/** Account state plus the actions of the account screen. Starts the account on first use. */
export function useAccount() {
  const state = useAccountState();
  useEffect(() => {
    startAccount().catch(() => undefined);
  }, []);
  const controller = accountController();
  return {
    state,
    signIn: useCallback(() => controller.signIn(), [controller]),
    cancelSignIn: useCallback(() => controller.cancelSignIn(), [controller]),
    signOut: useCallback(() => controller.signOut(), [controller]),
    deactivate: useCallback((reason?: string) => controller.deactivate(reason), [controller]),
    reactivate: useCallback(() => controller.reactivate(), [controller]),
    retry: useCallback(() => restartAccount(), []),
  };
}

/**
 * What the rest of the app may read about the account. `organizations` is the extension
 * point for the team plan: it is empty today and UI renders nothing for an empty list.
 */
export function useAccountContext(): AccountContext | null {
  const state = useAccountState();
  return isSignedIn(state) ? state.context : null;
}
