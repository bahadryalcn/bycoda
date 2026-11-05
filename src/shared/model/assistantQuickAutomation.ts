import type { AssistantExecution } from "./host-contracts/assistant";
export type AssistantQuickAutomationAction = {
  kind: "automation";
  projectId: string;
  name: string;
  prompt: string;
  harness: AssistantExecution["harness"];
  model: string;
  modelSettings: Record<string, string>;
  runtimeMode: AssistantExecution["runtimeMode"];
  scheduleKind: "hourly" | "daily" | "weekdays" | "weekly";
  minute: number;
  time: string;
  dayOfWeek: number;
  maxRunMinutes: number;
  maxRunsPerDay: number;
  isolate: boolean;
  enabled: boolean;
};
/** Match the editable configuration persisted by canonical HostAutomations. */
export function normalizeAssistantQuickAutomationAction(
  action: AssistantQuickAutomationAction,
): AssistantQuickAutomationAction {
  return {
    kind: "automation",
    projectId: action.projectId,
    name: action.name.trim(),
    prompt: action.prompt,
    harness: action.harness,
    model: action.model,
    modelSettings: Object.fromEntries(
      Object.entries(action.modelSettings).sort(([left], [right]) => left.localeCompare(right)),
    ),
    runtimeMode: action.runtimeMode,
    scheduleKind: action.scheduleKind,
    minute: action.minute,
    time: action.time,
    dayOfWeek: action.dayOfWeek,
    maxRunMinutes: action.maxRunMinutes,
    maxRunsPerDay: action.maxRunsPerDay,
    isolate: action.isolate,
    enabled: action.enabled,
  };
}
