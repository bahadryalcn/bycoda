import {
  addDays,
  summarize,
  type ActivityDay,
  type ActivitySummary,
  type ActivityTotals,
} from "@bycoda/account-contracts/activity";
import { withTimeout } from "../../../shared/lib/withTimeout";
import type { RemoteMachine } from "../../connections/public/protocol";
import { isLocalSyncMachine } from "../../connections/public/localSync";
import { activityClient } from "./activityClient";

/** A Host whose `activity.days` is read: this computer (`local`) or a connected machine. */
export type MachineRef = { id: string; name: string; local: boolean };

export type MachineActivity = MachineRef & {
  status: "ok" | "unavailable";
  /** Present when `status` is "ok". */
  totals?: ActivityTotals;
};

export type CombinedActivity = { summary: ActivitySummary; machines: MachineActivity[] };

export const MACHINE_TIMEOUT_MS = 8_000;

/**
 * This computer first, then every other saved Host. The same Host reached twice (equal
 * environment id) is listed once. Without a local sync Host the first machine is "local".
 */
export function machineRefs(machines: readonly RemoteMachine[]): MachineRef[] {
  const local = machines.find(isLocalSyncMachine) ?? machines[0];
  const ordered = local ? [local, ...machines.filter((machine) => machine !== local)] : [];
  const seen = new Set<string>();
  const refs: MachineRef[] = [];
  for (const machine of ordered) {
    const key = machine.environmentId || machine.id;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ id: machine.id, name: machine.name, local: machine === local });
  }
  return refs;
}

/** Local dates every figure needs: this year and the last seven days. */
export function activityRange(today: string): { from: string; to: string } {
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const weekStart = addDays(today, -6);
  return { from: yearStart < weekStart ? yearStart : weekStart, to: today };
}

/**
 * Union rule, identical to the account service: entries for one date are OR-merged across
 * machines, so a minute active on two machines counts once and guest numbers equal the cloud
 * summary of the same data. Different machines are different devices (the id is rewritten to
 * the machine id) and are never added up. Unreachable machines (`days: null`) are listed as
 * unavailable and contribute nothing.
 */
export function combineMachineDays(
  results: readonly { machine: MachineRef; days: readonly ActivityDay[] | null }[],
  today: string,
  timeZone: string,
): CombinedActivity {
  const all = results.flatMap(({ machine, days }) =>
    (days ?? []).map((day) => ({ ...day, deviceId: machine.id })),
  );
  const { perDevice, ...summary } = summarize(all, { today, timeZone, perDevice: true });
  const machines = results.map(({ machine, days }): MachineActivity => {
    if (!days) return { ...machine, status: "unavailable" };
    const found = perDevice?.find((entry) => entry.deviceId === machine.id);
    return {
      ...machine,
      status: "ok",
      totals: {
        today: found?.today ?? 0,
        week: found?.week ?? 0,
        month: found?.month ?? 0,
        year: found?.year ?? 0,
      },
    };
  });
  return { summary, machines };
}

export type FetchDays = (
  machineId: string,
  range: { from: string; to: string },
) => Promise<ActivityDay[]>;

const defaultFetchDays: FetchDays = async (machineId, range) =>
  (await withTimeout(activityClient(machineId).days(range), MACHINE_TIMEOUT_MS, "activity.days"))
    .days;

/** Reads every machine in parallel; a failing or slow machine never blocks the others. */
export async function loadCombinedActivity(
  machines: readonly MachineRef[],
  today: string,
  timeZone: string,
  fetchDays: FetchDays = defaultFetchDays,
): Promise<CombinedActivity> {
  const range = activityRange(today);
  const results = await Promise.all(
    machines.map(async (machine) => ({
      machine,
      days: await fetchDays(machine.id, range).catch(() => null),
    })),
  );
  return combineMachineDays(results, today, timeZone);
}
