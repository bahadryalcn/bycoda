import type { AccountClient } from "@bycoda/account-contracts";
import { useEffect } from "react";
import { useAccountState } from "../../../account";
import { activityClient } from "../../model/activityClient";
import { createActivitySyncer } from "../model/activitySyncer";

/**
 * Mount next to `useActivityTracker`. While signed in with a registered device it uploads
 * the local day maps at start, at sign-in, hourly, at local day end and when the network
 * returns. Signed out it does nothing. `getApi` is the account's contract client and
 * `onApiError` routes failures such as `device_revoked` to the account. Both must be stable
 * references (module-level functions).
 */
export function useActivitySync(
  machineId: string | undefined,
  getApi: () => AccountClient,
  onApiError?: (error: unknown) => void,
): void {
  const state = useAccountState();
  const userId = state.phase === "signed-in" ? state.context.user.id : null;
  const deviceId = state.phase === "signed-in" ? state.deviceId : null;

  useEffect(() => {
    if (!machineId || !userId || !deviceId) return;
    const local = activityClient(machineId);
    const syncer = createActivitySyncer({
      identity: () => ({ userId, deviceId }),
      listDays: async (range) => (await local.days(range)).days,
      upload: async (days) => {
        await getApi().uploadActivityDays({ body: { days } });
      },
      onError: onApiError,
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const cycle = async () => {
      clearTimeout(timer);
      const result = await syncer.run();
      if (disposed || result === "stopped") return;
      timer = setTimeout(() => cycle().catch(() => undefined), syncer.nextDelayMs());
    };
    const onOnline = () => {
      syncer.resetBackoff();
      cycle().catch(() => undefined);
    };
    window.addEventListener("online", onOnline);
    cycle().catch(() => undefined);
    return () => {
      disposed = true;
      clearTimeout(timer);
      window.removeEventListener("online", onOnline);
    };
  }, [machineId, userId, deviceId, getApi, onApiError]);
}
