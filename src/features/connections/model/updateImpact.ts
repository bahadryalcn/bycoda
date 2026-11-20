import { invoke } from "@tauri-apps/api/core";
import { withTimeout } from "../../../shared/lib/withTimeout";
import { remoteRequest } from "./connections";
import type { HostProject, HostSessionSummary, RemoteMachine } from "./protocol";
import type { SessionsListResult } from "../../../shared/model/host-contracts/session-reads";

export type UpdateTarget = "app" | "local-host" | { machineId: string };
export type UpdateMachineImpact = {
  id: string;
  name: string;
  local: boolean;
  affected: boolean;
  running: number | null;
  desktopRunning: number | null;
  desktopSessionIds?: string[];
};

/** Fresh metadata only: never fetch transcripts or mistake failed reads for idle. */
export async function readUpdateImpact(
  target: UpdateTarget,
  onMachine?: (row: UpdateMachineImpact) => void,
): Promise<UpdateMachineImpact[]> {
  const machines = await withTimeout(
    invoke<RemoteMachine[]>("remote_machines"),
    8_000,
    "Update machines",
  );
  const unique = new Map<string, RemoteMachine>();
  for (const machine of machines) {
    const key = machine.environmentId || machine.id;
    const previous = unique.get(key);
    const selected = typeof target === "object" && target.machineId === machine.id;
    const previousSelected = typeof target === "object" && target.machineId === previous?.id;
    if (!previous || selected || (machine.localHost && !previousSelected))
      unique.set(key, { ...machine, localHost: machine.localHost || previous?.localHost });
    else if (machine.localHost) unique.set(key, { ...previous, localHost: true });
  }
  const rows = await Promise.all(
    [...unique.values()].map(async (machine) => {
      const row: UpdateMachineImpact = {
        id: machine.id,
        name: machine.name,
        local: machine.localHost === true,
        affected:
          typeof target === "object" ? target.machineId === machine.id : machine.localHost === true,
        running: null,
        desktopRunning: null,
      };
      try {
        const sessions = await withTimeout(
          (async () => {
            const projects = await remoteRequest<HostProject[]>(
              machine.id,
              "projects.list",
              {},
              false,
              false,
              machine.environmentId,
            );
            const lists = await Promise.all(
              projects.map((project) =>
                remoteRequest<SessionsListResult>(
                  machine.id,
                  "sessions.list",
                  { projectId: project.id },
                  false,
                  false,
                  machine.environmentId,
                ),
              ),
            );
            const all = new Map<
              string,
              Pick<HostSessionSummary, "id" | "status" | "executionOwner">
            >();
            for (const list of lists) {
              if (!Array.isArray(list) && !("sessions" in list))
                throw new Error("Missing update activity snapshot");
              for (const session of Array.isArray(list) ? list : list.sessions)
                all.set(session.id, session);
            }
            return [...all.values()].filter((session) => session.status === "running");
          })(),
          8_000,
          "Update activity",
        );
        row.running = sessions.length;
        // Legacy ownership is uncertain; warn conservatively rather than promise continuation.
        row.desktopSessionIds = sessions
          .filter((session) => session.executionOwner !== "host")
          .map((session) => session.id);
        row.desktopRunning = row.desktopSessionIds.length;
      } catch {
        // Offline, old and incomplete Hosts remain explicitly unknown.
      }
      onMachine?.(row);
      return row;
    }),
  );
  if (!rows.some((row) => row.local))
    rows.unshift({
      id: "this-computer",
      name: "",
      local: true,
      affected: target === "app" || target === "local-host",
      running: null,
      desktopRunning: null,
    });
  return rows.sort((a, b) => Number(b.local) - Number(a.local));
}
