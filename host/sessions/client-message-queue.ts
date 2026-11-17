import type { HostStore } from "../store";
import { clientMessageCommand } from "./client-message-id";

/** Queue append and its receipt commit together, including when the row drains before retry. */
export async function clientMessageQueue<T>(
  store: HostStore,
  params: Record<string, unknown>,
  work: () => Promise<T>,
  authorize: () => Promise<void>,
): Promise<T> {
  const before = params.before as { messages?: { id: string }[] } | undefined;
  const after = params.after as { messages?: Record<string, unknown>[] } | undefined;
  const added = after?.messages?.filter(
    (row) => !before?.messages?.some((old) => old.id === row.id),
  );
  const row = added?.find((value) => value.clientMessageId !== undefined);
  if (!row) return work();
  clientMessageCommand({
    type: "send",
    sessionId: params.sessionId,
    clientMessageId: row.clientMessageId,
  });
  if (added?.length !== 1 || row.id !== row.clientMessageId)
    throw new Error("Invalid outbox queue append");
  const scope = `mobile-outbox-queue:${String(params.sessionId)}`;
  const id = String(row.id).toLowerCase();
  const { clientMessageId: _clientMessageId, sessionId: _sessionId, ...fields } = row;
  const message = { ...fields, id };
  return store.transaction(async () => {
    await authorize();
    const previous = await store.workspaceReceipt<T>(scope, id, message, { admit: true });
    if (previous !== null) return previous;
    if ((await store.session(String(params.sessionId))).archived)
      throw new Error("Session is archived");
    const result = await work();
    await store.saveWorkspaceReceipt(scope, id, message, result);
    await authorize();
    return result;
  }, "critical");
}
