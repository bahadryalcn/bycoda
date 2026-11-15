import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { mergeRoutes, summarizeRoutes, type MachineRoutes } from "../model/machineRoutes";
import type { RemoteMachine } from "../model/protocol";

/** The route kind and route count for a machine's summary line. Read again when
 * `refresh` changes (a probe finished), so a tunnel the account just taught shows up. */
export function useMachineRouteSummary(machine: RemoteMachine, refresh: unknown) {
  const [native, setNative] = useState<MachineRoutes>();
  const key = JSON.stringify([machine.id, machine.environmentId, machine.ssh]);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Keeps the summary in step with the desktop's native route store and drops stale answers on cleanup.
  useEffect(() => {
    let current = true;
    const parsed = JSON.parse(key) as [string, string, RemoteMachine["ssh"]];
    invoke<MachineRoutes>("remote_machine_routes", {
      machineId: parsed[0],
      target: parsed[2] ?? null,
      environmentId: parsed[1],
    })
      .then((value) => current && setNative(value))
      .catch(() => current && setNative(undefined));
    return () => {
      current = false;
    };
  }, [key, refresh]);
  return summarizeRoutes(mergeRoutes(machine, native));
}
