import { useContext, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Tab, TabList, TabPanel, Tabs } from "../../../shared/ui/Tabs";
import { lazySurface } from "../../../shared/ui/lazySurface";
import type { RecentProject } from "../../projects/public/recents";
import { ProvidersPageGate } from "./ProvidersPageGate";
import { SettingsPageLoading } from "./SettingsPageLoading";
import { RevealedSetting } from "./settingsControls";

const UsagePage = lazySurface(
  async () => ({ default: (await import("./UsageSettingsPage")).UsageSettingsPage }),
  { fallback: <SettingsPageLoading lines={8} /> },
);

type ProvidersTab = "accounts" | "usage";

/** Settings rows that live on the usage tab; a search or deep link to one opens it. */
const USAGE_SETTINGS = new Set([
  "provider-usage",
  "show-remaining-usage",
  "account-limits",
  "cost-overview",
]);
const tabFor = (id: string | null | undefined): ProvidersTab | undefined =>
  id ? (USAGE_SETTINGS.has(id) ? "usage" : "accounts") : undefined;

let retainedTab: ProvidersTab = "accounts";

/** Providers: the accounts and CLIs, and what they have used against their limits. */
export function ProvidersSection({ cwd, recents }: { cwd?: string; recents?: RecentProject[] }) {
  useLocale();
  const revealed = useContext(RevealedSetting);
  const [tab, setTabState] = useState<ProvidersTab>(tabFor(revealed) ?? retainedTab);
  const [usageVisited, setUsageVisited] = useState(tab === "usage");
  if (tab === "usage" && !usageVisited) setUsageVisited(true);
  const setTab = (next: ProvidersTab) => {
    retainedTab = next;
    setTabState(next);
  };
  // A new search/deep link selects once; manual tab changes remain stable.
  const [handled, setHandled] = useState(revealed);
  if (handled !== revealed) {
    setHandled(revealed);
    const next = tabFor(revealed);
    if (next) setTabState(next);
  }
  return (
    <div className="settings-topics grid min-w-0 gap-4">
      <Tabs
        value={tab}
        onValueChange={(next) => setTab(next as ProvidersTab)}
        panels="shared"
        size="md"
      >
        <TabList label={t("Providers")}>
          <Tab value="accounts">{t("Accounts")}</Tab>
          <Tab value="usage">{t("Usage & limits")}</Tab>
        </TabList>
        <TabPanel tabIndex={-1}>
          {/* Keep drafts and in-flight account operations owned across tab changes. */}
          <div hidden={tab !== "accounts"}>
            <ProvidersPageGate cwd={cwd} recents={recents} />
          </div>
          <div hidden={tab !== "usage"}>{usageVisited ? <UsagePage /> : null}</div>
        </TabPanel>
      </Tabs>
    </div>
  );
}
