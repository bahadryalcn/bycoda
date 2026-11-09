import { t, useLocale } from "../../../shared/i18n";
import {
  DEFAULT_SESSION_LIST_DISPLAY,
  GROUP_DELAY_MAX_MS,
  GROUP_DELAY_MIN_MS,
  updateSessionListDisplay,
  useSessionListDisplay,
  type SessionListDensity,
} from "../../sessions/public/sessionListDisplay";
import {
  AUTO_ARCHIVE_DAY_OPTIONS,
  AUTO_SETTLE_DAY_OPTIONS,
  useAutoSettleSetting,
} from "../../sessions/public/sessionLifecycle";
import { toast } from "../../../shared/ui/ToastRegion";

import { Group, Row, Segmented, Select, Slider, Toggle } from "./settingsControls";

/** The sidebar's default session row layout; the list's view menu edits the same values. */
export function SessionListSettings() {
  useLocale();
  const display = useSessionListDisplay();
  const autoSettle = useAutoSettleSetting();
  return (
    <Group
      id="session-list"
      title={t("Session list")}
      modified={
        display.density !== DEFAULT_SESSION_LIST_DISPLAY.density ||
        display.showModel !== DEFAULT_SESSION_LIST_DISPLAY.showModel ||
        display.showBranch !== DEFAULT_SESSION_LIST_DISPLAY.showBranch ||
        display.groupDelayMs !== DEFAULT_SESSION_LIST_DISPLAY.groupDelayMs
      }
      resetLabel={t("Reset session list")}
      onReset={() => updateSessionListDisplay({ ...DEFAULT_SESSION_LIST_DISPLAY })}
    >
      <Row
        label={t("Row density")}
        description={t("How many lines each session uses in the sidebar.")}
      >
        <Segmented<SessionListDensity>
          label={t("Row density")}
          value={display.density}
          options={[
            {
              value: "compact",
              get label() {
                return t("Compact");
              },
            },
            {
              value: "standard",
              get label() {
                return t("Standard");
              },
            },
            {
              value: "detailed",
              get label() {
                return t("Detailed");
              },
            },
          ]}
          onChange={(density) => updateSessionListDisplay({ density })}
        />
      </Row>
      <Row label={t("Show model")}>
        <Toggle
          label={t("Show model")}
          on={display.showModel}
          onChange={(showModel) => updateSessionListDisplay({ showModel })}
        />
      </Row>
      <Row label={t("Show branch")}>
        <Toggle
          label={t("Show branch")}
          on={display.showBranch}
          onChange={(showBranch) => updateSessionListDisplay({ showBranch })}
        />
      </Row>
      {autoSettle ? (
        <Row
          label={t("Auto-settle after")}
          description={t(
            "Idle sessions move to the Settled group. Pinned, archived and running sessions stay. A new message makes a session active again.",
          )}
        >
          <DaysSelect
            label={t("Auto-settle after")}
            value={autoSettle.afterDays}
            options={AUTO_SETTLE_DAY_OPTIONS}
            onChange={(afterDays) => autoSettle.change({ afterDays })}
          />
        </Row>
      ) : null}
      {autoSettle && autoSettle.archiveAfterDays !== undefined ? (
        <Row
          label={t("Archive settled after")}
          description={t(
            "Sessions that stay in the Settled group this long are archived. Pinned and running sessions stay. Archived sessions can be restored from Archive.",
          )}
        >
          <DaysSelect
            label={t("Archive settled after")}
            value={autoSettle.archiveAfterDays}
            options={AUTO_ARCHIVE_DAY_OPTIONS}
            onChange={(archiveAfterDays) =>
              autoSettle.change({ afterDays: autoSettle.afterDays, archiveAfterDays })
            }
          />
        </Row>
      ) : null}
      <Row
        label={t("Group after holding")}
        description={t("How long a dragged session rests on another before they form a group.")}
      >
        <Slider
          label={t("Group after holding")}
          value={display.groupDelayMs}
          display={`${display.groupDelayMs} ms`}
          min={GROUP_DELAY_MIN_MS}
          max={GROUP_DELAY_MAX_MS}
          step={50}
          onChange={(groupDelayMs) => updateSessionListDisplay({ groupDelayMs })}
        />
      </Row>
    </Group>
  );
}

/** Off or a number of days; a failed save is reported and the Host's value stays shown. */
function DaysSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: number | null;
  options: readonly number[];
  onChange: (days: number | null) => Promise<void>;
}) {
  return (
    <Select
      hideLabel
      label={label}
      value={value === null ? "off" : String(value)}
      options={[
        { value: "off", label: t("Off") },
        ...options.map((days) => ({
          value: String(days),
          label: days === 1 ? t("1 day") : t("{p0} days", { p0: days }),
        })),
      ]}
      onChange={(next) =>
        onChange(next === "off" ? null : Number(next)).catch((cause: unknown) =>
          toast.show({
            tone: "danger",
            message: cause instanceof Error ? cause.message : t("Could not update the session."),
          }),
        )
      }
    />
  );
}
