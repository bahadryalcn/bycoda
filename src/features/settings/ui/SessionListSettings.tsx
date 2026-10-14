import { t, useLocale } from "../../../shared/i18n";
import {
  GROUP_DELAY_MAX_MS,
  GROUP_DELAY_MIN_MS,
  type SessionListDensity,
  updateSessionListDisplay,
  useSessionListDisplay,
} from "../../sessions/model/sessionListDisplay";
import { Group, Row, Segmented, Slider, Toggle } from "./settingsControls";

/** The sidebar's default session row layout; the list's view menu edits the same values. */
export function SessionListSettings() {
  useLocale();
  const display = useSessionListDisplay();
  return (
    <Group id="session-list" title={t("Session list")} persistence={{ mode: "automatic" }}>
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
      <Row label={t("Alternate row shading")}>
        <Toggle
          label={t("Alternate row shading")}
          on={display.striped}
          onChange={(striped) => updateSessionListDisplay({ striped })}
        />
      </Row>
    </Group>
  );
}
