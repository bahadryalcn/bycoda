import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import type { HostStore } from "../store";
import type { ServerBindings } from "../server/bindings";
import type { RoomManagementCall } from "../assistant/management/assistant-management-turn";
import { RoomToolRetiredError } from "./room-command-lifetime";
type Terminal = { id: string; projectId: string; createdAt: number; cwd: string };
type Intent = {
  requestId: string;
  hash: string;
  workId: string;
  occurrence: string;
  runtime: string;
  terminal?: Terminal;
  owner?: string;
  closed?: boolean;
};
const captures = new AsyncLocalStorage<(terminal: Terminal, owner: string) => Promise<void>>();

/** Real pipe owner supplies identity before any creation reply is exposed. */
export async function captureRoomTerminalChild(terminal: Terminal, owner: string) {
  await captures.getStore()?.(terminal, owner);
}

export class RoomAutomationTerminalChildren {
  private readonly runtime = randomUUID();
  constructor(
    private readonly store: HostStore,
    private readonly active: (intent: Intent) => Promise<boolean>,
    private readonly terminals: () => ServerBindings["terminals"],
  ) {}
  private async intents(): Promise<Intent[]> {
    const rows = await this.store.db
      .prepare("SELECT value FROM metadata WHERE key LIKE 'room-terminal-child:%'")
      .all();
    return rows.map((row) => JSON.parse(String(row.value)) as Intent);
  }
  private async write(intent: Intent) {
    await this.store.db
      .prepare("UPDATE metadata SET value=? WHERE key=?")
      .run(JSON.stringify(intent), `room-terminal-child:${intent.requestId}`);
  }
  async withChild<T>(
    call: RoomManagementCall,
    parent: { workId?: string; occurrence?: string },
    authorized: () => Promise<boolean>,
    effect: () => Promise<T>,
  ): Promise<T> {
    if (!parent.workId || !parent.occurrence || !call.projectId)
      throw new Error("Room terminal original Work and project are required.");
    if (call.action === "terminals.write") {
      const owned = (await this.intents()).find(
        (intent) =>
          intent.workId === parent.workId &&
          intent.occurrence === parent.occurrence &&
          !!intent.terminal &&
          intent.terminal.id === call.input.terminalId &&
          intent.terminal.projectId === call.projectId &&
          !intent.closed,
      );
      if (!owned || owned.runtime !== this.runtime || !owned.owner || !(await this.active(owned)))
        throw new Error("Room may write only its original occurrence's proven terminal process.");
      const current = this.terminals()
        .list(call.projectId, owned.owner)
        .terminals.find((terminal) => terminal.id === owned.terminal!.id);
      if (
        !current ||
        current.createdAt !== owned.terminal!.createdAt ||
        current.cwd !== owned.terminal!.cwd
      )
        throw new Error("Room terminal physical identity changed.");
      if (!(await authorized())) throw new Error("Room terminal parent was stopped.");
      const accepted = await this.store.db
        .prepare("INSERT OR IGNORE INTO metadata(key,value) VALUES(?,?)")
        .run(
          `room-terminal-write:${call.requestId}`,
          JSON.stringify({
            requestId: call.requestId,
            hash: createHash("sha256").update(JSON.stringify(call)).digest("hex"),
            workId: parent.workId,
            occurrence: parent.occurrence,
            terminalId: current.id,
            createdAt: current.createdAt,
            creationRequestId: owned.requestId,
          }),
        );
      if (Number(accepted.changes) !== 1)
        throw new Error("Room terminal input already has its original operation; never replay it.");
      try {
        return await effect();
      } catch (error) {
        if (!(await this.active(owned))) {
          await this.stopIntent(owned);
          if (owned.closed)
            throw new RoomToolRetiredError(
              error instanceof Error ? error.message : "Room terminal input was stopped.",
            );
        }
        throw error;
      } finally {
        if (!(await this.active(owned))) await this.stopIntent(owned);
      }
    }
    const intent: Intent = {
      requestId: call.requestId,
      hash: createHash("sha256").update(JSON.stringify(call)).digest("hex"),
      workId: parent.workId,
      occurrence: parent.occurrence,
      runtime: this.runtime,
    };
    await this.store.transaction(async () => {
      if (!(await authorized()) || !(await this.active(intent)))
        throw new Error("Room terminal parent was stopped.");
      const saved = await this.store.db
        .prepare("INSERT OR IGNORE INTO metadata(key,value) VALUES(?,?)")
        .run(`room-terminal-child:${intent.requestId}`, JSON.stringify(intent));
      if (Number(saved.changes) !== 1)
        throw new Error("Room terminal already has its original creation; never replay it.");
    }, "critical");
    try {
      return await captures.run(
        async (terminal, owner) => {
          if (terminal.projectId !== call.projectId)
            throw new Error("Room terminal project changed.");
          intent.terminal = terminal;
          intent.owner = owner;
          await this.write(intent);
          if (!(await this.active(intent))) await this.stopIntent(intent);
        },
        async () => {
          if (!(await authorized()) || !(await this.active(intent)))
            throw new Error("Room terminal parent was stopped before creation.");
          return effect();
        },
      );
    } catch (error) {
      if (!(await this.active(intent))) {
        await this.stopIntent(intent);
        if (intent.closed)
          throw new RoomToolRetiredError(
            error instanceof Error ? error.message : "Room terminal creation was stopped.",
          );
      }
      throw error;
    } finally {
      if (!(await this.active(intent))) await this.stopIntent(intent);
    }
  }
  private async stopIntent(intent: Intent) {
    if (intent.closed || !intent.terminal || !intent.owner) return;
    if (intent.runtime !== this.runtime)
      throw new Error("Room terminal original physical retirement is unknown after restart.");
    const current = this.terminals()
      .list(intent.terminal.projectId, intent.owner)
      .terminals.find((terminal) => terminal.id === intent.terminal!.id);
    if (current) {
      if (current.createdAt !== intent.terminal.createdAt || current.cwd !== intent.terminal.cwd)
        throw new Error("Room terminal identity changed before Stop.");
      await this.terminals().remove(intent.terminal.projectId, intent.terminal.id, intent.owner);
    }
    intent.closed = true;
    await this.write(intent);
  }
  async stop(occurrence: string) {
    for (const intent of (await this.intents()).filter((value) => value.occurrence === occurrence))
      await this.stopIntent(intent);
  }
  async occurrences() {
    return [
      ...new Set(
        (await this.intents())
          .filter((intent) => !intent.closed)
          .map((intent) => intent.occurrence),
      ),
    ];
  }
  async recover() {
    for (const intent of await this.intents())
      if (!(await this.active(intent))) await this.stopIntent(intent);
  }
}
