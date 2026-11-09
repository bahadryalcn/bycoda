import {
  DEFAULT_AUTONOMY,
  type AutonomyAction,
  type AutonomyLevel,
  type AutonomyPolicy,
} from "../../../src/features/social/model/autonomy";
import type { SocialAudienceStore } from "../store/social-audience-store";

export const AUTONOMY_ACTIONS = Object.keys(DEFAULT_AUTONOMY.levels) as AutonomyAction[];
const LEVELS: readonly AutonomyLevel[] = ["suggest", "approve", "autonomous"];
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_LIMIT = 1_000_000;

export function defaultAutonomyPolicy(accountId: string): AutonomyPolicy {
  return {
    accountId,
    version: DEFAULT_AUTONOMY.version,
    levels: { ...DEFAULT_AUTONOMY.levels },
    limits: { ...DEFAULT_AUTONOMY.limits },
    updatedAt: 0,
    updatedBy: "default",
  };
}

export function timeZoneValid(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function autonomyLimit(policy: AutonomyPolicy, action: AutonomyAction): number {
  return policy.limits[action] ?? DEFAULT_AUTONOMY.limits[action] ?? 0;
}

export function hasAutonomousLevel(policy: AutonomyPolicy): boolean {
  return AUTONOMY_ACTIONS.some((action) => policy.levels[action] === "autonomous");
}

/** Validates an owner's policy patch. Levels and limits merge onto the current policy. */
export function parseAutonomyInput(
  value: unknown,
  current: AutonomyPolicy,
): Omit<AutonomyPolicy, "accountId" | "version" | "updatedAt" | "updatedBy"> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid autonomy policy.");
  const input = value as Record<string, unknown>;
  const allowed = ["levels", "limits", "workingHours"];
  if (Object.keys(input).some((key) => !allowed.includes(key)))
    throw new Error("Unknown autonomy policy field.");
  const levels: Record<AutonomyAction, AutonomyLevel> = { ...current.levels };
  if (input.levels !== undefined) {
    if (!input.levels || typeof input.levels !== "object" || Array.isArray(input.levels))
      throw new Error("Invalid autonomy levels.");
    for (const [action, level] of Object.entries(input.levels as Record<string, unknown>)) {
      if (!AUTONOMY_ACTIONS.includes(action as AutonomyAction))
        throw new Error("Unknown autonomy action.");
      if (!LEVELS.includes(level as AutonomyLevel)) throw new Error("Invalid autonomy level.");
      levels[action as AutonomyAction] = level as AutonomyLevel;
    }
  }
  const limits: Partial<Record<AutonomyAction, number>> = { ...current.limits };
  if (input.limits !== undefined) {
    if (!input.limits || typeof input.limits !== "object" || Array.isArray(input.limits))
      throw new Error("Invalid autonomy limits.");
    for (const [action, limit] of Object.entries(input.limits as Record<string, unknown>)) {
      if (!AUTONOMY_ACTIONS.includes(action as AutonomyAction))
        throw new Error("Unknown autonomy action.");
      if (
        typeof limit !== "number" ||
        !Number.isSafeInteger(limit) ||
        limit < 0 ||
        limit > MAX_LIMIT
      )
        throw new Error("Autonomy limits must be whole numbers from 0 to 1000000.");
      limits[action as AutonomyAction] = limit;
    }
  }
  return {
    levels,
    limits,
    workingHours: parseWorkingHours(input.workingHours, current.workingHours),
  };
}

function parseWorkingHours(
  value: unknown,
  current: AutonomyPolicy["workingHours"],
): AutonomyPolicy["workingHours"] {
  if (value === undefined) return current;
  if (value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid working hours.");
  const hours = value as Record<string, unknown>;
  if (typeof hours.timeZone !== "string" || !timeZoneValid(hours.timeZone))
    throw new Error("Invalid working-hours time zone.");
  if (
    !Array.isArray(hours.days) ||
    !hours.days.length ||
    hours.days.some((day) => !Number.isSafeInteger(day) || day < 0 || day > 6) ||
    new Set(hours.days).size !== hours.days.length
  )
    throw new Error("Working days must be unique numbers from 0 (Sunday) to 6 (Saturday).");
  if (typeof hours.start !== "string" || !CLOCK.test(hours.start))
    throw new Error("Working-hours start must use HH:mm.");
  if (typeof hours.end !== "string" || !CLOCK.test(hours.end))
    throw new Error("Working-hours end must use HH:mm.");
  return {
    timeZone: hours.timeZone,
    days: [...(hours.days as number[])].sort((a, b) => a - b),
    start: hours.start,
    end: hours.end,
  };
}

export async function readAutonomyPolicy(
  store: SocialAudienceStore,
  accountId: string,
): Promise<AutonomyPolicy> {
  return (await store.getRecord("autonomy", accountId)) ?? defaultAutonomyPolicy(accountId);
}

/** Stores the patch with the next version. Earlier autonomy approvals stop matching. */
export async function saveAutonomyPolicy(
  store: SocialAudienceStore,
  accountId: string,
  input: ReturnType<typeof parseAutonomyInput>,
  actorId: string,
  now: number,
): Promise<AutonomyPolicy> {
  const current = await readAutonomyPolicy(store, accountId);
  const next: AutonomyPolicy = {
    accountId,
    version: current.version + 1,
    levels: input.levels,
    limits: input.limits,
    ...(input.workingHours ? { workingHours: input.workingHours } : {}),
    updatedAt: now,
    updatedBy: actorId,
  };
  return await store.putRecord("autonomy", accountId, next);
}

/** Calendar day key in the policy time zone; the daily counters use it. */
export function policyDay(policy: AutonomyPolicy, now: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: policy.workingHours?.timeZone ?? "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** First quarter-hour instant after `now` that starts a new policy day. */
export function nextPolicyDayStart(policy: AutonomyPolicy, now: number): number {
  const today = policyDay(policy, now);
  let at = now;
  for (let step = 0; step < 100; step++) {
    at += 15 * 60_000;
    if (policyDay(policy, at) !== today) return at;
  }
  return now + 24 * 60 * 60_000;
}
