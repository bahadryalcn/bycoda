import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { elapsedSince, monotonicNow } from "../../src/shared/lib/time/timestamps";
import type { HostStore } from "../store";
import type { ServerBindings } from "../server/bindings";
import type {
  RoomManagementCall,
  RoomManagementResult,
} from "../assistant/management/assistant-management-turn";
import { RoomToolRetiredError } from "./room-command-lifetime";
type Intent = {
  requestId: string;
  hash: string;
  workId: string;
  occurrence: string;
  threadId: string;
  projectId?: string;
  deviceHash: string;
  retired?: boolean;
};
type NativeState = {
  requestId: string;
  state: "pendingApproval" | "running" | "exited" | "cancelled" | "failed" | "unknown";
  [key: string]: unknown;
};
type Dependencies = Pick<ServerBindings, "conversationDesktop" | "assistant" | "assistantPorts">;

/** Native SSH keeps its own original issuer/process; Host retains the parent until that receipt settles. */
export class RoomAutomationSshChildren {
  constructor(
    private readonly store: HostStore,
    private readonly active: (intent: Intent) => Promise<boolean>,
    private readonly dependencies: () => Dependencies,
  ) {}
  private async intents(): Promise<Intent[]> {
    const rows = await this.store.db
      .prepare("SELECT value FROM metadata WHERE key LIKE 'room-ssh-child:%'")
      .all();
    return rows.map((row) => JSON.parse(String(row.value)) as Intent);
  }
  private authorized(intent: Intent) {
    return async () => {
      const row = await this.store.db
        .prepare("SELECT value FROM metadata WHERE key=?")
        .get(`room-ssh-child:${intent.requestId}`);
      const current = row ? (JSON.parse(String(row.value)) as Intent) : undefined;
      return (
        current?.hash === intent.hash &&
        current.requestId === intent.requestId &&
        current.threadId === intent.threadId &&
        current.projectId === intent.projectId &&
        current.occurrence === intent.occurrence &&
        current.deviceHash === intent.deviceHash &&
        current.workId === intent.workId &&
        (await this.dependencies().assistant.globalRoomBinding())?.id === intent.threadId
      );
    };
  }
  private async control(
    intent: Intent,
    action: "servers.ssh.status" | "servers.ssh.cancel",
  ): Promise<NativeState> {
    const value = (await this.dependencies().conversationDesktop.callAssistantThread(
      action,
      { requestId: intent.requestId, ...(action === "servers.ssh.status" ? { maxBytes: 1 } : {}) },
      {
        threadId: intent.threadId,
        environmentId: this.store.environmentId,
        ...(intent.projectId ? { projectId: intent.projectId } : {}),
        targetDeviceHash: intent.deviceHash,
      },
      this.authorized(intent),
    )) as NativeState;
    if (
      !value ||
      value.requestId !== intent.requestId ||
      !["pendingApproval", "running", "exited", "cancelled", "failed", "unknown"].includes(
        value.state,
      )
    )
      throw new Error("Original Native SSH receipt is unavailable.");
    return value;
  }
  private async retire(intent: Intent, state: NativeState): Promise<boolean> {
    if (state.state === "unknown")
      throw new Error("Original Native SSH physical or remote outcome is unknown; do not replay.");
    if (!["exited", "cancelled", "failed"].includes(state.state)) return false;
    intent.retired = true;
    await this.store.db
      .prepare("UPDATE metadata SET value=? WHERE key=?")
      .run(JSON.stringify(intent), `room-ssh-child:${intent.requestId}`);
    return true;
  }
  async withChild<T>(
    call: RoomManagementCall,
    parent: { workId?: string; occurrence?: string; deviceHash?: string },
    signal: AbortSignal,
    authorized: () => Promise<boolean>,
    effect: () => Promise<T>,
  ): Promise<T> {
    if (!parent.workId || !parent.occurrence || !parent.deviceHash)
      throw new Error("Room SSH requires its original Work and Native source.");
    const intent: Intent = {
      requestId: call.requestId,
      hash: createHash("sha256").update(JSON.stringify(call)).digest("hex"),
      workId: parent.workId,
      occurrence: parent.occurrence,
      threadId: call.threadId,
      projectId: call.projectId,
      deviceHash: parent.deviceHash,
    };
    await this.store.transaction(async () => {
      if (signal.aborted || !(await authorized()) || !(await this.active(intent)))
        throw new Error("Room SSH parent was stopped before intent.");
      const saved = await this.store.db
        .prepare("INSERT OR IGNORE INTO metadata(key,value) VALUES(?,?)")
        .run(`room-ssh-child:${intent.requestId}`, JSON.stringify(intent));
      if (Number(saved.changes) !== 1)
        throw new Error("Room SSH already has its original attempt; never replay it.");
    }, "critical");
    const started = monotonicNow();
    const deadline = (Number(call.input.timeoutSeconds ?? 60) + 255) * 1000;
    let cancellation: Promise<NativeState> | undefined;
    let cancellationFailure: unknown;
    let entered = false;
    const cancel = () => {
      if (!entered) return;
      cancellation ??= this.control(intent, "servers.ssh.cancel");
      void cancellation.catch((error) => {
        cancellationFailure = error;
      });
    };
    signal.addEventListener("abort", cancel, { once: true });
    let failed = false;
    let failure: unknown;
    try {
      if (signal.aborted || !(await this.active(intent)) || !(await authorized())) {
        throw new RoomToolRetiredError(
          "Room SSH parent was stopped before dispatch; executor was not entered.",
        );
      } else {
        entered = true;
        try {
          await effect();
        } catch (error) {
          failed = true;
          failure = error;
        }
      }
      for (;;) {
        if (signal.aborted || !(await this.active(intent))) cancel();
        if (cancellationFailure) throw new Error("Original Native SSH cancellation is unproven.");
        const state = await this.control(intent, "servers.ssh.status");
        if (await this.retire(intent, state)) {
          if (signal.aborted || !(await this.active(intent)))
            throw new RoomToolRetiredError(
              "Room SSH local executor retired; remote cancellation outcome may be unknown.",
            );
          if (failed)
            throw new RoomToolRetiredError(
              failure instanceof Error
                ? failure.message
                : "Room SSH failed after original executor retirement.",
            );
          const dispatch = this.dependencies().assistantPorts.roomManagement;
          if (!dispatch)
            throw new RoomToolRetiredError(
              "Room SSH result dispatcher is unavailable after retirement.",
            );
          // Re-enter normal registered disclosure before returning any command output to the model.
          try {
            const result: RoomManagementResult = await dispatch(
              {
                ...call,
                action: "servers.ssh.status",
                input: { requestId: intent.requestId, maxBytes: 12000 },
              },
              {
                environmentId: this.store.environmentId,
                deviceHash: intent.deviceHash,
                authorized,
                signal,
              },
            );
            return result as T;
          } catch (error) {
            throw new RoomToolRetiredError(
              error instanceof Error
                ? error.message
                : "Room SSH result disclosure failed after retirement.",
            );
          }
        }
        if (elapsedSince(started) >= deadline)
          throw new Error(
            "Room SSH original executor has no proven retirement before its deadline.",
          );
        await delay(250);
      }
    } finally {
      signal.removeEventListener("abort", cancel);
    }
  }
  async stop(occurrence: string) {
    for (const intent of (await this.intents()).filter(
      (value) => value.occurrence === occurrence && !value.retired,
    )) {
      await this.control(intent, "servers.ssh.cancel");
    }
  }
  async occurrences() {
    return [
      ...new Set(
        (await this.intents())
          .filter((intent) => !intent.retired)
          .map((intent) => intent.occurrence),
      ),
    ];
  }
  async recover() {
    for (const intent of await this.intents())
      if (!intent.retired && !(await this.active(intent)))
        await this.control(intent, "servers.ssh.cancel");
  }
}
