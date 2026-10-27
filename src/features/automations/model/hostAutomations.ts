import { isRemoteProvider, type RemoteProvider } from "../../connections/model/protocol";
import { RUNTIME_MODES, type RuntimeMode } from "../../sessions/model/session";
import { isScheduleKind, type AutomationSchedule } from "./automationSchedule";
import type { AutomationRunStatus } from "./automations";

/** Automations a machine's host runs on its own schedule, whether or not a
 * desktop is open. The host advertises this capability when it has them. */
export const HOST_AUTOMATIONS = "automations";

export type HostAutomationInput = AutomationSchedule & {
  id: string;
  name: string;
  prompt: string;
  /** The host's ID for the project folder. */
  projectId: string;
  harness: RemoteProvider;
  model: string;
  modelSettings: Record<string, string>;
  runtimeMode: RuntimeMode;
  /** Run limits; zero means off. See automationLimits.ts. */
  maxRunMinutes: number;
  maxRunsPerDay: number;
  enabled: boolean;
  /** Omitted inherits the execution Host project policy. */
  isolate?: boolean;
};

export type HostAutomation = HostAutomationInput & {
  nextRunAt: number;
  lastRunAt?: number;
  lastRunStatus?: AutomationRunStatus;
  lastRunError?: string;
  lastSessionId?: string;
  /** A run is going and its session is waiting on an approval or a question. */
  needsInput?: boolean;
  createdAt: number;
  updatedAt: number;
};

export type HostAutomationRun = {
  id: string;
  automationId: string;
  trigger: "scheduled" | "manual";
  scheduledFor: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  status: AutomationRunStatus;
  sessionId?: string;
  /** The session turn this run started. */
  runId?: string;
  error?: string;
  /** While running: the session is waiting on an approval or a question. */
  needsInput?: boolean;
};

const ID = /^[A-Za-z0-9_-]{1,64}$/;

function whole(value: unknown, min: number, max: number, label: string) {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max)
    throw new Error(`Invalid automation ${label}`);
  return Number(value);
}

/** Validates what a desktop sent. Throws with the reason on bad input. */
export function parseHostAutomation(input: unknown): HostAutomationInput {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Invalid automation");
  const v = input as Record<string, unknown>;
  if (typeof v.id !== "string" || !ID.test(v.id)) throw new Error("Invalid automation ID");
  if (typeof v.name !== "string" || !v.name.trim() || v.name.length > 200)
    throw new Error("Automation name is required and must be under 200 characters.");
  if (
    typeof v.prompt !== "string" ||
    !v.prompt.trim() ||
    v.prompt.length > 256_000 ||
    v.prompt.includes("\0")
  )
    throw new Error("Automation prompt is required.");
  if (typeof v.projectId !== "string" || !ID.test(v.projectId))
    throw new Error("Choose a project for this automation.");
  if (!isRemoteProvider(v.harness)) throw new Error("Invalid automation agent");
  if (typeof v.model !== "string" || !v.model.trim() || v.model.length > 200)
    throw new Error("Invalid automation model");
  if (!RUNTIME_MODES.includes(v.runtimeMode as never))
    throw new Error("Invalid automation run mode.");
  if (typeof v.scheduleKind !== "string" || !isScheduleKind(v.scheduleKind))
    throw new Error("Invalid automation schedule.");
  if (typeof v.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v.time))
    throw new Error("Invalid automation time.");
  const settings = v.modelSettings ?? {};
  if (
    typeof settings !== "object" ||
    Array.isArray(settings) ||
    Object.values(settings as object).some((value) => typeof value !== "string")
  )
    throw new Error("Invalid model settings");
  if (v.isolate !== undefined && typeof v.isolate !== "boolean")
    throw new Error("Invalid automation options");
  return {
    ...(typeof v.isolate === "boolean" ? { isolate: v.isolate } : {}),
    id: v.id,
    name: v.name.trim(),
    prompt: v.prompt,
    projectId: v.projectId,
    harness: v.harness,
    model: v.model,
    modelSettings: settings as Record<string, string>,
    runtimeMode: v.runtimeMode as RuntimeMode,
    scheduleKind: v.scheduleKind,
    minute: whole(v.minute, 0, 59, "time"),
    time: v.time,
    dayOfWeek: whole(v.dayOfWeek, 0, 6, "time"),
    maxRunMinutes: whole(v.maxRunMinutes ?? 0, 0, 10_080, "run limit"),
    maxRunsPerDay: whole(v.maxRunsPerDay ?? 0, 0, 1_000, "run limit"),
    enabled: v.enabled !== false,
  };
}
