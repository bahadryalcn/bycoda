/** Project-only voice subjects cannot inherit a working copy or focused desktop lease. */
export function voiceThreadToolAllowed(family: string, action: string) {
  if (family === "social" || family === "runtime-logs") return true;
  return (
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
