import {
  HOST_AUTO_ARCHIVE,
  HOST_BEHAVIOR_DEFAULTS,
} from "../../src/features/tasks/model/hostSettings";

/** Whether the Host has authoritative clearance for unsent client drafts. Until a synchronized
 * client draft authority exists this stays false: auto archive never runs, its settings cannot
 * be enabled and its capability is not advertised. Flip it only together with a real
 * `hasUnsentDraft` port in account-platform. */
export const AUTO_ARCHIVE_DRAFT_AUTHORITY = false;

/** Capabilities of the agent-defaults record; archive is separate from plain behavior defaults. */
export function agentDefaultsCapabilities(authority = AUTO_ARCHIVE_DRAFT_AUTHORITY): string[] {
  return authority ? [HOST_BEHAVIOR_DEFAULTS, HOST_AUTO_ARCHIVE] : [HOST_BEHAVIOR_DEFAULTS];
}
