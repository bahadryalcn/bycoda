import type { AssistantExecution } from "./host-contracts/assistant";
import type { ModelRoutingItemChoice } from "./host-contracts/model-routing";
export type AssistantQuickAutomationAction = {
  kind: "automation";
  projectId: string;
  name: string;
  prompt: string;
  harness: AssistantExecution["harness"];
  model: string;
  modelSettings: Record<string, string>;
  /** Absent on actions reviewed before model routing: the stored model is used as is. */
  modelChoice?: ModelRoutingItemChoice;
  providerAccountId?: string;
  runtimeMode: AssistantExecution["runtimeMode"];
  scheduleKind: "hourly" | "daily" | "weekdays" | "weekly" | "once";
  /** Absolute run time in epoch ms; present exactly when scheduleKind is "once". */
  runAt?: number;
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
    ...(action.modelChoice === undefined ? {} : { modelChoice: action.modelChoice }),
    ...(action.providerAccountId === undefined
      ? {}
      : { providerAccountId: action.providerAccountId }),
    runtimeMode: action.runtimeMode,
    scheduleKind: action.scheduleKind,
    ...(action.runAt === undefined ? {} : { runAt: action.runAt }),
    minute: action.minute,
    time: action.time,
    dayOfWeek: action.dayOfWeek,
    maxRunMinutes: action.maxRunMinutes,
    maxRunsPerDay: action.maxRunsPerDay,
    isolate: action.isolate,
    enabled: action.enabled,
  };
}
