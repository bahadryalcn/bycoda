import { execFile } from "node:child_process";
import { join } from "node:path";

export type TaskbarRunner = (
  binary: string,
  args: string[],
  options: {
    windowsHide: true;
    timeout: number;
    maxBuffer: number;
    env: NodeJS.ProcessEnv;
  },
) => Promise<string>;

/**
 * Fixed source; the browser process id arrives through the environment, never composed in.
 * A hidden social browser sits off every display, so its taskbar button opened nothing.
 * WS_EX_TOOLWINDOW keeps Explorer from re-adding the button and leaves the window shown,
 * so pages keep rendering as they do for the owner; DeleteTab removes the existing button.
 */
export const WINDOWS_TASKBAR_HIDE_SCRIPT = String.raw`
$ErrorActionPreference='Stop'
$target=$env:BYCODA_SOCIAL_BROWSER_PID
if($target -notmatch '^\d{1,10}$'){throw 'Invalid process.'}
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class BycodaSocialTaskbar {
  private delegate bool EnumProc(IntPtr window, IntPtr data);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc callback, IntPtr data);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr window, uint command);
  [DllImport("user32.dll",EntryPoint="GetWindowLongPtrW")] private static extern IntPtr GetStyle(IntPtr window, int index);
  [DllImport("user32.dll",EntryPoint="SetWindowLongPtrW")] private static extern IntPtr SetStyle(IntPtr window, int index, IntPtr value);
  [ComImport,Guid("56FDF342-FD6D-11d0-958A-006097C9A090"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface ITaskbarList { void HrInit(); void AddTab(IntPtr w); void DeleteTab(IntPtr w); void ActivateTab(IntPtr w); void SetActiveAlt(IntPtr w); }
  [ComImport,Guid("56FDF344-FD6D-11d0-958A-006097C9A090")] private class TaskbarList {}
  public static int Hide(uint target) {
    List<IntPtr> windows = new List<IntPtr>();
    EnumWindows((window, data) => {
      uint process; GetWindowThreadProcessId(window, out process);
      if (process == target && IsWindowVisible(window) && GetWindow(window, 4) == IntPtr.Zero) windows.Add(window);
      return true;
    }, IntPtr.Zero);
    if (windows.Count == 0) return 0;
    ITaskbarList taskbar = (ITaskbarList)new TaskbarList();
    taskbar.HrInit();
    foreach (IntPtr window in windows) {
      long style = GetStyle(window, -20).ToInt64();
      SetStyle(window, -20, new IntPtr((style | 0x80L) & ~0x40000L));
      taskbar.DeleteTab(window);
    }
    return windows.Count;
  }
}
'@
for($attempt=0;$attempt -lt 20;$attempt++){
  $count=[BycodaSocialTaskbar]::Hide([uint32]$target)
  if($count -gt 0){$count;exit 0}
  Start-Sleep -Milliseconds 250
}
0
`;

const runNative: TaskbarRunner = (binary, args, options) =>
  new Promise((resolve, reject) => {
    execFile(binary, args, { ...options, shell: false, encoding: "utf8" }, (error, stdout) =>
      error
        ? reject(new Error("The browser taskbar button could not be hidden."))
        : resolve(stdout),
    );
  });

/**
 * Removes the taskbar and Alt+Tab entry of a hidden social browser's windows. Windows only;
 * best effort: a failure leaves the off-screen window's button as before.
 * shortcut: covers windows open at launch; a popup the site opens later keeps its button
 * until that browser restarts. Upgrade to a per-target call if popups become common.
 */
export async function hideBrowserFromTaskbar(
  browserPid: unknown,
  options: { platform?: NodeJS.Platform; run?: TaskbarRunner } = {},
): Promise<boolean> {
  if ((options.platform ?? process.platform) !== "win32") return false;
  if (!Number.isSafeInteger(browserPid) || (browserPid as number) <= 0) return false;
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
      WINDOWS_TASKBAR_HIDE_SCRIPT,
    ],
    {
      windowsHide: true,
      timeout: 20_000,
      maxBuffer: 4096,
      env: { ...process.env, BYCODA_SOCIAL_BROWSER_PID: String(browserPid) },
    },
  );
  return Number(stdout.trim()) > 0;
}
