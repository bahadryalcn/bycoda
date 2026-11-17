import { invoke } from "@tauri-apps/api/core";
import { withTimeout } from "../../../shared/lib/withTimeout";
import { ModelsListResultSchema } from "../../../shared/model/host-contracts/models";
import { remoteRequest } from "../../connections/public/connections";
import { isLocalSyncMachine } from "../../connections/public/localSync";
import type { RemoteMachine } from "../../connections/public/protocol";
import type { z } from "zod";

export type SetupCatalog = Pick<z.infer<typeof ModelsListResultSchema>, "models">;

export const setupCatalogQuery = (machineId: string) => ({
  queryKey: ["model-routing-setup-catalog", machineId] as const,
  queryFn: async (): Promise<SetupCatalog> =>
    ModelsListResultSchema.parse(await remoteRequest(machineId, "models.list", {})),
  retry: false as const,
  staleTime: 30_000,
});

/** Background-work settings edit the local Host even inside a remote project. */
export async function localSetupCatalog(
  read: (machineId: string) => Promise<SetupCatalog>,
): Promise<SetupCatalog | undefined> {
  try {
    return await withTimeout(
      invoke<RemoteMachine[]>("remote_machines").then((machines) => {
        const machine = machines?.find(isLocalSyncMachine);
        return machine ? read(machine.id) : undefined;
      }),
      3000,
      "Model routing catalog",
    );
  } catch {
    return undefined;
  }
}
