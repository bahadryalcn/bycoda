import { invoke } from "@tauri-apps/api/core";
import { useEffect, useEffectEvent, useState } from "react";
import { isSignedIn, listOtherComputers, useAccountState } from "../../account";
import {
  candidateFromComputer,
  mergeMachineCandidates,
  type DiscoveredMachine,
  type MachineCandidate,
} from "../model/machineCandidates";
import type { RemoteMachine } from "../model/protocol";

/** The list is re-read this often while it is visible. */
export const DISCOVERY_REFRESH_MS = 10_000;

/**
 * `undefined` means the read failed (or the desktop build lacks the command): the caller keeps
 * its last confirmed list. An empty array is a real result and clears the list.
 */
const nativeCandidates = () =>
  invoke<MachineCandidate[]>("discover_machine_candidates").then(
    (list) => (Array.isArray(list) ? list : undefined),
    () => undefined,
  );

export type DiscoveredMachinesState = {
  machines: DiscoveredMachine[];
  /** True until the first read finished. */
  loading: boolean;
  /** Signed out of the account: only native candidates are listed. */
  signedOut: boolean;
};

/**
 * Account computers plus the desktop's own candidates as one list, re-read every 10 s while
 * `active`. A failed account read keeps the last account list; it never blocks native candidates.
 */
export function useDiscoveredMachines(
  saved: RemoteMachine[],
  active: boolean,
): DiscoveredMachinesState {
  const account = useAccountState();
  const signedIn = isSignedIn(account);
  const deviceId = isSignedIn(account) ? account.deviceId : null;
  const [accountList, setAccountList] = useState<MachineCandidate[]>([]);
  const [native, setNative] = useState<MachineCandidate[]>([]);
  const [loading, setLoading] = useState(true);

  const read = useEffectEvent(async (isCurrent: () => boolean) => {
    // A slow or stalled account read (bounded by the account API deadline) must not hold back
    // the desktop's own candidates, so they are applied as soon as they arrive.
    const nativeDone = nativeCandidates().then((found) => {
      if (isCurrent() && found) setNative(found);
    });
    const computers = await (signedIn
      ? listOtherComputers(deviceId).then(
          (list) => list.map((computer) => candidateFromComputer(computer)),
          () => undefined,
        )
      : Promise.resolve([] as MachineCandidate[]));
    await nativeDone;
    if (!isCurrent()) return;
    if (computers) setAccountList(computers);
    setLoading(false);
  });

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- keeps the list in step with the account and native discovery by polling every 10 s while visible
  useEffect(() => {
    if (!active) return;
    let current = true;
    // One read at a time: a slow pass skips the next tick instead of overlapping it.
    let inFlight = false;
    const run = () => {
      if (document.hidden || inFlight) return;
      inFlight = true;
      void read(() => current).finally(() => {
        inFlight = false;
      });
    };
    run();
    const timer = setInterval(run, DISCOVERY_REFRESH_MS);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [active, signedIn, deviceId]);

  return {
    machines: mergeMachineCandidates({
      account: signedIn ? accountList : [],
      native,
      saved,
    }),
    loading,
    signedOut: account.phase === "signed-out",
  };
}
