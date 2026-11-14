import { useState } from "react";
import { lazySurface } from "../../../shared/ui/lazySurface";
import type { RecentProject } from "../../projects/public/recents";
import { ProvidersPageGate } from "./ProvidersPageGate";
import { SettingsPageLoading } from "./SettingsPageLoading";

const UsagePage = lazySurface(
  async () => ({ default: (await import("./UsageSettingsPage")).UsageSettingsPage }),
  { fallback: <SettingsPageLoading lines={8} /> },
);

/** Keep provider account operation owners mounted while the separate Usage page is open. */
export function ProvidersSection({
  activePage = "providers",
  cwd,
  recents,
}: {
  activePage?: "providers" | "usage";
  cwd?: string;
  recents?: RecentProject[];
}) {
  const [usageVisited, setUsageVisited] = useState(activePage === "usage");
  if (activePage === "usage" && !usageVisited) setUsageVisited(true);
  return (
    <>
      <div hidden={activePage !== "providers"}>
        <ProvidersPageGate cwd={cwd} recents={recents} />
      </div>
      <div hidden={activePage !== "usage"}>{usageVisited ? <UsagePage /> : null}</div>
    </>
  );
}
