import type { ServerBindings } from "./bindings";
import type { HttpToolRequest } from "./http-tool-context";
import { dispatchConversationTools } from "./tools-conversation";

type Dependencies = Parameters<typeof dispatchConversationTools>[0];

/**
 * Every Conversation Tool result and error leaves through here, so a saved secret value
 * (and its encoded forms) never reaches the agent, whichever tool produced it.
 */
export async function handleConversationTools(
  dependencies: Dependencies & Pick<ServerBindings, "conversationSecrets">,
  request: Parameters<typeof dispatchConversationTools>[1],
) {
  const projectId = request.conversationPrincipal?.projectId;
  const redact = async <T>(value: T): Promise<T> =>
    projectId ? await dependencies.conversationSecrets.redact(projectId, value) : value;
  // The live request exposes getter/setter accessors (endResult is getter-only), so the override
  // is defined as an own property; plain assignment would throw in strict mode.
  const guarded = Object.create(request) as typeof request;
  Object.defineProperty(guarded, "endResult", {
    value: async (...args: Parameters<HttpToolRequest["endResult"]>) =>
      await request.endResult(await redact(args[0]), args[1], args[2]),
  });
  try {
    return await dispatchConversationTools(dependencies, guarded);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    const message = await redact(error.message);
    if (message === error.message) throw error;
    throw Object.assign(new Error(message), { name: error.name });
  }
}
