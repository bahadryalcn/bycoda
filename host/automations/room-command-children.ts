import { createHash } from "node:crypto";
import type { HostStore } from "../store";
import type { RoomManagementCall } from "../assistant/management/assistant-management-turn";
import { RoomCommandRetiredError, withRoomCommandLifetime } from "./room-command-lifetime";
type Intent = { requestId: string; workId: string; occurrence: string; hash: string };

/** In-memory handles stop exact original processes; durable intents forbid restart replay. */
export class RoomAutomationCommandChildren {
  private readonly live = new Map<string, { intent: Intent; controller: AbortController }>();
  constructor(
    private readonly store: HostStore,
    private readonly active: (intent: Intent) => Promise<boolean>,
  ) {}
  private async intents(): Promise<Intent[]> {
    const rows = await this.store.db
      .prepare("SELECT value FROM metadata WHERE key LIKE 'room-command-child:%'")
      .all();
    return rows.map((row) => JSON.parse(String(row.value)) as Intent);
  }
  async withChild<T>(
    call: RoomManagementCall,
    parent: { workId?: string; occurrence?: string },
    signal: AbortSignal,
    authorized: () => Promise<boolean>,
    effect: () => Promise<T>,
  ): Promise<T> {
    if (!parent.workId || !parent.occurrence)
      throw new Error("Room command original Work is unavailable.");
    const intent: Intent = {
      requestId: call.requestId,
      workId: parent.workId,
      occurrence: parent.occurrence,
      hash: createHash("sha256").update(JSON.stringify(call)).digest("hex"),
    };
    await this.store.transaction(async () => {
      if (!(await authorized()) || !(await this.active(intent)))
        throw new Error("Room command parent was stopped.");
      const result = await this.store.db
        .prepare("INSERT OR IGNORE INTO metadata(key,value) VALUES(?,?)")
        .run(`room-command-child:${intent.requestId}`, JSON.stringify(intent));
      if (Number(result.changes) !== 1)
        throw new Error("Room command already has its original process; never replay it.");
    }, "critical");
    const controller = new AbortController();
    this.live.set(intent.requestId, { intent, controller });
    let safe = false;
    try {
      const combined = AbortSignal.any([signal, controller.signal]);
      if (!(await authorized()) || !(await this.active(intent))) controller.abort();
      const result = await withRoomCommandLifetime(combined, effect);
      safe = true;
      return result;
    } catch (error) {
      if (error instanceof RoomCommandRetiredError) safe = true;
      throw error;
    } finally {
      if (safe) this.live.delete(intent.requestId);
    }
  }
  async stop(occurrence: string) {
    for (const value of this.live.values())
      if (value.intent.occurrence === occurrence) value.controller.abort();
  }
  async occurrences() {
    return [...new Set((await this.intents()).map((intent) => intent.occurrence))];
  }
}
