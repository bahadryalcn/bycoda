import type { ServerBindings } from "./bindings";
import type { OwnerRpcRequest } from "./owner-rpc-context";
export async function handleNotesRpc(
  dependencies: Pick<ServerBindings, "notesService">,
  request: OwnerRpcRequest,
): Promise<void> {
  switch (request.input.method) {
    case "notes.list":
      request.result = await dependencies.notesService.list(request.params, request.domainContext, {
        legacy: true,
      });
      break;

    case "notes.get":
      request.result = await dependencies.notesService.get(request.params, request.domainContext, {
        legacy: true,
      });
      break;

    case "notes.upsert":
      request.result = await dependencies.notesService.upsert(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;

    case "notes.delete":
      request.result = await dependencies.notesService.delete(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;
  }
}
