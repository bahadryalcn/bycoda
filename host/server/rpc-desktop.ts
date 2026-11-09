import { desktopHelperDomain } from "../desktop-helper-domain";
import { desktopControlDomain } from "../desktop/desktop-control-domain";
import type { ServerBindings } from "./bindings";
import type { OwnerRpcRequest } from "./owner-rpc-context";
export async function handleDesktopRpc(
  dependencies: Pick<
    ServerBindings,
    "nativeServicesService" | "desktopControl" | "engine" | "desktopHelper"
  >,
  request: OwnerRpcRequest,
): Promise<void> {
  switch (request.input.method) {
    case "desktop.status":
      request.result = await dependencies.nativeServicesService.call(
        "native.services.desktop.status",
        request.params,
        request.domainContext,
      );
      break;

    case "desktop.stop":
      request.result = await dependencies.nativeServicesService.call(
        "native.services.desktop.stop",
        request.params,
        request.domainContext,
      );
      break;

    case "desktop.request":
      request.result = await desktopControlDomain(
        dependencies.desktopControl,
        dependencies.engine.store,
      )(request.params, request.domainContext);
      break;

    case "desktop.helper.request":
      request.result = await desktopHelperDomain(
        dependencies.desktopHelper,
        dependencies.engine.store,
      )(request.params, request.domainContext);
      break;
  }
}
