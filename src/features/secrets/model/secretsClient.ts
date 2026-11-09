import type { z } from "zod";
import type { HostProject } from "../../connections/public/protocol";
import { remoteRequest } from "../../connections/public/connections";
import type { SECRETS_OWNER_RPC } from "../../../shared/model/host-contracts/secrets-owner";

export type OwnerSecretsList = z.output<(typeof SECRETS_OWNER_RPC)["secrets.owner.list"]["result"]>;
export type OwnerSecret = OwnerSecretsList["secrets"][number];

/** Owner-only calls to this machine's Host. The Host never returns secret values. */
export function secretsClient(machineId: string) {
  return {
    list: () => remoteRequest<OwnerSecretsList>(machineId, "secrets.owner.list", {}),
    revoke: (secretRef: string) =>
      remoteRequest<{ revoked: true }>(machineId, "secrets.owner.revoke", { secretRef }),
    projects: () => remoteRequest<HostProject[]>(machineId, "projects.list"),
  };
}
export type SecretsClient = ReturnType<typeof secretsClient>;
