import { isRemoteProvider, type RemoteProvider } from "../../connections/model/protocol";
import {
  isScheduleKind,
  type AutomationSchedule,
} from "../../automations/model/automationSchedule";
import { RUNTIME_MODES, type RuntimeMode } from "../../sessions/model/session";
import { lastJsonBlock } from "./hostGoals";

/** Project stewards: a per-project agent a machine's host runs on a schedule
 * to propose the next pieces of work as To-do items. The host advertises this
 * capability when it has it. */
export const HOST_STEWARDS = "stewards";

export const MAX_PROPOSALS_LIMIT = 10;
export const MAX_OPEN_LIMIT = 30;
export const DEFAULT_MAX_PROPOSALS = 5;
export const DEFAULT_MAX_OPEN = 10;
/** How many declined titles a steward remembers. */
export const MAX_DECLINED = 200;
export const FOCUS_LIMIT = 4000;

export type StewardRunStatus = "running" | "succeeded" | "failed" | "skipped" | "cancelled";

export type HostStewardInput = AutomationSchedule & {
  id: string;
  /** The host's ID for the project folder. */
  projectId: string;
  enabled: boolean;
  harness: RemoteProvider;
  model: string;
  modelSettings: Record<string, string>;
  runtimeMode: RuntimeMode;
  /** What to look for, as the owner wrote it. May be empty. */
  focus: string;
  maxProposals: number;
  maxOpen: number;
  /** Queue proposals right away instead of leaving them as to-do items. */
  autoStart: boolean;
  /** Merge the tasks it creates once their checks pass, without waiting for
   * approval. Absent counts as false. */
  autoMerge?: boolean;
};

/** The run a steward is in the middle of. */
export type StewardRun = {
  sessionId?: string;
  runId?: string;
  startedAt: number;
  /** The throwaway checkout the run works in, and its branch. */
  worktreeCwd?: string;
  branch?: string;
  /** Why the run is being stopped, saved before its turn was cancelled. */
  error?: string;
};

export type HostSteward = HostStewardInput & {
  nextRunAt: number;
  lastRunAt?: number;
  lastRunStatus?: StewardRunStatus;
  lastRunError?: string;
  lastSessionId?: string;
  /** How many tasks the last finished run added. */
  lastProposed?: number;
  /** Normalized titles of proposals the owner declined. */
  declined: string[];
  run?: StewardRun;
  createdAt: number;
  updatedAt: number;
};

/** One piece of work the steward suggests. */
export type StewardProposal = { title: string; description: string };

const ID = /^[A-Za-z0-9_-]{1,64}$/;

function whole(value: unknown, min: number, max: number, label: string) {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max)
    throw new Error(`Invalid steward ${label}`);
  return Number(value);
}

/** Validates what a desktop sent. Throws with the reason on bad input. */
export function parseHostSteward(input: unknown): HostStewardInput {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Invalid steward");
  const v = input as Record<string, unknown>;
  if (typeof v.id !== "string" || !ID.test(v.id)) throw new Error("Invalid steward ID");
  if (typeof v.projectId !== "string" || !ID.test(v.projectId))
    throw new Error("Choose a project for this steward.");
  if (!isRemoteProvider(v.harness)) throw new Error("Invalid steward agent");
  if (typeof v.model !== "string" || !v.model.trim() || v.model.length > 200)
    throw new Error("Invalid steward model");
  if (!RUNTIME_MODES.includes(v.runtimeMode as never)) throw new Error("Invalid steward run mode.");
  if (typeof v.scheduleKind !== "string" || !isScheduleKind(v.scheduleKind))
    throw new Error("Invalid steward schedule.");
  if (typeof v.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v.time))
    throw new Error("Invalid steward time.");
  const settings = v.modelSettings ?? {};
  if (
    typeof settings !== "object" ||
    Array.isArray(settings) ||
    Object.values(settings as object).some((value) => typeof value !== "string")
  )
    throw new Error("Invalid model settings");
  const focus = v.focus ?? "";
  if (typeof focus !== "string" || focus.length > FOCUS_LIMIT || focus.includes("\0"))
    throw new Error("Invalid steward focus.");
  if (
    (v.autoStart !== undefined && typeof v.autoStart !== "boolean") ||
    (v.autoMerge !== undefined && typeof v.autoMerge !== "boolean") ||
    (v.enabled !== undefined && typeof v.enabled !== "boolean")
  )
    throw new Error("Invalid steward options");
  return {
    id: v.id,
    projectId: v.projectId,
    enabled: v.enabled !== false,
    harness: v.harness,
    model: v.model,
    modelSettings: settings as Record<string, string>,
    runtimeMode: v.runtimeMode as RuntimeMode,
    scheduleKind: v.scheduleKind,
    minute: whole(v.minute ?? 0, 0, 59, "time"),
    time: v.time,
    dayOfWeek: whole(v.dayOfWeek ?? 0, 0, 6, "time"),
    focus: focus.trim(),
    maxProposals: whole(
      v.maxProposals ?? DEFAULT_MAX_PROPOSALS,
      1,
      MAX_PROPOSALS_LIMIT,
      "proposal limit",
    ),
    maxOpen: whole(v.maxOpen ?? DEFAULT_MAX_OPEN, 1, MAX_OPEN_LIMIT, "open limit"),
    autoStart: v.autoStart === true,
    ...(v.autoMerge === true ? { autoMerge: true } : {}),
  };
}

/** A title as compared for duplicates: lowercase, whitespace collapsed,
 * punctuation trimmed from both ends. */
export function normalizeStewardTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    .trim();
}

/** Reads the proposals at the end of the steward's reply: the last fenced json
 * block, `{"proposals":[{"title","description"}]}` (a bare list is accepted
 * too). Entries without a title are dropped; at most `max` are kept. Throws
 * with the reason when the block is missing or unusable. */
export function parseStewardProposals(text: string, max: number): StewardProposal[] {
  const block = lastJsonBlock(text);
  if (block === undefined)
    throw new Error("The steward’s reply has no ```json block with proposals.");
  let raw: unknown;
  try {
    raw = JSON.parse(block);
  } catch (error) {
    throw new Error(
      `The proposals are not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object"
      ? (raw as Record<string, unknown>).proposals
      : undefined;
  if (!Array.isArray(list)) throw new Error("The reply must be an object with a “proposals” list.");
  const proposals: StewardProposal[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const v = entry as Record<string, unknown>;
    if (typeof v.title !== "string") continue;
    const title = v.title.trim();
    if (!title || title.length > 200) continue;
    const description =
      typeof v.description === "string" &&
      v.description.length <= 256_000 &&
      !v.description.includes("\0")
        ? v.description.trim()
        : "";
    proposals.push({ title, description });
  }
  if (list.length > 0 && proposals.length === 0)
    throw new Error("None of the proposals has a usable title.");
  return proposals.slice(0, max);
}
