/** Desktop writes still require their exact native approval/allowlist/ref gates;
 * a thread subject never inherits a working copy or another session's lease. */
export function voiceDesktopInputAction(action: string) {
  return [
    "desktop.launch",
    "desktop.clipboard",
    "desktop.act",
    "desktop.click",
    "desktop.setValue",
    "desktop.press",
  ].includes(action);
}
export function voiceThreadToolAllowed(family: string, action: string) {
  if (family === "social" || family === "runtime-logs") return true;
  if (family !== "conversation") return false;
  return (
    voiceDesktopInputAction(action) ||
    /^(notes|inbox)\./.test(action) ||
    [
      "host.limits.status",
      "shell.profiles",
      "desktop.status",
      "desktop.snapshot",
      "desktop.windows.list",
      "desktop.find",
      "desktop.screenshot",
      "desktop.wait",
    ].includes(action)
  );
}
