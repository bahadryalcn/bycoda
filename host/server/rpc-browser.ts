import type { ServerBindings } from "./bindings";
import type { OwnerRpcRequest } from "./owner-rpc-context";

export async function resolveBrowserScope(
  dependencies: Pick<ServerBindings, "engine" | "featureMeta">,
  params: Record<string, unknown>,
) {
  if (params.ownerPresentationScope !== undefined) return params;
  if (params.projectId !== undefined)
    await dependencies.engine.store.project(String(params.projectId));
  if (params.sessionId === undefined) return params;
  const session = await dependencies.featureMeta(String(params.sessionId));
  if (params.projectId !== undefined && session.projectId !== params.projectId)
    throw new Error("Browser belongs to another project");
  return { ...params, projectId: session.projectId };
}
export async function handleBrowserRpc(
  dependencies: Pick<ServerBindings, "engine" | "browserRuntime" | "sharedBrowser" | "featureMeta">,
  request: OwnerRpcRequest,
): Promise<void> {
  switch (request.input.method) {
    case "browser.profiles.list":
    case "browser.profiles.update": {
      const profiles = dependencies.sharedBrowser.profiles;
      if (!profiles) throw new Error("Browser profiles are unavailable on this Host.");
      request.result =
        request.input.method === "browser.profiles.list"
          ? await profiles.list()
          : await profiles.update(request.params.action, request.params.value);
      break;
    }

    case "browser.setup":
      // Explicit machine tools are authorized by the paired host credential.
      // When a conversation project is supplied, retain its validation.
      if (request.params.projectId !== undefined)
        await dependencies.engine.store.project(String(request.params.projectId ?? ""));
      await dependencies.browserRuntime.setup();
      request.result = await dependencies.browserRuntime.describe(
        await dependencies.sharedBrowser.dispatch("browser.status", request.params, request.token),
      );
      break;

    case "browser.status":

    case "browser.claim":

    case "browser.release":

    case "browser.open":

    case "browser.resize":

    case "browser.frame":

    case "browser.input":

    case "browser.close": {
      const browserParams = await resolveBrowserScope(dependencies, request.params);
      // Only paired owner RPCs may explicitly take control. Conversation
      // tools use dispatchForSession and cannot enable this option.
      request.result = await dependencies.browserRuntime.describe(
        await dependencies.sharedBrowser.dispatch(
          request.input.method,
          browserParams,
          request.token,
          {
            takeover: request.input.method === "browser.claim" && request.params.takeover === true,
          },
        ),
      );
      break;
    }

    case "browser.annotation.start":

    case "browser.annotation.hover":

    case "browser.annotation.select":

    case "browser.annotation.parent":

    case "browser.annotation.traverse":

    case "browser.annotation.clear":

    case "browser.annotation.read":

    case "browser.annotation.cancel": {
      const projectId = String(request.params.projectId ?? "");
      if (request.params.ownerPresentationScope === undefined) {
        await dependencies.engine.store.project(projectId);
        if (
          (await dependencies.featureMeta(String(request.params.sessionId ?? ""))).projectId !==
          projectId
        )
          throw new Error("Conversation belongs to another project");
      } else if (
        !projectId ||
        typeof request.params.sessionId !== "string" ||
        !request.params.sessionId
      ) {
        throw new Error("Owner browser presentation requires project and conversation identity");
      }
      request.result = await dependencies.sharedBrowser.dispatch(
        request.input.method,
        request.params,
        request.token,
      );
      break;
    }
  }
}
