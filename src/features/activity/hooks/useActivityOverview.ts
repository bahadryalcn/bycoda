import {
  localDateFor,
  type ActivitySummary,
  type ActivityTotals,
} from "@bycoda/account-contracts/activity";
import { useEffect, useMemo, useState } from "react";
import { dateTimeFormat } from "../../../shared/lib/intl";
import { accountApi, reportAccountFailure, useAccountState } from "../../account";
import { useRemoteMachines } from "../../connections/public/connections";
import { loadCombinedActivity, machineRefs, type MachineActivity } from "../model/machineActivity";

const REFRESH_MS = 60_000;

/** `all`: the account's cloud summary over every device. `machines`: this machine plus connected Hosts. */
export type ActivityScope = "all" | "machines";

export type DeviceActivity = { id: string; name: string; totals: ActivityTotals };

export type ActivityOverview = {
  /** Where the figures come from: the cloud (signed in, scope `all`) or the machines read directly. */
  source: "cloud" | "machines";
  scope: ActivityScope;
  setScope: (scope: ActivityScope) => void;
  /** Offered only while signed in. */
  canChooseScope: boolean;
  summary: ActivitySummary | null;
  failed: boolean;
  /** Per-machine totals (source `machines`). */
  machines: MachineActivity[];
  /** Per-device totals (source `cloud`). */
  devices: DeviceActivity[];
};

type Loader<T> = { key: string; load: () => Promise<T> };

/** Loads now and every minute while `loader` is set; `loader.key` identifies what it loads. */
function usePolled<T>(loader: Loader<T> | null, onError?: (error: unknown) => void) {
  const [state, setState] = useState<{ value: T | null; failed: boolean }>({
    value: null,
    failed: false,
  });
  const key = loader?.key ?? null;
  const load = loader?.load;
  useEffect(() => {
    if (key === null || !load) return;
    let cancelled = false;
    const run = async () => {
      try {
        const value = await load();
        if (!cancelled) setState({ value, failed: false });
      } catch (error) {
        if (!cancelled) setState((current) => ({ value: current.value, failed: true }));
        onError?.(error);
      }
    };
    run().catch(() => undefined);
    const timer = setInterval(() => run().catch(() => undefined), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // `key` stands for the loader; `load` is a new closure on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [key]);
  return state;
}

const zone = () => dateTimeFormat().resolvedOptions().timeZone;

/**
 * Active-time figures for the card. Signed out (guest): this machine plus every connected
 * machine, merged per day by union like the account does. Signed in: the cloud summary of all
 * the account's devices, with the machine view selectable; if the cloud cannot answer, the
 * machine view is shown instead.
 */
export function useActivityOverview(): ActivityOverview {
  const account = useAccountState();
  const signedIn = account.phase === "signed-in";
  const [choice, setScope] = useState<ActivityScope>("all");
  const { machines } = useRemoteMachines();
  const refs = useMemo(() => machineRefs(machines), [machines]);

  const local = usePolled(
    refs.length > 0
      ? {
          key: refs.map((ref) => ref.id).join("|"),
          load: () => {
            const timeZone = zone();
            return loadCombinedActivity(refs, localDateFor(new Date(), timeZone), timeZone);
          },
        }
      : null,
  );
  const wantsCloud = signedIn && choice === "all";
  const cloud = usePolled(
    wantsCloud
      ? {
          key: "cloud",
          load: async () => {
            const timeZone = zone();
            const api = accountApi();
            const summary = await api.getActivitySummary({
              query: { timeZone, date: localDateFor(new Date(), timeZone) },
            });
            const names = new Map<string, string>();
            try {
              for (const device of (await api.listDevices()).items) {
                names.set(device.id, device.name);
              }
            } catch {
              // Names are decoration; ids still identify the devices.
            }
            return { summary, names };
          },
        }
      : null,
    reportAccountFailure,
  );

  const useCloud = wantsCloud && cloud.value !== null;
  const devices: DeviceActivity[] = useCloud
    ? (cloud.value?.summary.perDevice ?? []).map((entry) => ({
        id: entry.deviceId,
        name: cloud.value?.names.get(entry.deviceId) ?? entry.deviceId,
        totals: { today: entry.today, week: entry.week, month: entry.month, year: entry.year },
      }))
    : [];
  return {
    source: useCloud ? "cloud" : "machines",
    scope: signedIn ? choice : "machines",
    setScope,
    canChooseScope: signedIn,
    summary: useCloud ? (cloud.value?.summary ?? null) : (local.value?.summary ?? null),
    failed: !useCloud && local.value === null && local.failed,
    machines: local.value?.machines ?? [],
    devices,
  };
}
