import { spawn } from "node:child_process";
import { join } from "node:path";

export type KeepAwakeStatus = {
  supported: boolean;
  requested: boolean;
  active: boolean;
  error?: string;
};
export type KeepAwakeHandle = { release(): Promise<void>; closed?: Promise<void> };
export interface KeepAwakePorts {
  platform?: NodeJS.Platform;
  acquire?(): Promise<KeepAwakeHandle>;
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
function acquireNative(): Promise<KeepAwakeHandle> {
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
    const closed = new Promise<void>((done) =>
      child.once("close", () => {
        finished = true;
        clearTimeout(timeout);
        done();
        if (!ready)
          reject(new Error("The system-awake helper exited before acknowledging its request."));
      }),
    );
    child.once("error", () => {
      clearTimeout(timeout);
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
      if (!ready) {
        child.kill();
        reject(new Error("The system-awake helper did not acknowledge its request."));
      }
    }, 10000);
    timeout.unref?.();
  });
}
/** Opt-in system sleep inhibition. The helper owns only its own native thread's
 * request; it never changes a power plan, display timeout, or another process. */
export class HostAssistantKeepAwake {
  private readonly supported: boolean;
  private requested = false;
  private handle?: KeepAwakeHandle;
  private error?: string;
  private closing = false;
  private tail: Promise<unknown> = Promise.resolve();
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
  setEnabled(enabled: boolean): Promise<KeepAwakeStatus> {
    if (this.closing && enabled) return Promise.reject(new Error("Keep-awake service is closing."));
    this.requested = enabled;
    const operation = this.tail.then(async () => {
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
      if (this.handle) return this.status;
      try {
        const handle = await (this.ports.acquire ?? acquireNative)();
        if (!this.requested || this.closing) {
          await handle.release();
          return this.status;
        }
        this.handle = handle;
        this.error = undefined;
        void handle.closed?.then(() => {
          if (this.handle === handle) {
            this.handle = undefined;
            if (this.requested && !this.closing) this.error = "The system-awake helper stopped.";
            this.publish();
          }
        });
      } catch (error) {
        this.error = error instanceof Error ? error.message : "The system-awake request failed.";
      }
      this.publish();
      return this.status;
    });
    this.tail = operation.catch(() => undefined);
    return operation;
  }
  async close() {
    this.closing = true;
    this.requested = false;
    await this.setEnabled(false);
    await this.tail;
  }
}
