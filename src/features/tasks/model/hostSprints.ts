import type { TaskStatus } from "./hostTasks";

export const HOST_SPRINTS = "tasks.sprints.v1";
export const HOST_TASK_HISTORY = "tasks.history.v1";
export const SPRINT_STORY_POINTS = [0, 1, 2, 3, 5, 8, 13, 21] as const;
export type SprintProjectRef = {
  environmentId: string;
  projectId: string;
  cwd: string;
  name: string;
};
export type SprintTaskRef = Pick<SprintProjectRef, "environmentId" | "projectId"> & {
  taskId: string;
};
export const sprintProjectKey = (ref: Pick<SprintProjectRef, "environmentId" | "projectId">) =>
  JSON.stringify([ref.environmentId, ref.projectId]);
export const sprintTaskKey = (ref: SprintTaskRef) =>
  JSON.stringify([ref.environmentId, ref.projectId, ref.taskId]);
export type SprintState = "planned" | "active" | "completed" | "archived";
export type SprintFields = {
  name: string;
  goal?: string;
  projects: SprintProjectRef[];
  capacityPoints: number | null;
  projectCapacities: Record<string, number>;
  startsAt?: number;
  endsAt?: number;
};
export type HostSprint = SprintFields & {
  id: string;
  state: SprintState;
  revision: number;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
};
export type SprintCommand = { requestId: string; expectedRevision: number };
export type SprintCompleteInput = SprintCommand & {
  rollover?: { taskKeys: string[]; targetSprintId: string | null };
};
export type SprintCreateInput = SprintFields & { id: string; requestId: string };
export type SprintUpdateInput = Omit<Partial<SprintFields>, "goal" | "startsAt" | "endsAt"> & {
  goal?: string | null;
  startsAt?: number | null;
  endsAt?: number | null;
} & SprintCommand;
export type SprintPlanItem = SprintTaskRef & {
  sprintId: string | null;
  storyPoints: number | null;
  revision: number;
};
export type SprintPlanInput = SprintTaskRef & {
  sprintId: string | null;
  storyPoints?: number | null;
  expectedRevision: number;
  requestId: string;
};
export type SprintTaskSnapshot = {
  id: string;
  projectId: string;
  title: string;
  status: TaskStatus;
  updatedAt: number;
  goalId?: string;
};
export type SprintGoalContext = {
  environmentId: string;
  goalId: string;
  sprintId: string | null;
  revision: number;
};
export type SprintGoalContextInput = Omit<SprintGoalContext, "revision"> & SprintCommand;
export type SprintSourceEvent = {
  sequence: number;
  projectId: string;
  taskId: string;
  status: TaskStatus;
  effectiveAt: number;
  deleted: boolean;
  task?: SprintTaskSnapshot;
};
export type SprintIngestInput = {
  environmentId: string;
  snapshot?: { tasks: SprintTaskSnapshot[]; cursor: number; historyAvailableFrom?: number };
  events?: SprintSourceEvent[];
  cursor: number;
  fromCursor?: number;
  visibleProjectIds?: string[];
  caughtUp?: boolean;
};
export type SprintSourceState = {
  environmentId: string;
  cursor: number;
  syncedAt: number;
  historyAvailableFrom?: number;
  visibleProjectIds?: string[];
  caughtUp?: boolean;
};
export type SprintReportTask = SprintPlanItem & {
  title: string;
  status: TaskStatus;
  deleted: boolean;
  updatedAt: number;
};
export type SprintTotals = {
  tasks: number;
  points: number;
  completedPoints: number;
  remainingPoints: number;
  unestimated: number;
  deleted: number;
};
export type SprintLedgerEntry = {
  sequence: number;
  sprintId: string;
  at: number;
  effectiveAt?: number;
  kind: "scope" | "estimate" | "status" | "start" | "complete" | "update";
  taskKey?: string;
  totals: SprintTotals;
  projects?: Record<string, SprintTotals>;
};
export type SprintReport = {
  sprint: HostSprint;
  tasks: SprintReportTask[];
  totals: SprintTotals;
  projects: Record<string, SprintTotals>;
  ledger: SprintLedgerEntry[];
  sources: SprintSourceState[];
  frozen: boolean;
};
export type SprintBoard = {
  sprints: HostSprint[];
  planning: SprintPlanItem[];
  sources: SprintSourceState[];
  contexts?: SprintGoalContext[];
};
