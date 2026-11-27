import { useEffect, useState } from "react";
import { useModelRouting } from "./modelRoutingClient";
import { syncDelegationProfile } from "./delegationProfileSync";
import { delegationSaveInput, type DelegationChanges } from "./delegationProfile";

export function useDelegationProfile(machineId: string | undefined, supported: boolean) {
  const routing = useModelRouting(machineId, supported, 5_000);
  const [syncError, setSyncError] = useState<string>();
  const state = routing.state;
  // Host layers refresh the composer copy without replacing pending Settings edits.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- synchronizes the persisted renderer delegation profile with Host routing while Settings is open
  useEffect(() => {
    if (!routing.supported || !machineId || !state) return;
    let active = true;
    void syncDelegationProfile(state).then(
      () => {
        if (active) setSyncError(undefined);
      },
      (error: unknown) => {
        if (active) setSyncError(String(error));
      },
    );
    return () => {
      active = false;
    };
  }, [machineId, routing.supported, state]);
  return {
    ...routing,
    error: routing.error ?? syncError,
    async saveChanges(changes: DelegationChanges) {
      if (!state) throw new Error("Host model settings are not loaded. Try again.");
      return routing.save.mutateAsync(delegationSaveInput(state, changes));
    },
  };
}
