import type { Block } from "./session";

/**
 * Keyed status rows that only say a turn is still getting going. Their owners
 * emit and clear them: `send-starting` in `app/workspace/sessions/submit/
 * submitStarting.ts`, `provider-starting` in `integrations/harness/core/
 * providerStartupStatus.ts`. The transcript's live activity line speaks for
 * them, so the work trail leaves them out instead of showing the same words
 * twice (or a stale "Starting…" in a turn that has finished).
 */
const STARTUP_STATUS_KEYS: ReadonlySet<string> = new Set(["send-starting", "provider-starting"]);

export function isStartupStatusBlock(block: Block): boolean {
  return block.role === "system" && !!block.statusKey && STARTUP_STATUS_KEYS.has(block.statusKey);
}
