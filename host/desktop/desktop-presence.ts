import { execFile } from "node:child_process";
import { join } from "node:path";

export type DesktopPresence = { locked: boolean; supported: boolean; idleMs?: number };
export type DesktopPresenceRunner = (
  binary: string,
  args: string[],
  options: { windowsHide: true; timeout: number; maxBuffer: number },
) => Promise<string>;
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
@{locked=[BycodaDesktopPresence]::Locked();supported=$true;idleMs=[BycodaDesktopPresence]::Idle()} | ConvertTo-Json -Compress
`;
const runNative: DesktopPresenceRunner = (binary, args, options) =>
  new Promise((resolve, reject) => {
    execFile(binary, args, { ...options, shell: false, encoding: "utf8" }, (error, stdout) =>
      error ? reject(new Error("Native desktop presence could not be read.")) : resolve(stdout),
    );
  });
/** Unsupported and failed reads never certify an active, unlocked desktop. */
export async function readDesktopPresence(
  options: { platform?: NodeJS.Platform; run?: DesktopPresenceRunner } = {},
): Promise<DesktopPresence> {
  if ((options.platform ?? process.platform) !== "win32") return { supported: false, locked: true };
  try {
    const binary = join(
      process.env.SystemRoot ?? "C:/Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    const stdout = await (options.run ?? runNative)(
      binary,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-Command",
        WINDOWS_DESKTOP_PRESENCE_SCRIPT,
      ],
      { windowsHide: true, timeout: 10000, maxBuffer: 16384 },
    );
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
  } catch {
    return { supported: false, locked: true };
  }
}
