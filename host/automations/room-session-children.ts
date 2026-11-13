import { createHash } from "node:crypto";
import type { HostStore } from "../store";
import type { HostEngine } from "../engine";
import type { RoomManagementCall } from "../assistant/management/assistant-management-turn";
import { roomSessionCommandId } from "../assistant/room/assistant-room-session";
import { cancelSessionWorkOccurrence, cancelSessionWorkRun } from "../work/session-adapter";

type Intent = {
  requestId: string;
  hash: string;
  workId: string;
  occurrence: string;
  threadId: string;
  projectId: string;
  sessionId: string;
  commandId: string;
  runId?: string;
};

/** Session submission keeps its real shared-Work command and exact accepted run. */
export class RoomAutomationSessionChildren {
  constructor(
    private readonly store: HostStore,
    private readonly active: (parent: { workId: string; occurrence: string }) => Promise<boolean>,
    private readonly engine: () => Pick<HostEngine, "command">,
  ) {}
  private async rows(): Promise<Intent[]> {
    const rows = await this.store.db
      .prepare("SELECT value FROM metadata WHERE key LIKE 'room-session-child:%'")
      .all();
    return rows.map((row) => JSON.parse(String(row.value)) as Intent);
  }
  async withChild<T>(
    call: RoomManagementCall,
    parent: { workId?: string; occurrence?: string },
    authorized: () => Promise<boolean>,
    effect: () => Promise<T>,
  ): Promise<T> {
    if (
      !parent.workId ||
      !parent.occurrence ||
      !call.projectId ||
      typeof call.input.sessionId !== "string"
    )
      throw new Error("Room session requires its original Work and explicit target.");
    const session = await this.store.session(call.input.sessionId);
    if (session.projectId !== call.projectId || session.status === "running")
      throw new Error("Room cannot take over a foreign or active session run.");
    const intent: Intent = {
      requestId: call.requestId,
      hash: createHash("sha256").update(JSON.stringify(call)).digest("hex"),
      workId: parent.workId,
      occurrence: parent.occurrence,
      threadId: call.threadId,
      projectId: call.projectId,
      sessionId: call.input.sessionId,
      commandId: roomSessionCommandId(
        { threadId: call.threadId, projectId: call.projectId },
        call.requestId,
      ),
    };
    const key = `room-session-child:${call.requestId}`;
    await this.store.transaction(async () => {
      if (!(await authorized()) || !(await this.active(intent)))
        throw new Error("Room session parent was stopped.");
      const created = await this.store.db
        .prepare("INSERT OR IGNORE INTO metadata(key,value) VALUES(?,?)")
        .run(key, JSON.stringify(intent));
      if (Number(created.changes) !== 1)
        throw new Error(
          "Room session already has an original submission; inspect it instead of replaying.",
        );
    }, "critical");
    try {
      if (!(await authorized()) || !(await this.active(intent)))
        throw new Error("Room session parent was stopped before dispatch.");
      return await effect();
    } finally {
      await this.bind(intent);
      if (!(await this.active(intent))) await this.stopIntent(intent);
    }
  }
  private async bind(intent: Intent) {
    const receipt = await this.store.receiptStatus(intent.commandId);
    if (!receipt) return;
    if (receipt.sessionId !== intent.sessionId || !receipt.runId)
      throw new Error("Room session accepted identity changed.");
    intent.runId = receipt.runId;
    await this.store.db
      .prepare("UPDATE metadata SET value=? WHERE key=?")
      .run(JSON.stringify(intent), `room-session-child:${intent.requestId}`);
  }
  async allowed(sessionId: string, runId: string | undefined, requestId: string): Promise<boolean> {
    const row = await this.store.db
      .prepare("SELECT value FROM metadata WHERE key=?")
      .get(`room-session-child:${requestId}`);
    if (!row) return true;
    const intent = JSON.parse(String(row.value)) as Intent;
    await this.bind(intent);
    return (
      intent.sessionId === sessionId &&
      !!runId &&
      intent.runId === runId &&
      (await this.active(intent))
    );
  }
  private async stopIntent(intent: Intent) {
    await this.bind(intent);
    await cancelSessionWorkOccurrence(this.store, {
      kind: "assistant",
      id: `room:${intent.threadId}`,
      occurrence: intent.commandId,
    });
    if (!intent.runId) return;
    const current = await this.store.session(intent.sessionId).catch(() => undefined);
    if (
      !current ||
      current.projectId !== intent.projectId ||
      current.runId !== intent.runId ||
      current.status !== "running"
    )
      return;
    if (
      !(await cancelSessionWorkRun(this.store, {
        sessionId: intent.sessionId,
        runId: intent.runId,
      }))
    )
      await this.engine().command({
        type: "cancel",
        commandId: `room-parent-stop:${intent.commandId}`,
        sessionId: intent.sessionId,
        runId: intent.runId,
      });
  }
  async stop(occurrence: string) {
    for (const intent of (await this.rows()).filter((row) => row.occurrence === occurrence))
      await this.stopIntent(intent);
  }
  async occurrences() {
    return [...new Set((await this.rows()).map((row) => row.occurrence))];
  }
  async recover() {
    for (const intent of await this.rows())
      if (!(await this.active(intent))) await this.stopIntent(intent);
  }
}
