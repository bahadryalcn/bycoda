export type AssistantAutomationTarget = { id: string; projectId: string; environmentId?: string };
export type AssistantAutomationReveal = {
  id: string;
  projectId: string;
  environmentId: string;
  machineId: string;
  token: number;
};

/** Navigation uses the current canonical record and live project visibility. */
export function assistantAutomationProject(
  target: AssistantAutomationTarget,
  expectedEnvironmentId: string,
  actualEnvironmentId: string,
  projects: readonly { id: string; path: string }[],
  automations: readonly { id: string; projectId: string }[],
  canOpenProject: (path: string) => boolean,
) {
  const project = projects.find((row) => row.id === target.projectId),
    automation = automations.find((row) => row.id === target.id);
  if (
    !expectedEnvironmentId ||
    actualEnvironmentId !== expectedEnvironmentId ||
    (target.environmentId !== undefined && target.environmentId !== expectedEnvironmentId) ||
    !project ||
    !automation ||
    automation.projectId !== project.id ||
    !canOpenProject(project.path)
  )
    throw new Error("The linked automation changed or its project is unavailable.");
  return project;
}
