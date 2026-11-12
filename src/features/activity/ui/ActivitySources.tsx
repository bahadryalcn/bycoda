import { Text } from "../../../shared/ui/Text";
import { t, useLocale } from "../../../shared/i18n";
import { DescriptionItem, DescriptionList } from "../../../shared/ui/DescriptionList";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import type { ActivityOverview } from "../hooks/useActivityOverview";
import { formatActiveMinutes } from "../model/activityTotals";

function figures(totals: { today: number; week: number }) {
  return t("Today {p0} · This week {p1}", {
    p0: formatActiveMinutes(totals.today),
    p1: formatActiveMinutes(totals.week),
  });
}

/** The source note: which machines or devices the figures cover. */
export function activitySourceNote(overview: ActivityOverview): string {
  if (overview.source === "cloud") {
    return overview.devices.length > 1
      ? t("All your devices ({p0})", { p0: overview.devices.length })
      : t("All your devices");
  }
  const connected = overview.machines.filter((machine) => !machine.local).length;
  if (connected === 0) return t("This machine only");
  return connected === 1
    ? t("This machine + 1 connected machine")
    : t("This machine + {p0} connected machines", { p0: connected });
}

/**
 * Scope switch (signed in only), the source note and the per-machine or per-device breakdown
 * for `useActivityOverview`. Unreachable machines show as unavailable and never hide the rest.
 */
export function ActivitySources({ overview }: { overview: ActivityOverview }) {
  useLocale();
  const rows =
    overview.source === "cloud"
      ? overview.devices.map((device) => ({
          key: device.id,
          name: device.name,
          value: figures(device.totals),
        }))
      : overview.machines.map((machine) => ({
          key: machine.id,
          name: machine.local ? t("This machine") : machine.name,
          value: machine.totals ? figures(machine.totals) : t("Unavailable"),
        }));
  return (
    <div className="grid min-w-0 gap-2">
      {overview.canChooseScope ? (
        <SegmentedControl
          label={t("Active time source")}
          value={overview.scope}
          onValueChange={(value) => overview.setScope(value as "all" | "machines")}
          options={[
            { value: "all", label: t("All my devices") },
            { value: "machines", label: t("This machine") },
          ]}
        />
      ) : null}
      <Text as="p" size="secondary" tone="muted">
        {activitySourceNote(overview)}
      </Text>
      {rows.length > 1 ? (
        <DescriptionList size="sm">
          {rows.map((row) => (
            <DescriptionItem key={row.key} term={row.name}>
              {row.value}
            </DescriptionItem>
          ))}
        </DescriptionList>
      ) : null}
    </div>
  );
}
