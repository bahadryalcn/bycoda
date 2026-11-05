import { randomUUID } from "node:crypto";
import type { WorkspaceRpcRequest } from "../workspaces/workspace-rpc-contracts";
import type { ServerBindings } from "./bindings";
import type { OwnerRpcRequest } from "./owner-rpc-context";
export async function handleProjectsRpc(
  dependencies: Pick<
    ServerBindings,
    "engine" | "workspacePolicy" | "projectsService" | "scopedDesktopCall"
  >,
  request: OwnerRpcRequest,
): Promise<void> {
  switch (request.input.method) {
    case "projects.workspacePolicy.get":
    case "projects.workspacePolicy.update": {
      await dependencies.engine.store.project(String(request.params.projectId ?? ""));
      if (request.params.environmentId !== dependencies.engine.store.environmentId)
        throw new Error("Workspace policy belongs to another execution host");
      request.result =
        request.input.method === "projects.workspacePolicy.get"
          ? await dependencies.workspacePolicy.get(
              request.params as unknown as WorkspaceRpcRequest<"projects.workspacePolicy.get">,
            )
          : await dependencies.workspacePolicy.update(
              request.params as unknown as WorkspaceRpcRequest<"projects.workspacePolicy.update">,
              {
                ownerId: request.tokenHash,
                authorizationId: randomUUID(),
              },
            );
      break;
    }
    case "projects.list":
      request.result = await dependencies.projectsService.list({}, request.domainContext);
      break;
    case "projects.directory":
      request.result = await dependencies.projectsService.directory(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;
    case "projects.browse":
      request.result = await dependencies.projectsService.browse(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;
    case "projects.createDirectory":
      request.result = await dependencies.projectsService.createDirectory(
        request.params,
        request.domainContext,
        {
          legacy: true,
        },
      );
      break;
    case "projects.open":
      request.result = await dependencies.projectsService.open(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;
    case "projects.organization.read":
    case "projects.organization.patch":
    case "projects.organization.status": {
      const mode = request.input.method.slice("projects.organization.".length);
      request.result = await dependencies.scopedDesktopCall(
        request.token,
        `organization.${mode}`,
        request.params,
        mode === "patch"
          ? ["expectedRevision", "operationId", "change"]
          : mode === "status"
            ? ["operationId"]
            : [],
      );
      break;
    }
    case "preferences.desktop.read":
    case "preferences.desktop.template.read":
    case "preferences.desktop.patch":
    case "preferences.desktop.status": {
      const mode = request.input.method.slice("preferences.desktop.".length);
      const action = mode === "template.read" ? "templateRead" : mode;
      request.result = await dependencies.scopedDesktopCall(
        request.token,
        `preferences.${action}`,
        request.params,
        mode === "template.read"
          ? ["templateId", "expectedRevision"]
          : mode === "patch"
            ? ["operationId", "expectedRevision", "change"]
            : mode === "status"
              ? ["operationId"]
              : [],
      );
      break;
    }
  }
}
