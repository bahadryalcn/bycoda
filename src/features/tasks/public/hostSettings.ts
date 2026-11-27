/** Unattended-work limits of a Host (running tasks, daily agent time) and their client. */
export {
  DEFAULT_MAX_RUNNING_TASKS,
  formatAgentMinutes,
  parseHostSettings,
  type HostSettings,
} from "../model/hostSettings";
export {
  listMachineLimits,
  saveMachineLimits,
  settingsMachine,
  type MachineLimits,
} from "../model/settingsClient";
