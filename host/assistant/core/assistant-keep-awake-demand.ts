import {
  assistantActiveHours,
  type AssistantPolicy,
} from "../../../src/shared/model/assistantPolicy";

export const KEEP_AWAKE_HOURS_LOOKAHEAD_MINUTES = 60;
export const KEEP_AWAKE_BRIEFING_LOOKAHEAD_MINUTES = 15;

export type KeepAwakeDemandInput = {
  /** A planning/running/stalled job or a manual assistant turn is running now. */
  running: boolean;
  /** A project job is queued and could start once active hours open. */
  queuedJobs: boolean;
  /** Jobs can only start in Jobs or Chief mode with an execution model. */
  canStartJobs: boolean;
  policy: AssistantPolicy;
  now: number;
  briefing?: { enabled: boolean; time: string; preparedToday: boolean };
};

/** Minutes from `now` until active hours open; 0 when open now, null when they never open. */
export function minutesUntilActiveHours(policy: AssistantPolicy, now: number): number | null {
  if (assistantActiveHours(policy, now)) return 0;
  const date = new Date(now),
    elapsed = date.getMinutes() * 60000 + date.getSeconds() * 1000 + date.getMilliseconds();
  for (let hours = 1; hours <= 24; hours++) {
    const at = now - elapsed + hours * 3600000;
    if (assistantActiveHours(policy, at)) return Math.ceil((at - now) / 60000);
  }
  return null;
}

/** Minutes until today's briefing is due (0 when due or past), or null when none is pending. */
export function minutesUntilBriefing(
  briefing: KeepAwakeDemandInput["briefing"],
  now: number,
): number | null {
  if (!briefing?.enabled || briefing.preparedToday) return null;
  const match = /^(\d{2}):(\d{2})$/.exec(briefing.time);
  if (!match) return null;
  const date = new Date(now),
    due = Number(match[1]) * 60 + Number(match[2]),
    current = date.getHours() * 60 + date.getMinutes();
  return Math.max(0, due - current);
}

/** Whether the system should stay awake: running work, or work about to start. */
export function keepAwakeDemand(input: KeepAwakeDemandInput): boolean {
  if (input.running) return true;
  if (input.queuedJobs && input.canStartJobs) {
    const wait = minutesUntilActiveHours(input.policy, input.now);
    if (wait !== null && wait > 0 && wait <= KEEP_AWAKE_HOURS_LOOKAHEAD_MINUTES) return true;
  }
  const briefing = minutesUntilBriefing(input.briefing, input.now);
  return briefing !== null && briefing > 0 && briefing <= KEEP_AWAKE_BRIEFING_LOOKAHEAD_MINUTES;
}

/** Reads the saved briefing schedule and whether today's briefing already exists. */
export async function readKeepAwakeBriefing(
  runtime: <T>(key: string, fallback: T) => Promise<T>,
  now: number,
): Promise<NonNullable<KeepAwakeDemandInput["briefing"]>> {
  const schedule = await runtime("briefingSchedule", { enabled: true, time: "09:00" }),
    date = new Date(now),
    day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return {
    ...schedule,
    preparedToday: !!(await runtime<string | null>(`dailyBriefing:${day}`, null)),
  };
}
