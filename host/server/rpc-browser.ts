import type { ServerBindings } from "./bindings";
import type { OwnerRpcRequest } from "./owner-rpc-context";
export async function handleBrowserRpc(
  dependencies: Pick<ServerBindings, "engine" | "browserRuntime" | "sharedBrowser" | "featureMeta">,
  request: OwnerRpcRequest,
): Promise<void> {
  switch (request.input.method) {
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
      if (
        request.params.ownerPresentationScope === undefined &&
        request.params.projectId !== undefined
      )
        await dependencies.engine.store.project(String(request.params.projectId));
      let browserParams = request.params;
      if (
        request.params.ownerPresentationScope === undefined &&
        request.params.sessionId !== undefined
      ) {
        const session = await dependencies.featureMeta(String(request.params.sessionId));
        if (
          request.params.projectId !== undefined &&
          session.projectId !== request.params.projectId
        )
          throw new Error("Browser belongs to another project");
        browserParams = { ...request.params, projectId: session.projectId };
      }
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
