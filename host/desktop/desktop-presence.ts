import { execFile, spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { hostWarnDeduped, type DedupedWarn } from "../diagnostics/log-dedupe";

export type DesktopPresence = { locked: boolean; supported: boolean; idleMs?: number };
// Fixed read-only source, never composed with app names, tool text or secrets.
// WTSInfoEx supplies the current process session's initial lock state without
// relying on the desktop UI to relay a lock event to the background Host.
export const WINDOWS_DESKTOP_PRESENCE_SCRIPT = String.raw`
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class BycodaDesktopPresence {
  [StructLayout(LayoutKind.Sequential)] public struct LastInput { public uint Size; public uint Time; }
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] public struct Info1 {
    public uint SessionId; public int State; public int Flags;
    [MarshalAs(UnmanagedType.ByValTStr,SizeConst=33)] public string Station;
    [MarshalAs(UnmanagedType.ByValTStr,SizeConst=21)] public string User;
    [MarshalAs(UnmanagedType.ByValTStr,SizeConst=18)] public string Domain;
    public long LogonTime; public long ConnectTime; public long DisconnectTime; public long LastInputTime; public long CurrentTime;
    public uint IncomingBytes; public uint OutgoingBytes; public uint IncomingFrames; public uint OutgoingFrames; public uint IncomingCompressedBytes; public uint OutgoingCompressedBytes;
  }
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] public struct Info { public uint Level; public Info1 Data; }
  [DllImport("wtsapi32.dll",SetLastError=true)] private static extern bool WTSQuerySessionInformationW(IntPtr server,uint session,int info,out IntPtr buffer,out uint bytes);
  [DllImport("wtsapi32.dll")] private static extern void WTSFreeMemory(IntPtr buffer);
  [DllImport("user32.dll",SetLastError=true)] private static extern bool GetLastInputInfo(ref LastInput input);
  [DllImport("kernel32.dll")] private static extern uint GetTickCount();
  public static bool Locked() {
    IntPtr buffer; uint bytes;
    if(!WTSQuerySessionInformationW(IntPtr.Zero,(uint)System.Diagnostics.Process.GetCurrentProcess().SessionId,25,out buffer,out bytes))throw new InvalidOperationException("Session presence could not be read.");
    try {
      if(buffer==IntPtr.Zero || bytes<Marshal.SizeOf(typeof(Info)))throw new InvalidOperationException("Session presence is incomplete.");
      Info value=(Info)Marshal.PtrToStructure(buffer,typeof(Info));
      if(value.Level!=1 || (value.Data.Flags!=0 && value.Data.Flags!=1))throw new InvalidOperationException("Session lock state is unknown.");
      return value.Data.Flags==0 || value.Data.State!=0;
    } finally { WTSFreeMemory(buffer); }
  }
  public static uint Idle() { LastInput input=new LastInput();input.Size=(uint)Marshal.SizeOf(typeof(LastInput));if(!GetLastInputInfo(ref input))throw new InvalidOperationException("Idle time is unknown.");return unchecked(GetTickCount()-input.Time); }
}
'@
while ($null -ne [Console]::In.ReadLine()) {
  try { $json=@{locked=[BycodaDesktopPresence]::Locked();supported=$true;idleMs=[BycodaDesktopPresence]::Idle()} | ConvertTo-Json -Compress }
  catch { $json='{"supported":false}' }
  [Console]::Out.WriteLine($json); [Console]::Out.Flush()
}
`;
type PresenceSpawn = (binary: string, args: string[]) => ChildProcess;
const defaultSpawn: PresenceSpawn = (binary, args) =>
  spawn(binary, args, { windowsHide: true, shell: false, stdio: ["pipe", "pipe", "ignore"] });
const MAX_LINE = 16384;

/**
 * One resident PowerShell compiles the native type once and answers one JSON line per request.
 * Spawning PowerShell and compiling C# for every read took seconds under load and timed out,
 * which made the computer count as away and refused computer use. Concurrent callers share one
 * reading; a timeout kills the process so the next read starts fresh; the process exits when
 * idle or when the Host closes its stdin.
 */
export class DesktopPresenceWorker {
  private child?: ChildProcess;
  private partial = "";
  private waiter?: { resolve(line: string): void; reject(error: Error): void };
  private inflight?: Promise<string>;
  private idle?: ReturnType<typeof setTimeout>;
  constructor(
    private readonly spawnChild: PresenceSpawn = defaultSpawn,
    private readonly idleMs = 120_000,
  ) {}

  read(timeoutMs: number): Promise<string> {
    this.inflight ??= this.query(timeoutMs).finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  stop() {
    const child = this.child;
    this.child = undefined;
    this.partial = "";
    clearTimeout(this.idle);
    if (child && child.exitCode === null) child.kill();
  }

  private query(timeoutMs: number) {
    clearTimeout(this.idle);
    return new Promise<string>((resolve, reject) => {
      const settle = (error?: Error, line?: string) => {
        clearTimeout(timer);
        this.waiter = undefined;
        if (error) return reject(error);
        this.idle = setTimeout(() => this.stop(), this.idleMs);
        this.idle.unref?.();
        resolve(line!);
      };
      const timer = setTimeout(() => {
        this.stop();
        settle(new Error("timed out"));
      }, timeoutMs);
      this.waiter = {
        resolve: (line) => settle(undefined, line),
        reject: (error) => settle(error),
      };
      try {
        this.start().stdin!.write("\n");
      } catch (error) {
        this.stop();
        settle(error instanceof Error ? error : new Error("presence helper unavailable"));
      }
    });
  }

  private start() {
    if (this.child) return this.child;
    const binary = join(
      process.env.SystemRoot ?? "C:/Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    const child = this.spawnChild(binary, [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-WindowStyle",
      "Hidden",
      "-Command",
      WINDOWS_DESKTOP_PRESENCE_SCRIPT,
    ]);
    this.child = child;
    // Lossy per-line decoding: one invalid byte never ends the reader.
    const decoder = new TextDecoder("utf-8", { fatal: false });
    child.stdout!.on("data", (chunk: Uint8Array) => {
      if (this.child !== child) return;
      this.partial += decoder.decode(chunk, { stream: true });
      for (let index = this.partial.indexOf("\n"); index >= 0; index = this.partial.indexOf("\n")) {
        const line = this.partial.slice(0, index).trim();
        this.partial = this.partial.slice(index + 1);
        if (line) this.waiter?.resolve(line);
      }
      if (this.partial.length > MAX_LINE) {
        this.stop();
        this.waiter?.reject(new Error("oversized output"));
      }
    });
    const gone = () => {
      if (this.child !== child) return;
      this.stop();
      this.waiter?.reject(new Error("presence helper exited"));
    };
    child.on("exit", gone);
    child.on("error", gone);
    child.stdin!.on("error", gone);
    return child;
  }
}
const sharedWorker = new DesktopPresenceWorker();

export type IoregRun = (args: string[], timeoutMs: number) => Promise<string>;
const runIoreg: IoregRun = (args, timeoutMs) =>
  new Promise((resolve, reject) => {
    execFile(
      "/usr/sbin/ioreg",
      args,
      { timeout: timeoutMs, maxBuffer: 1024 * 1024, encoding: "buffer" },
      // Lossy decoding: one invalid byte never fails the reading.
      (error, stdout) =>
        error ? reject(error) : resolve(new TextDecoder("utf-8", { fatal: false }).decode(stdout)),
    );
  });

/**
 * macOS reading for owner availability only: HIDIdleTime (nanoseconds since the last input) and
 * the console session's lock flag. Physical desktop-control gates keep `readDesktopPresence`,
 * which stays Windows-only. A session that is not on the console counts as locked.
 */
export async function readMacDesktopPresence(
  run: IoregRun = runIoreg,
  warn: DedupedWarn = hostWarnDeduped,
): Promise<DesktopPresence> {
  try {
    const [hid, root] = await Promise.all([
      run(["-r", "-c", "IOHIDSystem", "-d", "1", "-k", "HIDIdleTime"], 5000),
      run(["-n", "Root", "-d", "1", "-k", "IOConsoleUsers"], 5000),
    ]);
    const idle = /"HIDIdleTime"\s*=\s*(\d+)/.exec(hid)?.[1];
    const users = /"IOConsoleUsers"\s*=\s*(.*)/.exec(root)?.[1];
    if (idle === undefined || users === undefined) throw new Error("Invalid presence");
    const idleMs = Math.floor(Number(idle) / 1e6);
    if (!Number.isSafeInteger(idleMs) || idleMs < 0) throw new Error("Invalid presence");
    const locked =
      /"CGSSessionScreenIsLocked"\s*=\s*Yes/.test(users) ||
      !/"kCGSSessionOnConsoleKey"\s*=\s*Yes/.test(users);
    return { locked, supported: true, idleMs };
  } catch (error) {
    warn(
      "Desktop presence could not be read; availability counts this computer as away.",
      error instanceof Error ? `(${error.message})` : undefined,
    );
    return { supported: false, locked: true };
  }
}

/** Unsupported and failed reads never certify an active, unlocked desktop. */
export async function readDesktopPresence(
  options: {
    platform?: NodeJS.Platform;
    read?: (timeoutMs: number) => Promise<string>;
    warn?: DedupedWarn;
  } = {},
): Promise<DesktopPresence> {
  if ((options.platform ?? process.platform) !== "win32") return { supported: false, locked: true };
  try {
    const stdout = await (options.read ?? ((timeoutMs) => sharedWorker.read(timeoutMs)))(10000);
    const parsed: unknown = JSON.parse(stdout.trim());
    if (!parsed || typeof parsed !== "object") throw new Error("Invalid presence");
    const value = parsed as DesktopPresence;
    if (
      typeof value.locked !== "boolean" ||
      value.supported !== true ||
      !Number.isSafeInteger(value.idleMs) ||
      value.idleMs! < 0
    )
      throw new Error("Invalid presence");
    return { locked: value.locked, supported: true, idleMs: value.idleMs };
  } catch (error) {
    // A failed read counts as away; log it so an Away the owner did not choose is explainable.
    (options.warn ?? hostWarnDeduped)(
      "Desktop presence could not be read; availability counts this computer as away.",
      error instanceof Error ? `(${error.message})` : undefined,
    );
    return { supported: false, locked: true };
  }
}
