import { SecretsOwnerRevokeParamsSchema } from "../../src/shared/model/host-contracts/secrets-owner";
import type { ServerBindings } from "./bindings";
import type { OwnerRpcRequest } from "./owner-rpc-context";

/** Owner-only: conversation credentials never reach owner RPC. Values are never returned. */
export async function handleSecretsOwnerRpc(
  dependencies: Pick<ServerBindings, "conversationSecrets">,
  request: OwnerRpcRequest,
): Promise<void> {
  const secrets = dependencies.conversationSecrets;
  if (request.input.method === "secrets.owner.list") {
    request.result = { secrets: await secrets.ownerList() };
    return;
  }
  const { secretRef } = SecretsOwnerRevokeParamsSchema.parse(request.params);
  await secrets.ownerRevoke(secretRef);
  request.result = { revoked: true };
}
