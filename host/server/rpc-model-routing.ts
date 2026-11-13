import type { ServerBindings } from "./bindings";
import type { OwnerRpcRequest } from "./owner-rpc-context";
import { hostModelRoutingService } from "../model-routing/runtime";
import { createModelRoutingDomainService } from "../domains/model-routing/service";

export async function handleModelRoutingRpc(
  dependencies: Pick<ServerBindings, "engine">,
  request: OwnerRpcRequest,
): Promise<void> {
  const service = createModelRoutingDomainService(
    hostModelRoutingService(dependencies.engine.store),
  );
  switch (request.input.method) {
    case "modelRouting.get":
      request.result = await service.get(request.params, request.domainContext);
      break;
    case "modelRouting.save":
      request.result = await service.save(request.params, request.domainContext);
      break;
    case "modelRouting.status":
      request.result = await service.status(request.params, request.domainContext);
      break;
    case "modelRouting.resolve":
      request.result = await service.resolve(request.params, request.domainContext);
      break;
  }
}
