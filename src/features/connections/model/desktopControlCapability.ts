export const DESKTOP_CONTROL_RECEIPTS_CAPABILITY = "sessions.desktopControlReceipts.v1";

/** Only desktop-owned controls need the durable page/turn receipt protocol. */
export function requiresDesktopControlReceipts(command: unknown): boolean {
  if (!command || typeof command !== "object") return false;
  const value = command as { type?: unknown; runId?: unknown };
  return (
    value.runId === "desktop" &&
    (value.type === "cancel" || value.type === "approve" || value.type === "answer")
  );
}

export function assertDesktopControlReceipts(
  command: unknown,
  capabilities: readonly string[] | undefined,
): void {
  if (
    !requiresDesktopControlReceipts(command) ||
    capabilities?.includes(DESKTOP_CONTROL_RECEIPTS_CAPABILITY)
  )
    return;
  const commandId = (command as { commandId?: unknown }).commandId;
  throw Object.assign(
    new Error(
      "Host rejected request: Update bycoda Host in Connections settings before controlling this desktop turn.",
    ),
    { code: "RPC_WS_UNSUPPORTED", uncertain: false, commandId },
  );
}
