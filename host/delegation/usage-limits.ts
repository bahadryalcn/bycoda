import type { AssistantQuotaReader } from "../assistant/models/assistant-quota-reader";
import { formatDate, t } from "../../src/shared/i18n/core";
import {
  delegateRefKey,
  type DelegateModelRef,
} from "../../src/shared/model/host-contracts/delegation";

/** Longest one agents call waits for a first quota sample; a slow read counts as unknown. */
const QUOTA_WAIT_MS = 3_000;

/** The Host's quota view (the same samples behind model-order skipping and the usage pages). */
export type DelegationQuota = Pick<AssistantQuotaReader, "warm" | "reading">;

/** A selected model whose account window is spent; `resetsAt` is epoch ms when the provider reported it. */
export type LimitedDelegate = { ref: DelegateModelRef; resetsAt?: number };

/**
 * The refs whose account has no quota left right now. Unknown usage (no sample, stale, failed
 * read, provider without quota data) is never exhausted, and a window whose reset time has
 * passed counts as open again, so an account returns without any state to clear.
 */
export async function limitedDelegates(
  quota: DelegationQuota | undefined,
  refs: readonly DelegateModelRef[],
  now = Date.now(),
): Promise<LimitedDelegate[]> {
  if (!quota || !refs.length) return [];
  await Promise.all(
    [...new Set(refs.map((ref) => ref.harness))].map((harness) =>
      quota.warm(harness, QUOTA_WAIT_MS).catch(() => undefined),
    ),
  );
  return refs.flatMap((ref) => {
    const reading = quota.reading(ref.harness, ref.providerAccountId, ref.model);
    if ("unknown" in reading || reading.leftPercent > 0) return [];
    if (reading.resetsAt !== undefined && reading.resetsAt <= now) return [];
    return [{ ref, ...(reading.resetsAt === undefined ? {} : { resetsAt: reading.resetsAt }) }];
  });
}

/** The refusal an agent reads when it names a model whose account is at its usage limit. */
export function usageLimitMessage(limited: LimitedDelegate): string {
  const model = delegateRefKey(limited.ref);
  return limited.resetsAt === undefined
    ? t("The account for {p0} has reached its usage limit. Choose another model.", { p0: model })
    : t(
        "The account for {p0} has reached its usage limit and resets at {p1}. Choose another model.",
        {
          p0: model,
          p1: formatDate(limited.resetsAt, { dateStyle: "medium", timeStyle: "short" }),
        },
      );
}
