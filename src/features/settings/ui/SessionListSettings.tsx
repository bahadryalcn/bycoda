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
          <Select
            hideLabel
            label={t("Auto-settle after")}
            value={autoSettle.afterDays === null ? "off" : String(autoSettle.afterDays)}
            options={[
              { value: "off", label: t("Off") },
              ...AUTO_SETTLE_DAY_OPTIONS.map((days) => ({
                value: String(days),
                label: days === 1 ? t("1 day") : t("{p0} days", { p0: days }),
              })),
            ]}
            onChange={(value) =>
              autoSettle
                .change({ afterDays: value === "off" ? null : Number(value) })
                .catch((cause: unknown) =>
                  toast.show({
                    tone: "danger",
                    message:
                      cause instanceof Error ? cause.message : t("Could not update the session."),
                  }),
                )
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
