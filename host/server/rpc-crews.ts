import type { ServerBindings } from "./bindings";
import type { OwnerRpcRequest } from "./owner-rpc-context";
export async function handleCrewsRpc(
  dependencies: Pick<ServerBindings, "crewsService">,
  request: OwnerRpcRequest,
): Promise<void> {
  switch (request.input.method) {
    case "crews.active.list":

    case "crews.member.ask":

    case "crews.list":

    case "crews.schema":

    case "crews.inspect":

    case "crews.save":

    case "crews.delete":

    case "crews.deleteRun":

    case "crews.agent.save":

    case "crews.agent.delete":

    case "crews.start":

    case "crews.get":

    case "crews.assign":

    case "crews.request":

    case "crews.resolve":

    case "crews.respond":

    case "crews.answer":

    case "crews.pause":

    case "crews.stop":

    case "crews.resume":

    case "crews.accept":

    case "crews.finish":
      request.result = await dependencies.crewsService.call(
        request.input.method,
        request.params,
        request.domainContext,
        {
          legacy: true,
        },
      );
      break;
  }
}
