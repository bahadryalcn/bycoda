export const DEFAULT_ASSISTANT_POLICY = {
  idleMinutes: 10,
  awayMinutes: 60,
  chiefWakeLimit: 20,
  nudgeLimit: 2,
  activeStart: 0,
  activeEnd: 0,
  notificationPresent: "all" as const,
  notificationAway: "urgent" as const,
  notificationDnd: "none" as const,
  summaryRefreshMessages: 20,
};
export type AssistantPolicy = {
  idleMinutes?: number;
  awayMinutes?: number;
  chiefWakeLimit?: number;
  nudgeLimit?: number;
  activeStart?: number;
  activeEnd?: number;
  notificationPresent?: "all" | "urgent" | "none";
  notificationAway?: "all" | "urgent" | "none";
  notificationDnd?: "none";
  summaryRefreshMessages?: number;
};
export function assistantPolicy(input: AssistantPolicy = {}) {
  return {
    ...DEFAULT_ASSISTANT_POLICY,
    ...Object.fromEntries(
      Object.entries(input).filter(
        ([key, value]) => key in DEFAULT_ASSISTANT_POLICY && value !== undefined,
      ),
    ),
  } as Required<AssistantPolicy>;
}
export function validAssistantPolicy(input: AssistantPolicy): boolean {
  const policy = assistantPolicy(input);
  return policy.idleMinutes < policy.awayMinutes;
}
export function assistantActiveHours(input: AssistantPolicy, now: number): boolean {
  const policy = assistantPolicy(input),
    hour = new Date(now).getHours();
  return (
    policy.activeStart === policy.activeEnd ||
    (policy.activeStart < policy.activeEnd
      ? hour >= policy.activeStart && hour < policy.activeEnd
      : hour >= policy.activeStart || hour < policy.activeEnd)
  );
}
