import { createHash } from "node:crypto";
import type { HostStore } from "./store";
import type { HostSession } from "../src/features/connections/model/protocol";

/** Internal scheduling deferral, never accepted from an RPC payload or model text. */
export class AssistantTurnPolicyDeferredError extends Error {
  constructor() {
    super(
      "Assistant work is outside its current execution policy. Accepted turns may finish; new turns wait for eligible hours and budget.",
    );
    this.name = "AssistantTurnPolicyDeferredError";
  }
}
const key = (sessionId: string, runId: string) =>
  `assistant.turn-deferred:v1:${sessionId}:${runId}`;
function source(record: HostSession) {
  const session = record.session;
  return createHash("sha256")
    .update(
      JSON.stringify([
        record.projectId,
        record.authorityGeneration,
        session.cwd,
        session.worktreeCwd,
        session.harness,
        session.providerAccountId ?? "default",
        session.model,
        session.modelSettings,
        session.runtimeMode,
        session.blocks.findLast((block) => block.role === "user")?.id,
      ]),
    )
    .digest("hex");
}
export async function recordDeferredAssistantTurn(
  store: HostStore,
  sessionId: string,
  runId: string,
  authorId: string,
  notEntered: () => boolean,
) {
  await store.transaction(async () => {
    const record = await store.session(sessionId);
    if (!notEntered() || record.runId !== runId || record.status !== "running") return;
    await store.db.prepare("INSERT OR IGNORE INTO metadata(key,value) VALUES(?,?)").run(
      key(sessionId, runId),
      JSON.stringify({
        version: 1,
        sessionId,
        runId,
        authorId,
        source: source(record),
        knownZero: true,
      }),
    );
  }, "critical");
}
/** Requeue only an unchanged exact run that the actual Engine fenced before entry. */
export async function deferredAssistantTurn(
  store: HostStore,
  sessionId: string | undefined,
  runId: string | undefined,
  authorId: string,
): Promise<boolean> {
  if (!sessionId || !runId) return false;
  const row = await store.db
    .prepare("SELECT value FROM metadata WHERE key=?")
    .get(key(sessionId, runId));
  if (!row) return false;
  try {
    const receipt = JSON.parse(row.value),
      record = await store.session(sessionId);
    return (
      receipt.version === 1 &&
      receipt.knownZero === true &&
      receipt.sessionId === sessionId &&
      receipt.runId === runId &&
      receipt.authorId === authorId &&
      record.runId === runId &&
      ["interrupted", "failed"].includes(record.status) &&
      receipt.source === source(record)
    );
  } catch {
    return false;
  }
}
