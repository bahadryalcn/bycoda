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

export const isModelPoolConversationTool = (action: string) => action === "models.pool.list";
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
