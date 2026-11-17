import {
  HOST_AUTO_ARCHIVE,
  HOST_BEHAVIOR_DEFAULTS,
} from "../../src/features/tasks/model/hostSettings";

/** Account-platform binds persisted, authenticated client draft presence to the archive guard. */
export const AUTO_ARCHIVE_DRAFT_AUTHORITY = true;

/** Capabilities of the agent-defaults record; archive is separate from plain behavior defaults. */
export function agentDefaultsCapabilities(authority = AUTO_ARCHIVE_DRAFT_AUTHORITY): string[] {
  return authority ? [HOST_BEHAVIOR_DEFAULTS, HOST_AUTO_ARCHIVE] : [HOST_BEHAVIOR_DEFAULTS];
}
