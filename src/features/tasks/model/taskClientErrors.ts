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
};
