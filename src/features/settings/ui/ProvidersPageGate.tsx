import { useEffect, useSyncExternalStore } from "react";
import type { RecentProject } from "../../projects";
import {
  getHarnessAvailabilitySnapshot,
  hasProbedHarnessAvailability,
  probeHarnessAvailability,
  subscribeHarnessAvailability,
} from "../../../integrations/harness/core/availability";
import { ProvidersPage } from "./ProviderSettings";
import { SettingsPageLoading } from "./SettingsPageLoading";

/**
 * Providers orders and describes every CLI by whether it is installed. Before the first probe
 * every CLI reads as missing, so rendering the page then reorders the list, changes the selected
 * provider and flips each row. Wait for the first probe (a warm app has already done it) and show
 * the shared placeholder meanwhile. A failed probe still marks itself probed, so this cannot hang.
 */
export function ProvidersPageGate(props: { cwd?: string; recents?: RecentProject[] }) {
  useSyncExternalStore(
    subscribeHarnessAvailability,
    getHarnessAvailabilitySnapshot,
    getHarnessAvailabilitySnapshot,
  );
  const probed = hasProbedHarnessAvailability();
  useEffect(() => {
    if (!probed) probeHarnessAvailability().catch(() => undefined);
  }, [probed]);
  return probed ? <ProvidersPage {...props} /> : <SettingsPageLoading lines={10} />;
}
