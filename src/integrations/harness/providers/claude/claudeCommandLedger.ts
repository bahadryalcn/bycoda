import { stringField } from "./claudeProtocol";

type PendingState = "written" | "queued";

/**
 * Follows the stdin user messages written into a running Claude query (Steer).
 *
 * Claude Code reports every stdin message by its `uuid` through
 * `command_lifecycle` records: `queued`, `started`, then a terminal state such
 * as `completed` or `cancelled`. A Steer is either folded into the running
 * query at its next tool boundary (it starts before that query's result) or
 * runs as the next query (it is still unstarted when the result arrives). A
 * result therefore ends the Bycoda turn only once no Steer is left unstarted.
 *
 * Older CLIs never report a lifecycle; Steer is then refused before any write
 * so the composer keeps the message queued instead.
 */
export class ClaudeCommandLedger {
  private reported = false;
  private readonly unstarted = new Map<string, PendingState>();
  /** Steers left unstarted by Stop; each runs as its own query, so it is interrupted when it starts. */
  private readonly stopOnStart = new Set<string>();

  /** True once this process has reported a command lifecycle. */
  get tracksCommands(): boolean {
    return this.reported;
  }

  /** A new Bycoda turn starts; earlier Steers belong to a finished turn. */
  resetTurn(): void {
    this.unstarted.clear();
  }

  /** Called before the write, so a result racing the write keeps the turn open. */
  track(uuid: string): void {
    this.unstarted.set(uuid, "written");
  }

  /** The write failed; nothing will report this message. */
  forget(uuid: string): void {
    this.unstarted.delete(uuid);
  }

  hasUnstarted(): boolean {
    return this.unstarted.size > 0;
  }

  /** Stop: unstarted Steers would otherwise run after the interrupt. Returns whether any remain. */
  stopUnstarted(): boolean {
    for (const uuid of this.unstarted.keys()) this.stopOnStart.add(uuid);
    this.unstarted.clear();
    return this.stopOnStart.size > 0;
  }

  /**
   * Applies one stream record. Returns `"interrupt"` when a Steer cancelled by
   * Stop has just started and must be interrupted too.
   */
  observe(rec: Record<string, unknown>): "interrupt" | undefined {
    if (stringField(rec, "type") !== "command_lifecycle") return undefined;
    this.reported = true;
    const uuid = stringField(rec, "command_uuid");
    const state = stringField(rec, "state");
    if (!uuid || !state) return undefined;
    if (state === "queued") {
      if (this.unstarted.has(uuid)) this.unstarted.set(uuid, "queued");
      return undefined;
    }
    this.unstarted.delete(uuid);
    if (state === "started") return this.stopOnStart.has(uuid) ? "interrupt" : undefined;
    this.stopOnStart.delete(uuid);
    return undefined;
  }
}
