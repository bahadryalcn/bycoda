import { t } from "../../../../shared/i18n";

/**
 * Known assistant tool actions and their application-owned English copy. The copy is
 * translated at render time; unknown ids never reach the visible label.
 */
export const RECORDED_ACTION_LABELS = new Map<string, string>([
  ["sessions.list", "List sessions"],
  ["sessions.read", "Read session"],
  ["tasks.list", "List tasks"],
  ["tasks.get", "Get task"],
  ["tasks.create", "Create task"],
  ["tasks.update", "Update task"],
  ["tasks.start", "Start task"],
  ["tasks.stop", "Stop task"],
  ["tasks.retry", "Retry task"],
  ["tasks.delete", "Delete task"],
  ["notes.list", "List notes"],
  ["notes.read", "Read note"],
  ["notes.create", "Create note"],
  ["notes.update", "Update note"],
  ["notes.delete", "Delete note"],
  ["automations.list", "List automations"],
  ["automations.get", "Get automation"],
  ["automations.create", "Create automation"],
  ["automations.update", "Update automation"],
  ["automations.pause", "Pause automation"],
  ["automations.resume", "Resume automation"],
  ["automations.delete", "Delete automation"],
  ["automations.runNow", "Run automation now"],
  ["terminals.list", "List terminals"],
  ["terminals.read", "Read terminal"],
  ["terminals.write", "Write to terminal"],
  ["devServers.list", "List dev servers"],
  ["devServers.start", "Start dev server"],
  ["devServers.stop", "Stop dev server"],
  ["devServers.restart", "Restart dev server"],
]);

/**
 * Visible label for a recorded action. Unknown ids get the generic label; the raw id
 * stays in the caller's tooltip so it is available for diagnosis without being shown.
 */
/** Generic copy for ids outside `RECORDED_ACTION_LABELS`. */
export const RECORDED_ACTION_FALLBACK_LABEL = "Recorded action";

export function recordedActionLabel(action: string): string {
  return t(RECORDED_ACTION_LABELS.get(action) ?? RECORDED_ACTION_FALLBACK_LABEL);
}
