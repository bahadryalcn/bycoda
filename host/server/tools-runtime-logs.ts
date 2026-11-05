import { runtimeLogToolQuery } from "../execution/runtime-log-tools";
import type { ServerBindings } from "./bindings";
import type { HttpToolRequest } from "./http-tool-context";
export async function handleRuntimeLogsTools(
  dependencies: Pick<ServerBindings, "refreshLogSources" | "runtimeLogAccess" | "runtimeLogs">,
  request: Pick<HttpToolRequest, "runtimePrincipal" | "token" | "params" | "result" | "endResult">,
) {
  if (!request.runtimePrincipal) throw new Error("A scoped session log credential is required.");
  await dependencies.refreshLogSources();
  if (!(await dependencies.runtimeLogAccess.principalForToken(request.token)))
    throw new Error("Session authority revoked.");
  const action = String(request.params.action ?? "");
  const query = runtimeLogToolQuery(
    action,
    request.params.input &&
      typeof request.params.input === "object" &&
      !Array.isArray(request.params.input)
      ? (request.params.input as Record<string, unknown>)
      : {},
    request.runtimePrincipal,
  );
  request.result =
    action === "sources" || action === "runtimeLogs.sources"
      ? dependencies.runtimeLogs.sources(query)
      : dependencies.runtimeLogs.read(query);
  await request.endResult(request.result, async () => {
    if (!(await dependencies.runtimeLogAccess.principalForToken(request.token)))
      throw new Error("Session authority revoked.");
  });
  return;
}
