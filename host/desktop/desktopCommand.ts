/** A watcher's stop, approval or answer, left for the desktop app to run. */
export type DesktopCommand = {
  id: string;
  sessionId: string;
  type: "cancel" | "approve" | "answer" | "retire-writer";
  requestId?: number;
  approvalOccurrenceId?: string;
  runId?: string;
  authorityGeneration?: number;
  decision?: "allow" | "deny";
  reply?: unknown;
  pageToken?: string;
  turnReceipt?: { version: 1; sessionId: string; turnId: string };
  /** Name of the remote device that sent it; omitted when unknown. */
  requestedBy?: string;
};

/** Trimmed device name, at most 160 characters, or undefined when empty. */
export function requestedByName(name: unknown): string | undefined {
  return (typeof name === "string" ? name.trim().slice(0, 160) : "") || undefined;
}
