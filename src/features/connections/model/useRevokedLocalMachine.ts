import { useSyncExternalStore } from "react";
import { savedMachineForEnvironment } from "./connections";
import { isLocalSyncMachine } from "./localSync";
import type { RemoteMachine } from "./protocol";
import { pairingRefusalKey, subscribeChanges } from "./remoteHealth";

/**
 * This computer's link to its own Host while the Host refuses the saved credential, found from
 * what every request to it reported. Another machine's refusal never shows here.
 */
export function useRevokedLocalMachine(): RemoteMachine | undefined {
  const refused = useSyncExternalStore(subscribeChanges, pairingRefusalKey, () => "");
  return refused
    .split("\n")
    .map(savedMachineForEnvironment)
    .find((machine) => machine !== undefined && isLocalSyncMachine(machine));
}
