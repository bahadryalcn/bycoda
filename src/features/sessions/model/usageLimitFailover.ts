import type {
  ModelRoutingEntry,
  ModelRoutingEntryStatus,
} from "../../../shared/model/host-contracts/model-routing";
import type { ProviderRateLimits } from "../../providers/public/accountUsage";
import { exhaustedWindowResetAt } from "../../providers/public/rateLimitsCache";
import { DEFAULT_PROVIDER_ACCOUNT_ID } from "../../providers/public/providerAccounts";
import type { HarnessId } from "./session";

/** Where a limited chat continues: the provider, model and account it switches to. */
export type FailoverTarget = { harness: HarnessId; model: string; providerAccountId?: string };

/** Without a reported reset, a limited account is skipped for this long. */
export const FAILOVER_HOLD_MS = 30 * 60_000;

/** Usage limits belong to the provider account, not to one model. */
export function failoverAccountKey(harness: HarnessId, providerAccountId?: string): string {
  return `${harness}\n${providerAccountId ?? DEFAULT_PROVIDER_ACCOUNT_ID}`;
}

/**
 * Accounts that hit a limit, held until their reset. A chat bouncing between two limited
 * accounts would otherwise switch back and forth without ever running a turn.
 */
export class LimitedAccounts {
  private readonly until = new Map<string, number>();

  hold(key: string, now: number, resetsAt?: number): void {
    this.until.set(key, Math.max(this.until.get(key) ?? 0, resetsAt ?? now + FAILOVER_HOLD_MS));
  }

  has(key: string, now: number): boolean {
    const until = this.until.get(key);
    if (until === undefined) return false;
    if (until > now) return true;
    this.until.delete(key);
    return false;
  }
}

/**
 * The first other account of the same provider, in the owner's account order, whose quota
 * reads fine right now. An unreadable quota (signed out, offline) is not proof of headroom.
 */
export async function pickAccountFailover(input: {
  harness: HarnessId;
  model: string;
  accountIds: readonly string[];
  limited: (key: string) => boolean;
  readLimits: (accountId: string) => Promise<ProviderRateLimits>;
}): Promise<FailoverTarget | undefined> {
  for (const accountId of input.accountIds) {
    if (input.limited(failoverAccountKey(input.harness, accountId))) continue;
    let limits: ProviderRateLimits;
    try {
      limits = await input.readLimits(accountId);
    } catch {
      continue;
    }
    if (limits.status !== "ok" || exhaustedWindowResetAt(limits) != null) continue;
    return { harness: input.harness, model: input.model, providerAccountId: accountId };
  }
  return undefined;
}

/**
 * The first entry of the Host's main order that its live status does not skip and whose
 * account has not hit a limit. Entry model settings are not carried over: the chat keeps its
 * own effort and options, as with a manual model pick.
 */
export function pickOrderFailover(input: {
  entries: readonly ModelRoutingEntry[];
  statuses: readonly ModelRoutingEntryStatus[];
  limited: (key: string) => boolean;
}): FailoverTarget | undefined {
  const status = new Map(input.statuses.map((entry) => [entry.entryId, entry]));
  for (const entry of input.entries) {
    const live = status.get(entry.id);
    if (live?.skip || live?.leftPercent === 0) continue;
    if (input.limited(failoverAccountKey(entry.harness, entry.providerAccountId))) continue;
    return {
      harness: entry.harness,
      model: entry.model,
      ...(entry.providerAccountId ? { providerAccountId: entry.providerAccountId } : {}),
    };
  }
  return undefined;
}
