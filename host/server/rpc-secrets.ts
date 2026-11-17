import { SecretsOwnerRevokeParamsSchema } from "../../src/shared/model/host-contracts/secrets-owner";
import type { ServerBindings } from "./bindings";
import type { OwnerRpcRequest } from "./owner-rpc-context";
import { assertDomainAuthority } from "../domains/context";
import { SecretInputListParamsSchema } from "../../src/shared/model/host-contracts/secrets-input";

/** Owner-only transient inputs; never queue or persist answers. */
export async function handleSecretInputRpc(
  dependencies: Pick<ServerBindings, "conversationDesktop">,
  request: OwnerRpcRequest,
): Promise<void> {
  await assertDomainAuthority(request.domainContext);
  request.result =
    request.input.method === "secrets.input.list"
      ? await dependencies.conversationDesktop.secretInputs(
          SecretInputListParamsSchema.parse(request.params).sessionId,
          request.domainContext.authorized,
        )
      : await dependencies.conversationDesktop.answerSecretInput(
          request.params,
          request.domainContext.authorized,
        );
}

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
