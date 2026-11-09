import type { ServerResponse } from "node:http";
import { runtimeLogToolQuery, type RuntimeLogSubjectPrincipal } from "./runtime-log-tools";
import { callLogWait, type RuntimeLogWaiter } from "./runtime-log-wait";
import type { RuntimeLogsService } from "./runtime-logs";

/** Conversation-tool actions served from the runtime log store. */
export const RUNTIME_LOG_CONVERSATION_ACTIONS: ReadonlySet<string> = new Set([
  "terminals.read",
  "logs.sources",
  "logs.read",
  "logs.wait",
]);

/** Dispatches one conversation log action for a verified principal. */
export async function callRuntimeLogAction(
  deps: {
    runtimeLogs: RuntimeLogsService;
    runtimeLogWaiter: RuntimeLogWaiter;
    refreshLogSources: () => Promise<unknown>;
    conversationAccess: { principalForToken(token: string): Promise<unknown> };
  },
  request: { response: Pick<ServerResponse, "once" | "off">; token: string },
  action: string,
  args: Record<string, unknown>,
  principal: RuntimeLogSubjectPrincipal,
): Promise<unknown> {
  if (action === "terminals.read")
    return deps.runtimeLogs.read({
      projectId: principal.projectId,
      source: "server",
      sourceId: `server:terminal:${args.terminalId}`,
      after: args.after as number | undefined,
      limit: args.limit as number | undefined,
    });
  if (action === "logs.wait") return callLogWait(deps, request, args, principal);
  if (action !== "logs.sources" && action !== "logs.read")
    throw new Error("Unsupported runtime log action.");
  await deps.refreshLogSources();
  const query = runtimeLogToolQuery(action === "logs.read" ? "read" : "sources", args, principal);
  return action === "logs.read" ? deps.runtimeLogs.read(query) : deps.runtimeLogs.sources(query);
}
