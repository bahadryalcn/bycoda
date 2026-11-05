import type { EventEmitter } from "node:events";
import type { Readable, Writable } from "node:stream";

/** The original owned transport, not a lookup by provider PID or session name. */
export interface ProviderChild extends EventEmitter {
  readonly pid?: number;
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | null;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface GuardianProviderChild extends ProviderChild {
  readonly started: Promise<void>;
  /** Private terminal receipt; process close alone never resolves this proof. */
  readonly retirement: Promise<void>;
  stop(): Promise<void>;
}
