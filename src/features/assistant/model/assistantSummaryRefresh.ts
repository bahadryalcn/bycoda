import { z } from "zod";
import type {
  AssistantRequest,
  AssistantResponse,
} from "../../../shared/model/host-contracts/assistant";
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
const id = z.string().min(1).max(200);
const intentSchema = z.strictObject({
  format: z.literal(1),
  environmentId: id,
  threadId: id,
  requestId: id,
});
const key = (environmentId: string, threadId: string) =>
  `bycoda.assistant.summary-refresh:${encodeURIComponent(JSON.stringify([environmentId, threadId]))}`;
export function hasAssistantSummaryRefresh(
  storage: Storage,
  environmentId: string | undefined,
  threadId: string,
) {
  try {
    return !!environmentId && !!storage.getItem(key(environmentId, threadId));
  } catch {
    return false;
  }
}
/** Retain the original pure-text request through a lost acknowledgement and reload. */
export async function refreshAssistantSummary(
  storage: Storage,
  environmentId: string,
  threadId: string,
  request: (input: AssistantRequest, environmentId: string) => Promise<AssistantResponse>,
  current: () => boolean,
) {
  id.parse(environmentId);
  id.parse(threadId);
  if (!current()) throw new Error("The conversation source changed.");
  const recordKey = key(environmentId, threadId),
    saved = storage.getItem(recordKey);
  const intent = saved
    ? intentSchema.parse(JSON.parse(saved))
    : intentSchema.parse({ format: 1, environmentId, threadId, requestId: crypto.randomUUID() });
  if (intent.environmentId !== environmentId || intent.threadId !== threadId)
    throw new Error("The conversation source changed.");
  const encoded = JSON.stringify(intent);
  storage.setItem(recordKey, encoded);
  if (!current()) throw new Error("The conversation source changed.");
  const result = await request(
    { op: "threads.summary.refresh", threadId, requestId: intent.requestId },
    environmentId,
  );
  if (!current() || result.thread?.id !== threadId || !result.thread.summaryState)
    throw new Error("Summary refresh was not confirmed.");
  if (storage.getItem(recordKey) === encoded) storage.removeItem(recordKey);
  return result.thread;
}
