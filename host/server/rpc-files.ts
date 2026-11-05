import type { ServerBindings } from "./bindings";
import type { OwnerRpcRequest } from "./owner-rpc-context";
export async function handleFilesRpc(
  dependencies: Pick<ServerBindings, "fileService" | "nativeServicesService" | "workspace">,
  request: OwnerRpcRequest,
): Promise<void> {
  switch (request.input.method) {
    case "files.read":
      request.result = await dependencies.fileService.read(request.params, request.domainContext, {
        legacy: true,
      });
      break;

    case "files.list":
      request.result = await dependencies.fileService.list(request.params, request.domainContext, {
        legacy: true,
      });
      break;

    case "files.index":
      request.result = await dependencies.fileService.index(request.params, request.domainContext, {
        legacy: true,
      });
      break;

    case "workspace.run":
      if (request.params.command === "format_text_file") {
        request.result = await dependencies.nativeServicesService.call(
          "native.services.workspace.format",
          request.params,
          request.domainContext,
          { legacy: true },
        );
        break;
      }
      request.result =
        (await dependencies.workspace.run(
          request.params.command,
          request.params.args,
          request.tokenHash,
        )) ?? null;
      break;

    case "files.search":
      request.result = await dependencies.fileService.search(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;

    case "files.searchContent":
      request.result = await dependencies.fileService.searchContent(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;

    case "files.create":
      request.result = await dependencies.fileService.create(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;

    case "files.write":
      request.result = await dependencies.fileService.write(request.params, request.domainContext, {
        legacy: true,
      });
      break;
  }
}
