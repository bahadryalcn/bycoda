import { invoke } from "@tauri-apps/api/core";
import type { QueryClient } from "@tanstack/react-query";
import { machineCapabilities } from "../../automations/public/hostMachines";
import { isLocalSyncMachine } from "../../connections/public/localSync";
import { remoteRequest } from "../../connections/public/connections";
import type { RemoteMachine } from "../../connections/public/protocol";
import {
  HOST_MODEL_ROUTING,
  ModelRoutingGetResultSchema,
  type ModelRoutingScope,
  type ModelRoutingState,
} from "../../../shared/model/host-contracts/model-routing";

type Kinds = Record<string, ModelRoutingScope>;

/** What the sync needs from one Host; tests replace it. */
export type ProjectKindsIo = {
  supported(): Promise<boolean>;
  get(): Promise<ModelRoutingState>;
  save(
    expectedVersion: number,
    draft: Omit<ModelRoutingState, "version" | "updatedAt">,
  ): Promise<ModelRoutingState>;
};

function sameKinds(a: Kinds | undefined, b: Kinds): boolean {
  const left = Object.entries(a ?? {});
  return left.length === Object.keys(b).length && left.every(([key, kind]) => b[key] === kind);
}

/**
 * Writes the effective project scopes into the routing document, replacing only `projectKinds`.
 * Never throws: an unsupported Host, a failed read, a non-owner save or a second conflict is
 * logged and reported as false so the caller can retry. True means the Host holds `kinds`.
 */
export async function syncProjectKindsWith(
  io: ProjectKindsIo,
  kinds: Kinds,
  onSaved?: (state: ModelRoutingState) => void,
): Promise<boolean> {
  try {
    if (!(await io.supported())) return false;
    for (let attempt = 0; ; attempt++) {
      const { version, updatedAt: _updatedAt, ...draft } = await io.get();
      if (sameKinds(draft.projectKinds, kinds)) return true;
      const { projectKinds: _old, ...rest } = draft;
      try {
        const saved = await io.save(
          version,
          Object.keys(kinds).length ? { ...rest, projectKinds: kinds } : rest,
        );
        onSaved?.(saved);
        return true;
      } catch (error) {
        // A stale version is the usual cause: re-read once and send again.
        if (attempt > 0) throw error;
      }
    }
  } catch (error) {
    console.warn("Project tags were not saved to the model routing", error);
    return false;
  }
}

async function localMachine(machineId: string | undefined): Promise<RemoteMachine | undefined> {
  const machines = await invoke<RemoteMachine[]>("remote_machines");
  return machines?.find(machineId ? (entry) => entry.id === machineId : isLocalSyncMachine);
}

/**
 * Sends the project scopes to a Host's routing document (default: this computer's Host, the one
 * Settings > Models edits) and refreshes that machine's cached routing state.
 */
export function syncProjectKinds(
  machineId: string | undefined,
  kinds: Kinds,
  client?: QueryClient,
): Promise<boolean> {
  let machine: RemoteMachine | undefined;
  const resolve = async () => (machine ??= await localMachine(machineId));
  const request = async (method: string, params: object) => {
    const target = await resolve();
    if (!target) throw new Error("Host is unavailable.");
    return ModelRoutingGetResultSchema.parse(
      await remoteRequest(target.id, method, params, false, method === "modelRouting.save"),
    ).state;
  };
  return syncProjectKindsWith(
    {
      supported: async () => {
        const target = await resolve();
        return !!target && (await machineCapabilities(target)).includes(HOST_MODEL_ROUTING);
      },
      get: () => request("modelRouting.get", {}),
      save: (expectedVersion, draft) => request("modelRouting.save", { expectedVersion, draft }),
    },
    kinds,
    (state) => {
      if (machine) client?.setQueryData([HOST_MODEL_ROUTING, machine.id], state);
      void client?.invalidateQueries({
        queryKey: [HOST_MODEL_ROUTING, machine?.id],
      });
    },
  );
}
