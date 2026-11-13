/** Unattended-work limits of a Host (running tasks, daily agent time) and their client. */
export {
  MAX_RUNNING_TASKS_LIMIT,
  formatAgentMinutes,
  parseHostSettings,
  type HostSettings,
} from "../model/hostSettings";
export {
  listMachineLimits,
  saveMachineLimits,
  settingsMachines,
  type MachineLimits,
} from "../model/settingsClient";
