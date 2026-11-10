import { APPROVALS_RPC } from "../../src/shared/model/host-contracts/approvals";
import type { ServerBindings } from "./bindings";
import type { OwnerRpcRequest } from "./owner-rpc-context";

/**
 * Owner approvals mirrored from the desktop. Mirroring and reading decisions need the desktop principal;
 * listing and deciding are open to every paired device, and the desktop still verifies each decision.
 */
export async function handleApprovalsRpc(
  dependencies: Pick<ServerBindings, "approvals">,
  request: OwnerRpcRequest,
): Promise<void> {
  const { approvals } = dependencies;
  await approvals.ready;
  switch (request.input.method) {
    case "approvals.mirror":
      request.result = await approvals.mirror(
        request.tokenHash,
        APPROVALS_RPC["approvals.mirror"].params.parse(request.params),
      );
      break;
    case "approvals.list":
      APPROVALS_RPC["approvals.list"].params.parse(request.params);
      request.result = { approvals: approvals.list() };
      break;
    case "approvals.decide":
      request.result = approvals.decide(
        APPROVALS_RPC["approvals.decide"].params.parse(request.params),
      );
      // A phone answer is acknowledged only once it survives a restart.
      await approvals.flush();
      break;
    case "approvals.decisions":
      APPROVALS_RPC["approvals.decisions"].params.parse(request.params);
      request.result = { decisions: approvals.decisions(request.tokenHash) };
      break;
  }
}
