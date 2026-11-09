import type { HostAssistant } from "../assistant/service";
import { listModelPool, type ModelPoolSource } from "./conversation-model-pool-guard";

/** Reads the pool through the Assistant's own read operation, so saved and derived pools agree. */
export function assistantModelPoolSource(
  assistant: Pick<HostAssistant, "request">,
): ModelPoolSource {
  return async () => {
    const { modelPool } = await assistant.request({ op: "models.pool.get" }, "assistant");
    if (!modelPool) throw new Error("The assistant's model pool is unavailable.");
    return modelPool;
  };
}

export const MODEL_POOL_CONVERSATION_TOOLS = {
  "models.pool.list": {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },
} as const;
export const isModelPoolConversationTool = (action: string) =>
  Object.hasOwn(MODEL_POOL_CONVERSATION_TOOLS, action);
export function describeModelPoolConversationTool(action: string): string | undefined {
  if (action === "models.pool.list")
    return "List the owner's assistant model pool: rows with id, harness, model, effort setting, account and roles. Pass a row id as execution.poolRowId when creating tasks, goals or automations; models outside the pool are rejected. Read-only.";
  return undefined;
}
/** Read-only; the pool is application metadata, never project data. */
export async function callModelPoolTool(
  action: string,
  input: Record<string, unknown>,
  pool: ModelPoolSource,
) {
  if (action !== "models.pool.list" || Object.keys(input).length)
    throw new Error("Unsupported model pool tool.");
  return listModelPool(await pool());
}
