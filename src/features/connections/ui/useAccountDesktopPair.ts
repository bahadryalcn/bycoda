import { useEffect, useState } from "react";
import {
  accountApi,
  accountDeviceInfo,
  isSignedIn,
  reportAccountFailure,
  requestDesktopPair,
  useAccountState,
} from "../../account";
import { startAccountDesktopPair, type AccountPairPlan } from "../model/accountDesktopPairing";
import type { RemoteMachine } from "../model/protocol";

export type AccountPairView =
  | { step: "starting" }
  | { step: "waiting"; code: string }
  | { step: "connected"; machine: RemoteMachine }
  | { step: "denied" | "expired" | "unavailable" | "ticket" | "connection" };

/**
 * Runs one account pairing request while the dialog is open and cancels it when it closes.
 * `retry()` starts a fresh request (a new key and a new code).
 */
export function useAccountDesktopPair(plan: AccountPairPlan) {
  const account = useAccountState();
  const deviceId = isSignedIn(account) ? account.deviceId : null;
  const [view, setView] = useState<AccountPairView>({ step: "starting" });
  const [attempt, setAttempt] = useState(0);

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- holds one account pair request (polling) open while the dialog is mounted and cancels it on close
  useEffect(() => {
    if (!deviceId) return;
    let current = true;
    const controller = new AbortController();
    let cancel: (() => void) | undefined;
    const show = (next: AccountPairView) => {
      if (current) setView(next);
    };
    (async () => {
      show({ step: "starting" });
      const api = accountApi();
      const { name: deviceName } = await accountDeviceInfo();
      if (!current) return;
      const flow = await startAccountDesktopPair(plan, {
        request: (target) =>
          requestDesktopPair(target, { api, deviceId, signal: controller.signal }),
        deviceName,
        signal: controller.signal,
      });
      cancel = flow.cancel;
      if (!current) flow.cancel();
      show({ step: "waiting", code: flow.code });
      const result = await flow.result;
      if (result.state === "connected") show({ step: "connected", machine: result.machine });
      else if (result.state === "failed") show({ step: result.reason });
      else if (result.state !== "cancelled") show({ step: result.state });
    })().catch((error) => {
      reportAccountFailure(error).catch(() => undefined);
      show({ step: "unavailable" });
    });
    return () => {
      current = false;
      controller.abort();
      cancel?.();
    };
  }, [plan, deviceId, attempt]);

  return { view, retry: () => setAttempt((value) => value + 1), signedIn: deviceId !== null };
}
