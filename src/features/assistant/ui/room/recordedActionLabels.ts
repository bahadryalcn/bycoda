import { t } from "../../../../shared/i18n";

/**
 * Known assistant tool actions. Their copy is translated at render time in `recordedActionLabel`;
 * unknown ids never reach the visible label.
 */
export const RECORDED_ACTION_IDS = [
  "sessions.list",
  "sessions.read",
  "tasks.list",
  "tasks.get",
  "tasks.create",
  "tasks.update",
  "tasks.start",
  "tasks.stop",
  "tasks.retry",
  "tasks.delete",
  "notes.list",
  "notes.read",
  "notes.create",
  "notes.update",
  "notes.delete",
  "automations.list",
  "automations.get",
  "automations.create",
  "automations.update",
  "automations.pause",
  "automations.resume",
  "automations.delete",
  "automations.runNow",
  "terminals.list",
  "terminals.read",
  "terminals.write",
  "devServers.list",
  "devServers.start",
  "devServers.stop",
  "devServers.restart",
] as const;

/**
 * Visible label for a recorded action. Unknown ids get the generic label; the raw id
 * stays in the caller's tooltip so it is available for diagnosis without being shown.
 */
export function recordedActionLabel(action: string): string {
  switch (action) {
    case "sessions.list":
      return t("List sessions");
    case "sessions.read":
      return t("Read session");
    case "tasks.list":
      return t("List tasks");
    case "tasks.get":
      return t("Get task");
    case "tasks.create":
      return t("Create task");
    case "tasks.update":
      return t("Update task");
    case "tasks.start":
      return t("Start task");
    case "tasks.stop":
      return t("Stop task");
    case "tasks.retry":
      return t("Retry task");
    case "tasks.delete":
      return t("Delete task");
    case "notes.list":
      return t("List notes");
    case "notes.read":
      return t("Read note");
    case "notes.create":
      return t("Create note");
    case "notes.update":
      return t("Update note");
    case "notes.delete":
      return t("Delete note");
    case "automations.list":
      return t("List automations");
    case "automations.get":
      return t("Get automation");
    case "automations.create":
      return t("Create automation");
    case "automations.update":
      return t("Update automation");
    case "automations.pause":
      return t("Pause automation");
    case "automations.resume":
      return t("Resume automation");
    case "automations.delete":
      return t("Delete automation");
    case "automations.runNow":
      return t("Run automation now");
    case "terminals.list":
      return t("List terminals");
    case "terminals.read":
      return t("Read terminal");
    case "terminals.write":
      return t("Write to terminal");
    case "devServers.list":
      return t("List dev servers");
    case "devServers.start":
      return t("Start dev server");
    case "devServers.stop":
      return t("Stop dev server");
    case "devServers.restart":
      return t("Restart dev server");
    default:
      return t("Recorded action");
  }
}
