import { dateTimeFormat } from "../../../shared/lib/intl";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { HarnessId, RuntimeMode } from "../../sessions/model/session";
import {
  isScheduleKind,
  nextAutomationRunAt,
  parseTime,
  type AutomationScheduleKind,
} from "./automationSchedule";

export {
  isScheduleKind,
  nextAutomationRunAt,
  type AutomationScheduleKind,
} from "./automationSchedule";

export const AUTOMATIONS_CHANGED = "bycoda:automations-changed";
const LOCAL_CHANGED = "bycoda:automations-local-changed";

export type AutomationWorkspaceMode = "current" | "worktree" | "existing";
export type AutomationTriggerKind =
  | "time"
  | "github"
  | "linear"
  | "jira"
  | "gitlab"
  | "azuredevops";

export type AutomationTrigger = {
  id: string;
  kind: AutomationTriggerKind;
  event: string;
  scheduleKind: AutomationScheduleKind;
  minute: number;
  time: string;
  dayOfWeek: number;
  repos: string[];
  repo: string;
  branch: string;
  actor: string;
  /** For label-added events: the label to wait for. Empty means any label. */
  label: string;
};

export type AutomationRunStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped"
  | "cancelled";

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export type Automation = {
  id: string;
  name: string;
  prompt: string;
  harness: HarnessId;
  model: string;
  modelSettings?: Record<string, string>;
  cwd: string;
  workspaceMode: AutomationWorkspaceMode;
  worktreeCwd?: string;
  sessionFolderId?: string;
  reuseSession: boolean;
  runtimeMode: RuntimeMode;
  triggerKind: AutomationTriggerKind;
  triggerEvent: string;
  scheduleKind: AutomationScheduleKind;
  minute: number;
  time: string;
  dayOfWeek: number;
  triggers?: AutomationTrigger[] | null;
  missedRunGraceMinutes: number;
  /** Run limits; zero or missing means off. See automationLimits.ts. */
  maxRunMinutes?: number;
  maxRunsPerDay?: number;
  enabled: boolean;
  nextRunAt: number;
  lastRunAt?: number;
  lastRunStatus?: AutomationRunStatus;
  lastRunError?: string;
  lastSessionId?: string;
  createdAt: number;
  updatedAt: number;
  /** Set when a machine's host stores and runs this automation on its own
   * schedule, instead of this app. See hostAutomationClient.ts. */
  host?: AutomationHost;
};

export type AutomationHost = {
  machineId: string;
  machineName: string;
  /** The host's ID for the project folder. */
  projectId: string;
  /** A run is going and its session is waiting on an approval or a question. */
  needsInput?: boolean;
  /** The machine did not answer; this is what it last reported. */
  stale?: boolean;
};

export type AutomationUpsert = Omit<
  Automation,
  | "lastRunAt"
  | "lastRunStatus"
  | "lastRunError"
  | "lastSessionId"
  | "createdAt"
  | "updatedAt"
  | "host"
>;

export type AutomationRunTrigger = "scheduled" | "manual" | "event";

export type AutomationRun = {
  id: string;
  automationId: string;
  trigger: AutomationRunTrigger;
  scheduledFor: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  status: AutomationRunStatus;
  sessionId?: string;
  error?: string;
  /** A background run's session is waiting on an approval or a question. */
  needsInput?: boolean;
  eventKey?: string;
  eventKind?: AutomationTriggerKind;
  event?: string;
  prompt?: string;
};

export type DueAutomationRun = {
  automation: Automation;
  run: AutomationRun;
};

export function formatAutomationRunAt(at: number): string {
  if (!Number.isFinite(at) || at <= 0) return "—";
  const date = new Date(at);
  const month = dateTimeFormat(undefined, { month: "short" }).format(date);
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return `${date.getDate()} ${month}, ${time}`;
}

export function formatAutomationRunDuration(
  run: Pick<AutomationRun, "status" | "createdAt" | "startedAt" | "completedAt">,
  now = Date.now(),
): string {
  const live = run.status === "pending" || run.status === "running";
  const start = run.startedAt ?? (run.status === "pending" ? undefined : run.createdAt);
  const end = run.completedAt ?? (live && start ? now : undefined);
  if (!start || end == null || end < start) return "—";
  const minutes = Math.floor((end - start) / 60_000);
  if (minutes < 1) return "< 1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

export type AutomationDraft = {
  id?: string;
  name: string;
  prompt: string;
  harness: HarnessId;
  model: string;
  modelSettings: Record<string, string>;
  cwd: string;
  workspaceMode: AutomationWorkspaceMode;
  worktreeCwd: string;
  sessionFolderId: string;
  reuseSession: boolean;
  runtimeMode: RuntimeMode;
  triggerKind: AutomationTriggerKind;
  triggerEvent: string;
  scheduleKind: AutomationScheduleKind;
  minute: number;
  time: string;
  dayOfWeek: number;
  triggers: AutomationTrigger[];
  missedRunGraceMinutes: number;
  maxRunMinutes: number;
  maxRunsPerDay: number;
  /** Stored and run by the project machine's host, with no desktop open. */
  runInBackground: boolean;
  enabled: boolean;
};

export const AUTOMATION_WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export function createAutomationTrigger(
  kind: AutomationTriggerKind,
  event: string,
  extras: Partial<AutomationTrigger> = {},
): AutomationTrigger {
  return {
    id: extras.id ?? crypto.randomUUID(),
    kind,
    event,
    scheduleKind:
      extras.scheduleKind ?? (kind === "time" && isScheduleKind(event) ? event : "weekdays"),
    minute: extras.minute ?? 0,
    time: extras.time ?? "09:00",
    dayOfWeek: extras.dayOfWeek ?? 1,
    repos: extras.repos ?? [],
    repo: extras.repo ?? "",
    branch: extras.branch ?? "",
    actor: extras.actor ?? "anyone",
    label: extras.label ?? "",
  };
}

export function automationTriggers(
  automation: Pick<
    Automation,
    | "id"
    | "triggers"
    | "triggerKind"
    | "triggerEvent"
    | "scheduleKind"
    | "minute"
    | "time"
    | "dayOfWeek"
  >,
): AutomationTrigger[] {
  if (automation.triggers) return automation.triggers;
  return [
    createAutomationTrigger(
      automation.triggerKind,
      automation.triggerEvent || automation.scheduleKind,
      {
        id: `${automation.id}:legacy`,
        scheduleKind: automation.scheduleKind,
        minute: automation.minute,
        time: automation.time,
        dayOfWeek: automation.dayOfWeek,
      },
    ),
  ];
}

export function applyTriggers(
  draft: AutomationDraft,
  triggers: AutomationTrigger[],
): AutomationDraft {
  const primary = triggers.find((trigger) => trigger.kind === "time") ?? triggers[0];
  return {
    ...draft,
    triggers,
    triggerKind: primary?.kind ?? "time",
    triggerEvent: primary?.event ?? "",
    scheduleKind: primary?.scheduleKind ?? "weekdays",
    minute: primary?.minute ?? 0,
    time: primary?.time ?? "09:00",
    dayOfWeek: primary?.dayOfWeek ?? 1,
  };
}

export function nextTriggersRunAt(
  triggers: readonly AutomationTrigger[],
  after = Date.now(),
): number {
  const times = triggers.filter((trigger) => trigger.kind === "time");
  if (times.length === 0) return after + YEAR_MS;
  return Math.min(...times.map((trigger) => nextAutomationRunAt(trigger, after)));
}

export function overdueTriggerOccurrences(
  triggers: readonly AutomationTrigger[],
  firstRunAt: number,
  now: number,
  limit = 100,
): Array<{ scheduledFor: number; nextRunAt: number }> {
  const occurrences: Array<{ scheduledFor: number; nextRunAt: number }> = [];
  let scheduledFor = firstRunAt;
  while (scheduledFor <= now && occurrences.length < limit) {
    const nextRunAt = nextTriggersRunAt(triggers, scheduledFor);
    if (nextRunAt <= scheduledFor) break;
    occurrences.push({ scheduledFor, nextRunAt });
    scheduledFor = nextRunAt;
  }
  return occurrences;
}

export function gmtOffsetLabel(date = new Date()): string {
  const minutes = -date.getTimezoneOffset();
  const sign = minutes >= 0 ? "+" : "-";
  const absolute = Math.abs(minutes);
  const hours = Math.floor(absolute / 60);
  const rest = absolute % 60;
  return rest === 0 ? `GMT${sign}${hours}` : `GMT${sign}${hours}:${String(rest).padStart(2, "0")}`;
}

export function nextRunPreview(at: number): string {
  const date = new Date(at);
  const day = dateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  })
    .format(date)
    .replace(/,/g, "");
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  const zone =
    dateTimeFormat(undefined, { timeZoneName: "short" })
      .formatToParts(date)
      .find((part) => part.type === "timeZoneName")?.value ?? gmtOffsetLabel(date);
  return `Next run ${day}, ${time} ${zone}`;
}

export function automationScheduleLabel(
  automation: Pick<Automation, "scheduleKind" | "minute" | "time" | "dayOfWeek">,
): string {
  const time = formatClock(automation.time);
  if (automation.scheduleKind === "hourly") {
    return `Hourly at :${String(automation.minute).padStart(2, "0")}`;
  }
  if (automation.scheduleKind === "daily") return `Daily at ${time}`;
  if (automation.scheduleKind === "weekdays") return `Weekdays at ${time}`;
  return `${AUTOMATION_WEEKDAYS[automation.dayOfWeek] ?? "Weekly"} at ${time}`;
}

export function newAutomationDraft(
  cwd: string,
  harness: HarnessId,
  model: string,
): AutomationDraft {
  return {
    name: "",
    prompt: "",
    harness,
    model,
    modelSettings: {},
    cwd,
    workspaceMode: "worktree",
    worktreeCwd: "",
    sessionFolderId: "",
    reuseSession: false,
    runtimeMode: "auto",
    triggerKind: "time",
    triggerEvent: "",
    scheduleKind: "weekdays",
    minute: 0,
    time: "09:00",
    dayOfWeek: 1,
    triggers: [],
    missedRunGraceMinutes: 720,
    maxRunMinutes: 0,
    maxRunsPerDay: 0,
    runInBackground: false,
    enabled: true,
  };
}

export function draftFromTemplate(
  cwd: string,
  harness: HarnessId,
  model: string,
  template: {
    name: string;
    prompt: string;
    trigger: {
      kind: AutomationTriggerKind;
      event: string;
      scheduleKind?: AutomationScheduleKind;
      time?: string;
      dayOfWeek?: number;
      minute?: number;
    };
  },
): AutomationDraft {
  const draft = newAutomationDraft(cwd, harness, model);
  const trigger = createAutomationTrigger(template.trigger.kind, template.trigger.event, {
    scheduleKind: template.trigger.scheduleKind,
    time: template.trigger.time,
    dayOfWeek: template.trigger.dayOfWeek,
    minute: template.trigger.minute,
  });
  return applyTriggers(
    {
      ...draft,
      name: template.name,
      prompt: template.prompt,
    },
    [trigger],
  );
}

export function draftFromAutomation(automation: Automation): AutomationDraft {
  return {
    id: automation.id,
    name: automation.name,
    prompt: automation.prompt,
    harness: automation.harness,
    model: automation.model,
    modelSettings: automation.modelSettings ?? {},
    cwd: automation.cwd,
    workspaceMode: automation.workspaceMode,
    worktreeCwd: automation.worktreeCwd ?? "",
    sessionFolderId: automation.sessionFolderId ?? "",
    reuseSession: automation.reuseSession,
    runtimeMode: automation.runtimeMode,
    triggerKind: automation.triggerKind,
    triggerEvent: automation.triggerEvent,
    scheduleKind: automation.scheduleKind,
    minute: automation.minute,
    time: automation.time,
    dayOfWeek: automation.dayOfWeek,
    triggers: automationTriggers(automation),
    missedRunGraceMinutes: automation.missedRunGraceMinutes,
    maxRunMinutes: automation.maxRunMinutes ?? 0,
    maxRunsPerDay: automation.maxRunsPerDay ?? 0,
    runInBackground: automation.host != null,
    enabled: automation.enabled,
  };
}

let cachedAutomations: Automation[] | null = null;
let automationsRevision = 0;

/** Last successful list, for an immediate first render while refreshing. */
export function peekAutomations(): Automation[] | null {
  return cachedAutomations;
}

export async function listAutomations(): Promise<Automation[]> {
  const revision = automationsRevision;
  const next = await invoke<Automation[]>("automations_list");
  if (revision !== automationsRevision) return cachedAutomations ?? listAutomations();
  cachedAutomations = next;
  return next;
}

export async function saveAutomation(draft: AutomationDraft): Promise<Automation> {
  const { runInBackground: _local, ...synced } = applyTriggers(draft, draft.triggers);
  const automation: AutomationUpsert = {
    ...synced,
    id: synced.id ?? crypto.randomUUID(),
    nextRunAt: nextTriggersRunAt(synced.triggers),
  };
  const saved = await invoke<Automation>("automations_upsert", { automation });
  emitLocalChange({ upsert: saved });
  return saved;
}

export async function setAutomationEnabled(
  automation: Automation,
  enabled: boolean,
): Promise<Automation> {
  return saveAutomation({ ...draftFromAutomation(automation), enabled });
}

export async function deleteAutomation(id: string): Promise<void> {
  await invoke("automations_delete", { id });
  emitLocalChange({ deletedId: id });
}

export function listAutomationRuns(automationId: string): Promise<AutomationRun[]> {
  return invoke("automation_runs_list", { automationId });
}

export function recoverAutomationRuns(
  startedBefore: number,
  now = Date.now(),
): Promise<DueAutomationRun[]> {
  return invoke("automation_runs_recover", { startedBefore, now });
}

export async function createManualAutomationRun(automationId: string): Promise<AutomationRun> {
  const run = await invoke<AutomationRun>("automation_run_now", {
    automationId,
    now: Date.now(),
  });
  emitLocalChange();
  return run;
}

export async function claimDueAutomations(now = Date.now()): Promise<DueAutomationRun[]> {
  const automations = await listAutomations();
  const due = automations.filter(
    (automation) =>
      automation.enabled &&
      automationTriggers(automation).some((trigger) => trigger.kind === "time") &&
      automation.nextRunAt <= now,
  );
  const claimed: DueAutomationRun[] = [];
  for (const automation of due) {
    const triggers = automationTriggers(automation);
    // Bound each polling pass so a long offline period cannot monopolize the
    // webview. Any remaining overdue occurrences stay due for the next pass.
    for (const occurrence of overdueTriggerOccurrences(triggers, automation.nextRunAt, now)) {
      let result: DueAutomationRun | null;
      try {
        result = await invoke<DueAutomationRun | null>("automations_claim_due", {
          automationId: automation.id,
          expectedNextRunAt: occurrence.scheduledFor,
          nextRunAt: occurrence.nextRunAt,
          now,
        });
      } catch {
        // Keep earlier successful claims launchable. This occurrence remains
        // due because the backend transaction did not accept it.
        break;
      }
      if (!result) break;
      if (result.run.status === "pending") claimed.push(result);
    }
  }
  if (due.length > 0) emitLocalChange();
  return claimed;
}

export async function updateAutomationRun(
  runId: string,
  status: AutomationRunStatus,
  options: { sessionId?: string; error?: string } = {},
): Promise<AutomationRun> {
  const run = await invoke<AutomationRun>("automation_run_update", {
    runId,
    status,
    sessionId: options.sessionId ?? null,
    error: options.error ?? null,
    now: Date.now(),
  });
  emitLocalChange();
  return run;
}

export function notifyAutomationsChanged() {
  emitLocalChange();
}

export type AutomationChange = { upsert: Automation } | { deletedId: string };

export function subscribeAutomations(onChange: (change?: AutomationChange) => void): () => void {
  const onLocal = (event: Event) =>
    onChange((event as CustomEvent<AutomationChange | undefined>).detail);
  window.addEventListener(LOCAL_CHANGED, onLocal);
  let disposed = false;
  let unlisten: (() => void) | undefined;
  void listen(AUTOMATIONS_CHANGED, () => {
    automationsRevision++;
    cachedAutomations = null;
    onChange();
  })
    .then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    })
    .catch(() => undefined);
  return () => {
    disposed = true;
    unlisten?.();
    window.removeEventListener(LOCAL_CHANGED, onLocal);
  };
}

export function applyAutomationChange(
  entries: Automation[],
  change: AutomationChange,
): Automation[] {
  if ("deletedId" in change) return entries.filter((entry) => entry.id !== change.deletedId);
  return entries.some((entry) => entry.id === change.upsert.id)
    ? entries.map((entry) => (entry.id === change.upsert.id ? change.upsert : entry))
    : [...entries, change.upsert];
}

function emitLocalChange(change?: AutomationChange) {
  automationsRevision++;
  cachedAutomations =
    cachedAutomations && change ? applyAutomationChange(cachedAutomations, change) : null;
  window.dispatchEvent(new CustomEvent(LOCAL_CHANGED, { detail: change }));
}

function formatClock(value: string): string {
  const [hour, minute] = parseTime(value);
  return dateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(2000, 0, 1, hour, minute));
}
