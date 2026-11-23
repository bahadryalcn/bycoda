import { useState } from "react";
import { t, useLocale } from "../../../../../shared/i18n";
import { COLLAPSED_PROJECT_RAIL_MODE_DEFAULT } from "../../../model/settings";
import {
  DEFAULT_SESSION_LIST_DISPLAY,
  GROUP_DELAY_MAX_MS,
  GROUP_DELAY_MIN_MS,
  updateSessionListDisplay,
  useSessionListDisplay,
} from "../../../../sessions/public/sessionListDisplay";
import { AdvancedSettings, Group, Row, Segmented, Slider } from "../../../../../shared/ui/settings";
import { resetGroupDelay } from "../appearanceResets";
import type { AppearanceSettings } from "../../useAppearanceSettings";

/** Drag grouping and project rail behavior. */
export function InterfaceBehaviorGroup({ appearance: a }: { appearance: AppearanceSettings }) {
  useLocale();
  const display = useSessionListDisplay();
  // The delay has no preview, so it is written on release rather than on every drag tick.
  const [delayDraft, setDelayDraft] = useState<number | null>(null);
  const delay = delayDraft ?? display.groupDelayMs;
  return (
    <Group title={t("Behavior and layout")}>
      <Row
        id="collapsed-project-rail"
        label={t("Collapsed project rail")}
        info={t(
          "Keep project navigation available as a compact icon rail, or hide the rail completely.",
        )}
        modified={a.collapsedProjectRailMode !== COLLAPSED_PROJECT_RAIL_MODE_DEFAULT}
        onReset={() => a.onCollapsedProjectRailMode(COLLAPSED_PROJECT_RAIL_MODE_DEFAULT)}
      >
        <Segmented
          label={t("Collapsed project rail")}
          value={a.collapsedProjectRailMode}
          options={[
            {
              value: "compact",
              get label() {
                return t("Icon rail");
              },
            },
            {
              value: "hidden",
              get label() {
                return t("Hidden");
              },
            },
          ]}
          onChange={a.onCollapsedProjectRailMode}
        />
      </Row>
      <AdvancedSettings>
        <Row
          label={t("Group after holding")}
          info={t("How long a dragged session rests on another before they form a group.")}
          modified={display.groupDelayMs !== DEFAULT_SESSION_LIST_DISPLAY.groupDelayMs}
          onReset={resetGroupDelay}
        >
          <Slider
            label={t("Group after holding")}
            value={delay}
            display={t("{p1} ms", { p1: delay })}
            min={GROUP_DELAY_MIN_MS}
            max={GROUP_DELAY_MAX_MS}
            step={50}
            onChange={setDelayDraft}
            onValueCommit={(groupDelayMs) => {
              updateSessionListDisplay({ groupDelayMs });
              setDelayDraft(null);
            }}
          />
        </Row>
      </AdvancedSettings>
    </Group>
  );
}
