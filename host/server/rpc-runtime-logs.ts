import type { ServerBindings } from "./bindings";
import type { OwnerRpcRequest } from "./owner-rpc-context";
export async function handleRuntimeLogsRpc(
  dependencies: Pick<
    ServerBindings,
    "engine" | "logMonitors" | "refreshLogSources" | "featureMeta" | "runtimeLogs"
  >,
  request: OwnerRpcRequest,
): Promise<void> {
  switch (request.input.method) {
    case "runtimeLogs.monitors.list":

    case "runtimeLogs.monitors.start":

    case "runtimeLogs.monitors.stop": {
      const projectId = String(request.params.projectId ?? "");
      await dependencies.engine.store.project(projectId);
      if (request.input.method === "runtimeLogs.monitors.start")
        request.result = await dependencies.logMonitors.start(projectId, request.params.url);
      else if (request.input.method === "runtimeLogs.monitors.stop") {
        await dependencies.logMonitors.stop(projectId, String(request.params.id ?? ""));
        request.result = { stopped: true };
      } else request.result = dependencies.logMonitors.list(projectId);
      break;
    }

    case "runtimeLogs.read":

    case "runtimeLogs.sources": {
      await dependencies.refreshLogSources();
      if (request.params.projectId !== undefined)
        await dependencies.engine.store.project(String(request.params.projectId));
      if (request.params.sessionId !== undefined) {
        const session = await dependencies.featureMeta(String(request.params.sessionId));
        if (
          request.params.projectId !== undefined &&
          session.projectId !== request.params.projectId
        )
          throw new Error("Runtime logs belong to another project");
      }
      request.result =
        request.input.method === "runtimeLogs.sources"
          ? dependencies.runtimeLogs.sources(request.params)
          : dependencies.runtimeLogs.read(request.params);
      break;
    }
  }
}
