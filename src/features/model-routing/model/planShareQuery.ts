import { useQuery } from "@tanstack/react-query";
import {
  HOST_USAGE_PLAN_SHARE_METHOD,
  PlanShareResultSchema,
  type PlanShareObservation,
  type PlanShareParams,
  type PlanShareResult,
  type PlanShareWindow,
} from "../../../shared/model/host-contracts/usage-plan-share";
import { remoteRequest } from "../../connections/public/connections";
import { useRateLimitHistory, type QuotaSample } from "../../providers/public/rateLimitHistory";

const KIND: Record<PlanShareWindow, QuotaSample["kind"]> = {
  fiveHour: "session",
  weekly: "weekly",
};
const MAX_OBSERVATIONS = 16_000;

/** The desktop's quota history for one window kind, in the shape the Host attributes. */
export function planShareObservations(
  samples: readonly QuotaSample[],
  window: PlanShareWindow,
  accounts?: readonly string[],
): PlanShareObservation[] {
  return samples
    .filter(
      (sample) => sample.kind === KIND[window] && (!accounts || accounts.includes(sample.account)),
    )
    .slice(-MAX_OBSERVATIONS)
    .map((sample) => ({
      account: sample.account,
      at: Math.round(sample.at),
      usedPercent: sample.used,
      windowMinutes: sample.minutes,
      resetsAt: sample.resetsAt === null ? null : Math.round(sample.resetsAt),
    }));
}

/** Changes whenever any account gets a newer reading, so the estimate refreshes with the quota. */
export function planShareFingerprint(observations: readonly PlanShareObservation[]): string {
  const latest = new Map<string, number>();
  for (const entry of observations)
    latest.set(entry.account, Math.max(latest.get(entry.account) ?? 0, entry.at));
  return JSON.stringify([...latest].sort());
}

/**
 * Estimated plan share per job for one quota window. Estimates only; `supported` is false (and
 * nothing is fetched) when the Host lacks `usage.planShare.v1`.
 */
export function usePlanShare(options: {
  machineId: string | undefined;
  supported: boolean;
  window: PlanShareWindow;
  accounts?: string[];
  sessionIds?: string[];
  taskIds?: string[];
  limit?: number;
}) {
  const { machineId, supported, window, accounts, sessionIds, taskIds, limit = 5 } = options;
  const history = useRateLimitHistory();
  const observations = planShareObservations(history, window, accounts);
  const enabled = supported && !!machineId;
  const query = useQuery({
    queryKey: [
      HOST_USAGE_PLAN_SHARE_METHOD,
      machineId,
      window,
      accounts,
      sessionIds,
      taskIds,
      limit,
      planShareFingerprint(observations),
    ],
    enabled,
    queryFn: async (): Promise<PlanShareResult> => {
      const params: Omit<PlanShareParams, "limit"> & { limit: number } = {
        window,
        observations,
        limit,
        ...(accounts ? { accounts } : {}),
        ...(sessionIds ? { sessionIds } : {}),
        ...(taskIds ? { taskIds } : {}),
      };
      return PlanShareResultSchema.parse(
        await remoteRequest(machineId!, HOST_USAGE_PLAN_SHARE_METHOD, params),
      );
    },
    staleTime: 60_000,
    retry: false,
  });
  return {
    supported: enabled,
    result: query.data,
    loading: enabled && query.isPending,
    error: query.error instanceof Error ? query.error.message : undefined,
    refetch: query.refetch,
  };
}
