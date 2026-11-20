import { t } from "../../../shared/i18n";

/** User-facing task client failures, translated when thrown. */
export const taskClientErrors = {
  boardChanged: () => t("The task board changed while loading. Refresh to load its latest state."),
  resolvePrevious: () =>
    t("Resolve the previous task creation on its original machine before changing projects."),
  crewHost: () => t("Update this project's host to run tasks with a crew."),
  creationUnchecked: () => t("The previous task creation could not be checked."),
  projectOnMachine: () => t("Choose a project on the selected machine."),
  accountHost: () => t("Update the selected host to run tasks with the selected provider account."),
  continuationHost: (machineName: string) =>
    t("Update bycoda Host on {p0} to continue tasks until complete.", { p0: machineName }),
  workspaceHost: () =>
    t("Update bycoda Host on the selected machine to choose task workspaces and start controls."),
  budgetHost: () => t("Update the selected host to enforce the total run budget."),
  preflightHost: () => t("Update the selected host to check preparation requirements."),
  registeredProject: () => t("Choose a registered project before checking preparation."),
  reorderSameMachine: () => t("Reorder tasks on the same machine"),
  machine: () => t("This project’s machine isn’t connected, or its bycoda Host needs an update."),
  agent: () => t("This agent cannot run tasks in the background."),
  todoHost: (machineName: string) =>
    t("Update bycoda Host on {p0} to add to-do items", { p0: machineName }),
  sessionGone: () => t("This session is no longer available."),
  epicChecking: () => t("Epic creation is already being checked."),
  epicReconnect: () => t("Reconnect the original host to check the previous epic creation."),
  epicUnchecked: () => t("The previous epic creation could not be checked."),
  epicScope: () => t("The previous epic identity has an unexpected project scope."),
  epicUnresolved: () =>
    t("The previous epic creation is unresolved. Restore its original draft before retrying."),
  epicAcknowledgement: () => t("The epic creation acknowledgement could not be verified."),
  chooseProject: () => t("Choose at least one project."),
  goalMachine: () => t("A goal’s projects must all be on one machine."),
  goalVerifyHost: () => t("Update the selected host to verify the completed goal."),
  goalDirectHost: () =>
    t("Update the selected host to run goal tasks directly in the selected checkout."),
};
