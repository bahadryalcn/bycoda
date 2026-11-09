import { useState } from "react";
import { t, useLocale } from "../../../../../shared/i18n";
import { Slider as ScaleSlider } from "../../../../../shared/ui/Slider";
import { Switch } from "../../../../../shared/ui/Switch";
import {
  DEFAULT_SESSION_LIST_DISPLAY,
  updateSessionListDisplay,
  useSessionListDisplay,
  type SessionListDensity,
} from "../../../../sessions/public/sessionListDisplay";
import { APPEARANCE_DEFAULTS } from "../../../model/appearancePreferences";
import {
  UI_SCALE_DEFAULT,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  UI_SCALE_STEP,
} from "../../../model/uiScale";
import { Group, Row, Segmented, Toggle } from "../../settingsControls";
import { resetSessionRows } from "../appearanceResets";
import type { AppearanceSettings } from "../../useAppearanceSettings";
import { SidebarRowPreview } from "./SidebarRowPreview";
import "./InterfaceSections.css";

const SCALE_MIN = Math.round(UI_SCALE_MIN * 100);
const SCALE_MAX = Math.round(UI_SCALE_MAX * 100);
const SCALE_DEFAULT = Math.round(UI_SCALE_DEFAULT * 100);
// Ticks only: the readout beside the track already names the value, and four labels do not fit a short track.
const SCALE_MARKS = [80, 100, 125, 150].map((value) => ({ value }));
const percent = (value: number) => `${value}%`;

/** Interface scale, control density and sidebar row density, with a live sidebar preview. */
export function InterfaceSizeGroup({ appearance: a }: { appearance: AppearanceSettings }) {
  useLocale();
  const p = a.preferences;
  const display = useSessionListDisplay();
  const scale = Math.round(a.uiScale * 100);
  // The slider previews while dragging; the preference is written on release.
  const [draft, setDraft] = useState<number | null>(null);
  const shownScale = draft ?? scale;
  return (
    <Group title={t("Size and density")}>
      <Row
        id="interface-scale"
        label={t("Interface scale")}
        info={t("You can also use Ctrl+=, Ctrl+-, and Ctrl+0 (Cmd on macOS).")}
        modified={scale !== SCALE_DEFAULT}
        onReset={() => a.onUiScale(SCALE_DEFAULT)}
      >
        <ScaleSlider
          label={t("Interface scale")}
          hideLabel
          showValue={false}
          className="interface-scale-slider"
          value={shownScale}
          min={SCALE_MIN}
          max={SCALE_MAX}
          step={Math.round(UI_SCALE_STEP * 100)}
          marks={SCALE_MARKS}
          format={percent}
          end={
            <span className="min-w-[5ch] shrink-0 text-right text-ui-caption tabular-nums text-content">
              {percent(shownScale)}
            </span>
          }
          onValueChange={setDraft}
          onValueCommit={(value) => {
            setDraft(null);
            a.onUiScale(value);
          }}
        />
      </Row>
      <Row
        id="wheel-zoom"
        label={t("Zoom with Ctrl+wheel")}
        info={t("Code, Markdown, PDF, image and terminal views keep their own Ctrl+wheel zoom.")}
        modified={p.wheelZoom !== APPEARANCE_DEFAULTS.wheelZoom}
        onReset={() => a.onPreferences({ ...p, wheelZoom: APPEARANCE_DEFAULTS.wheelZoom })}
      >
        <Toggle
          label={t("Zoom with Ctrl+wheel")}
          on={p.wheelZoom}
          onChange={(wheelZoom) => a.onPreferences({ ...p, wheelZoom })}
        />
      </Row>
      <Row
        id="control-density"
        label={t("Control density")}
        modified={p.controlDensity !== APPEARANCE_DEFAULTS.controlDensity}
        onReset={() =>
          a.onPreferences({
            ...p,
            controlDensity: APPEARANCE_DEFAULTS.controlDensity,
          })
        }
      >
        <Segmented
          label={t("Control density")}
          value={p.controlDensity}
          options={[
            { value: "compact", label: t("Compact") },
            { value: "comfortable", label: t("Comfortable") },
            { value: "touch", label: t("Touch") },
          ]}
          onChange={(controlDensity) => a.onPreferences({ ...p, controlDensity })}
        />
      </Row>
      <Row
        id="session-list"
        label={t("Row density")}
        modified={
          display.density !== DEFAULT_SESSION_LIST_DISPLAY.density ||
          display.showModel !== DEFAULT_SESSION_LIST_DISPLAY.showModel ||
          display.showBranch !== DEFAULT_SESSION_LIST_DISPLAY.showBranch
        }
        onReset={resetSessionRows}
        feedback={
          <div className="interface-row-details">
            <SidebarRowPreview
              density={display.density}
              showModel={display.showModel}
              showBranch={display.showBranch}
            />
            <Switch
              compact
              label={t("Show model")}
              checked={display.showModel}
              onCheckedChange={(showModel) => updateSessionListDisplay({ showModel })}
            />
            <Switch
              compact
              label={t("Show branch")}
              checked={display.showBranch}
              disabled={display.density === "compact"}
              title={display.density === "compact" ? t("Compact rows have no branch line") : ""}
              onCheckedChange={(showBranch) => updateSessionListDisplay({ showBranch })}
            />
          </div>
        }
      >
        <Segmented<SessionListDensity>
          label={t("Row density")}
          value={display.density}
          options={[
            { value: "compact", label: t("Compact") },
            { value: "standard", label: t("Standard") },
            { value: "detailed", label: t("Detailed") },
          ]}
          onChange={(density) => updateSessionListDisplay({ density })}
        />
      </Row>
    </Group>
  );
}
