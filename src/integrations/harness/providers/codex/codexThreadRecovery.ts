import type { JsonRpcWriterView } from "../turnWriter";

export class CodexArchivedThreadError extends Error {
  constructor(
    readonly threadId: string,
    readonly cause: unknown,
  ) {
    super(
      `Codex session ${threadId} is archived: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = "CodexArchivedThreadError";
  }
}

/** Called only during an explicitly requested continuation, before turn/start. */
export async function resumeCodexThread<T extends { thread?: { id?: string } }>(
  rpc: Pick<JsonRpcWriterView, "request">,
  threadId: string,
  params: Record<string, unknown>,
  timeoutMs: number,
): Promise<T> {
  const resume = () => rpc.request<T>("thread/resume", params, timeoutMs);
  let result: T;
  try {
    result = await resume();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const expected = `session ${threadId} is archived.`;
    if (!message.includes(expected)) throw error;
    const archived = new CodexArchivedThreadError(threadId, error);
    // Never retry an uncertain restore: a timeout may have changed provider state.
    const restored = await rpc
      .request<{ thread?: { id?: string } }>("thread/unarchive", { threadId }, timeoutMs)
      .catch((cause: unknown) => {
        throw new CodexArchivedThreadError(threadId, cause);
      });
    if (restored.thread?.id !== threadId) throw archived;
    result = await resume();
  }
  if (result.thread?.id !== threadId) {
    throw new Error(`Codex returned a different or missing thread identity for ${threadId}`);
  }
  return result;
}
