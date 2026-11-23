import { spawn } from "node:child_process";
import { join } from "node:path";
import { elapsedSince, monotonicNow } from "../../../src/shared/lib/time/timestamps";

export type KeepAwakeStatus = {
  supported: boolean;
  requested: boolean;
  active: boolean;
  error?: string;
};
export type KeepAwakeHandle = { release(): Promise<void>; closed?: Promise<void> };
export interface KeepAwakePorts {
  platform?: NodeJS.Platform;
  /** `signal` ends an attempt the helper has not acknowledged yet. */
  acquire?(signal?: AbortSignal): Promise<KeepAwakeHandle>;
  onChange?(status: KeepAwakeStatus): void;
}
export const WINDOWS_KEEP_AWAKE_SCRIPT = String.raw`
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public static class BycodaPowerRequest {
  [DllImport("kernel32.dll",SetLastError=true)] public static extern uint SetThreadExecutionState(uint flags);
}
'@
$held=[BycodaPowerRequest]::SetThreadExecutionState([uint32]2147483649)
if($held -eq 0){throw 'The system-awake request was refused.'}
try { [Console]::WriteLine('bycoda-power-ready');[Console]::Out.Flush();[Console]::ReadLine() | Out-Null }
finally { [BycodaPowerRequest]::SetThreadExecutionState([uint32]2147483648) | Out-Null }
`;
function acquireNative(signal?: AbortSignal): Promise<KeepAwakeHandle> {
  return new Promise((resolve, reject) => {
    const binary = join(
      process.env.SystemRoot ?? "C:/Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    const child = spawn(
      binary,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-Command",
        WINDOWS_KEEP_AWAKE_SCRIPT,
      ],
      { windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] },
    );
    let ready = false;
    let finished = false;
    let output = "";
    let timeout: ReturnType<typeof setTimeout>;
    // Add-Type's compiler child inherits these pipes and can hold "close" open after the kill.
    const abandon = (message: string) => {
      child.kill();
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      reject(new Error(message));
    };
    const stop = () => abandon("The system-awake request was stopped.");
    if (signal?.aborted) stop();
    else signal?.addEventListener("abort", stop, { once: true });
    const closed = new Promise<void>((done) =>
      child.once("close", () => {
        finished = true;
        clearTimeout(timeout);
        signal?.removeEventListener("abort", stop);
        done();
        if (!ready)
          reject(new Error("The system-awake helper exited before acknowledging its request."));
      }),
    );
    child.once("error", () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", stop);
      reject(new Error("The system-awake helper could not start."));
    });
    child.stdin.on("error", () => undefined);
    child.stderr.resume();
    child.stdout.on("data", (data: Buffer) => {
      output += data.toString("utf8");
      if (output.length > 1024) {
        child.kill();
        return;
      }
      if (!ready && output.includes("bycoda-power-ready")) {
        ready = true;
        clearTimeout(timeout);
        signal?.removeEventListener("abort", stop);
        resolve({
          closed,
          release: async () => {
            if (finished) return;
            child.stdin.end();
            const terminate = setTimeout(() => {
              if (!finished) child.kill();
            }, 3000);
            terminate.unref?.();
            try {
              await closed;
            } finally {
              clearTimeout(terminate);
            }
          },
        });
      }
    });
    timeout = setTimeout(() => {
      if (!ready) abandon("The system-awake helper did not acknowledge its request.");
    }, 10000);
    timeout.unref?.();
  });
}
/** Restart budget after an unexpected helper exit: 1s, 2s, 4s, 8s, 16s, then give up. */
const RESTART_ATTEMPTS = 5;
const RESTART_BASE_DELAY_MS = 1000;
/** Repeated demand starts a new helper this long after a failed attempt, matching the minute tick. */
export const KEEP_AWAKE_RETRY_MS = 60_000;
/** Opt-in system sleep inhibition. The helper owns only its own native thread's
 * request; it never changes a power plan, display timeout, or another process. */
export class HostAssistantKeepAwake {
  private readonly supported: boolean;
  private requested = false;
  private handle?: KeepAwakeHandle;
  private error?: string;
  private closing = false;
  private tail: Promise<unknown> = Promise.resolve();
  private restartAttempts = 0;
  private restartTimer?: ReturnType<typeof setTimeout>;
  private acquiring?: AbortController;
  private syncing = 0;
  private failedAt?: number;
  constructor(private readonly ports: KeepAwakePorts = {}) {
    this.supported = (ports.platform ?? process.platform) === "win32";
  }
  get status(): KeepAwakeStatus {
    return {
      supported: this.supported,
      requested: this.requested,
      active: !!this.handle,
      ...(this.error ? { error: this.error } : {}),
    };
  }
  private publish() {
    this.ports.onChange?.(this.status);
  }
  /**
   * Records current demand without waiting for the helper, so an optional power request never
   * holds the Assistant queue. `active` stays false until the helper acknowledges; `onChange`
   * reports the outcome. Unchanged demand starts no second attempt.
   */
  sync(enabled: boolean): KeepAwakeStatus {
    if (this.closing) return this.status;
    const settled =
      enabled === this.requested &&
      (!enabled ||
        !this.supported ||
        !!this.handle ||
        this.syncing > 0 ||
        !!this.restartTimer ||
        (this.failedAt !== undefined && elapsedSince(this.failedAt) < KEEP_AWAKE_RETRY_MS));
    if (settled) return this.status;
    this.syncing++;
    void this.setEnabled(enabled)
      .catch(() => undefined)
      .finally(() => {
        this.syncing--;
      });
    return this.status;
  }
  setEnabled(enabled: boolean): Promise<KeepAwakeStatus> {
    if (this.closing && enabled) return Promise.reject(new Error("Keep-awake service is closing."));
    this.requested = enabled;
    if (!enabled) this.acquiring?.abort();
    // Owner stop cancels any pending restart; owner start gets a fresh restart budget.
    this.cancelRestart();
    if (enabled) this.restartAttempts = 0;
    return this.enqueue(() => this.reconcile());
  }
  /** Runs one task at a time on the serialized queue so acquire/release never overlap. */
  private enqueue(task: () => Promise<KeepAwakeStatus>): Promise<KeepAwakeStatus> {
    const operation = this.tail.then(task);
    this.tail = operation.catch(() => undefined);
    return operation;
  }
  private async reconcile(): Promise<KeepAwakeStatus> {
    if (!this.supported) {
      this.publish();
      return this.status;
    }
    if (!this.requested || this.closing) {
      const handle = this.handle;
      if (handle) {
        await handle.release();
        if (this.handle === handle) this.handle = undefined;
      }
      this.error = undefined;
      this.publish();
      return this.status;
    }
    // Queued restart may run after another path already re-acquired: never hold two helpers.
    if (this.handle) return this.status;
    const attempt = (this.acquiring = new AbortController());
    try {
      const handle = await (this.ports.acquire ?? acquireNative)(attempt.signal);
      if (!this.requested || this.closing) {
        await handle.release();
        return this.status;
      }
      this.handle = handle;
      this.error = undefined;
      this.failedAt = undefined;
      void handle.closed?.then(() => {
        if (this.handle === handle) {
          this.handle = undefined;
          if (this.requested && !this.closing) {
            this.error = "The system-awake helper stopped.";
            this.scheduleRestart();
          }
          this.publish();
        }
      });
    } catch (error) {
      this.error = error instanceof Error ? error.message : "The system-awake request failed.";
      this.failedAt = monotonicNow();
      // Only a restart attempt (budget spent > 0) retries; a failed first owner request reports once.
      if (this.restartAttempts > 0 && this.requested && !this.closing) this.scheduleRestart();
    } finally {
      this.acquiring = undefined;
    }
    this.publish();
    return this.status;
  }
  private scheduleRestart() {
    if (this.restartTimer) return;
    if (this.restartAttempts >= RESTART_ATTEMPTS) {
      // shortcut: retry budget resets only on owner re-enable, not after a long stable run; upgrade if helper crashes recur for days.
      this.error = "The system-awake helper could not be restarted.";
      return;
    }
    const delay = RESTART_BASE_DELAY_MS * 2 ** this.restartAttempts;
    this.restartAttempts++;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      void this.enqueue(() => this.reconcile()).catch(() => undefined);
    }, delay);
    this.restartTimer.unref?.();
  }
  private cancelRestart() {
    if (!this.restartTimer) return;
    clearTimeout(this.restartTimer);
    this.restartTimer = undefined;
  }
  async close() {
    this.closing = true;
    this.requested = false;
    await this.setEnabled(false);
    await this.tail;
  }
}
