import { invoke } from "@tauri-apps/api/core";
import { remoteRequest } from "../../connections/public/connections";
import { isLocalSyncMachine } from "../../connections/public/localSync";
import type { RemoteMachine } from "../../connections/public/protocol";
import {
  HOST_USAGE_ROWS_METHOD,
  type UsageRowsResult,
} from "../../../shared/model/host-contracts/usage-rows";
import { withTimeout } from "../../../shared/lib/withTimeout";
import { t } from "../../../shared/i18n";
import type { ProviderAccount } from "../../providers/public/providerAccounts";
import {
  fetchModelPrices,
  fetchProviderUsage,
  type ModelPrices,
  type UsageRow,
} from "../../providers/public/providerUsage";
import type { UsageTurnReport } from "../model/usageAnalytics";

export type UsageAccountRead = { account: ProviderAccount; rows: UsageRow[]; failed: boolean };
export type UsageSources = {
  reports: Promise<UsageAccountRead[]>;
  /** Null when the recorded-turn read failed. */
  turns: Promise<UsageTurnReport | null>;
  /** Null when the price list is unavailable. */
  prices: Promise<ModelPrices | null>;
};

/**
 * The reads behind every Usage figure: provider logs per account, recorded turns and prices.
 * The dashboard and the voice report share it so both see the same sources for one interval.
 */
export function loadUsageSources(
  accounts: readonly ProviderAccount[],
  sinceMs: number,
  untilMs: number,
): UsageSources {
  return {
    reports: Promise.all(
      accounts.map(async (account): Promise<UsageAccountRead> => {
        try {
          const report = await fetchProviderUsage(
            account.provider,
            account.id,
            Math.floor(sinceMs / 900_000) * 900_000,
          );
          return { account, rows: report.rows, failed: false };
        } catch {
          return { account, rows: [], failed: true };
        }
      }),
    ),
    turns: invoke<UsageTurnReport>("session_usage_report", { sinceMs, untilMs }).catch(() => null),
    prices: fetchModelPrices().catch(() => null),
  };
}

/** A remote read waits this long; the Host scans up to 90 days of logs on a cold cache. */
export const MACHINE_USAGE_TIMEOUT_MS = 30_000;

export type MachineUsageRead =
  | {
      machine: { id: string; label: string };
      status: "ok";
      accounts: UsageAccountRead[];
      /** Start the Host actually read, later than requested when it clamped the window. */
      sinceMs: number;
      truncated: boolean;
    }
  | { machine: { id: string; label: string }; status: "unavailable" };

/** Saved machines other than this computer, one entry per Host (equal environment id). */
export function otherUsageMachines(
  machines: readonly RemoteMachine[],
): { id: string; label: string }[] {
  const seen = new Set<string>();
  const result: { id: string; label: string }[] = [];
  for (const machine of machines) {
    if (isLocalSyncMachine(machine)) continue;
    const key = machine.environmentId || machine.id;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ id: machine.id, label: machine.name });
  }
  return result;
}

type ReadRows = (machineId: string, sinceMs: number) => Promise<UsageRowsResult>;
const defaultReadRows: ReadRows = (machineId, sinceMs) =>
  withTimeout(
    remoteRequest<UsageRowsResult>(machineId, HOST_USAGE_ROWS_METHOD, { sinceMs }),
    MACHINE_USAGE_TIMEOUT_MS,
    HOST_USAGE_ROWS_METHOD,
  );

/**
 * Provider-log rows of every other machine, read in parallel through its Host. A machine that
 * fails or answers late is `unavailable` and never holds back the others or this computer.
 * Each account becomes its own dashboard account (`<machine id>/<account id>`), named after the
 * machine, so two machines' default accounts stay apart.
 */
export function loadMachineUsage(
  machines: readonly { id: string; label: string }[],
  sinceMs: number,
  readRows: ReadRows = defaultReadRows,
): Promise<MachineUsageRead[]> {
  return Promise.all(
    machines.map(async (machine): Promise<MachineUsageRead> => {
      try {
        const result = await readRows(machine.id, Math.max(0, Math.floor(sinceMs)));
        return {
          machine,
          status: "ok",
          sinceMs: result.sinceMs,
          truncated: result.coverage.truncated,
          accounts: result.accounts.map((entry) => ({
            account: {
              id: `${machine.id}/${entry.accountId}`,
              provider: entry.provider,
              label: `${machine.label} · ${
                entry.accountId === "default" ? t("Default account") : entry.label
              }`,
            },
            rows: entry.rows,
            failed: false,
          })),
        };
      } catch {
        return { machine, status: "unavailable" };
      }
    }),
  );
}
