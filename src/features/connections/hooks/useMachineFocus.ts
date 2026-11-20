import { useEffect } from "react";
import { focusMachine } from "../model/machineFocus";

/** Keeps the machine focused while the caller is mounted. */
export function useMachineFocus(environmentId?: string): void {
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- holds the module-level focus mark for the mounted view's machine, released on change or unmount
  useEffect(() => (environmentId ? focusMachine(environmentId) : undefined), [environmentId]);
}
