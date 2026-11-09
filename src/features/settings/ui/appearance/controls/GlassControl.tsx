import { t } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { IS_LINUX, IS_MAC } from "../../../../../platform/tauri/platform";
import {
  BODY_GLASS_DEFAULT,
  WINDOW_GLASS_DEFAULT,
  SIDEBAR_OPACITY_DEFAULT,
  MAIN_OPACITY_DEFAULT,
  SIDEBAR_BLUR_DEFAULT,
  SIDEBAR_OPACITY_MIN,
  SIDEBAR_OPACITY_MAX,
  MAIN_OPACITY_MIN,
  MAIN_OPACITY_MAX,
  SIDEBAR_BLUR_MIN,
  SIDEBAR_BLUR_MAX,
} from "../../../model/appearance";
import { saveLiveBackground } from "../../../model/liveBackground";
import { Group, Row, Slider, SettingsFeedback, Toggle } from "../../settingsControls";
import { WindowGlassFeedback } from "../../WindowGlassFeedback";
import { AppearanceSaveFeedback, type AppearanceSettings } from "../../useAppearanceSettings";

/**
 * Translucency controls are always rendered. When glass cannot apply (live background covering the
 * window, light scheme, or Glass turned off) the controls stay visible but inert, with the reason.
 */
export function GlassControl({
  appearance,
  light,
  covered,
}: {
  appearance: AppearanceSettings;
  light: boolean;
  covered: boolean;
}) {
  const glassOn = IS_LINUX || appearance.windowGlass;
  const active = !light && !covered && glassOn;
  const reason = covered
    ? t("Window glass is hidden while the live background is on.")
    : light
      ? t("Window glass is unavailable in light mode.")
      : t("Turn on Glass to change translucency.");
  const percent = Math.round(appearance.opacity * 100);
  const mainPercent = Math.round(appearance.mainOpacity * 100);
  const modified =
    percent !== Math.round(SIDEBAR_OPACITY_DEFAULT * 100) ||
    mainPercent !== Math.round(MAIN_OPACITY_DEFAULT * 100) ||
    appearance.blur !== SIDEBAR_BLUR_DEFAULT ||
    appearance.bodyGlass !== BODY_GLASS_DEFAULT ||
    appearance.windowGlass !== WINDOW_GLASS_DEFAULT;
  return (
    <Group
      title={t("Translucency")}
      modified={modified}
      resetLabel={t("Reset translucency")}
      onReset={() => {
        appearance.onOpacity(Math.round(SIDEBAR_OPACITY_DEFAULT * 100));
        appearance.onMainOpacity(Math.round(MAIN_OPACITY_DEFAULT * 100));
        appearance.onBlur(SIDEBAR_BLUR_DEFAULT);
        appearance.onBodyGlass(BODY_GLASS_DEFAULT);
        appearance.onWindowGlass(WINDOW_GLASS_DEFAULT);
      }}
    >
      <WindowGlassFeedback light={light} />
      {!active ? (
        <SettingsFeedback
          state="warning"
          action={
            covered ? (
              <Button onClick={() => saveLiveBackground("none")}>{t("Turn off Live")}</Button>
            ) : undefined
          }
        >
          {reason}
        </SettingsFeedback>
      ) : null}
      <Row
        id="sidebar-opacity"
        label={t("Sidebar opacity")}
        description={t("How much of the window shows through the sidebar.")}
        disabled={!active}
        disabledReason={reason}
      >
        <Slider
          label={t("Sidebar opacity")}
          value={percent}
          display={`${percent}%`}
          min={Math.round(SIDEBAR_OPACITY_MIN * 100)}
          max={Math.round(SIDEBAR_OPACITY_MAX * 100)}
          onChange={appearance.onOpacity}
          disabled={!active}
        />
      </Row>
      <Row
        id="main-pane-glass"
        label={t("Main pane glass")}
        description={t("Let the main pane show through as well.")}
        disabled={!active}
        disabledReason={reason}
      >
        <Toggle
          label={t("Main pane glass")}
          on={appearance.bodyGlass}
          onChange={appearance.onBodyGlass}
          disabled={!active}
        />
      </Row>
      {appearance.bodyGlass ? (
        <Row
          id="main-pane-opacity"
          label={t("Main pane opacity")}
          disabled={!active}
          disabledReason={reason}
        >
          <Slider
            label={t("Main pane opacity")}
            value={mainPercent}
            display={`${mainPercent}%`}
            min={Math.round(MAIN_OPACITY_MIN * 100)}
            max={Math.round(MAIN_OPACITY_MAX * 100)}
            onChange={appearance.onMainOpacity}
            disabled={!active}
          />
        </Row>
      ) : null}
      <Row
        id="blur"
        label={t("Blur radius")}
        dependency={IS_MAC ? undefined : t("Adjustable on macOS only.")}
        disabled={!active || !IS_MAC}
        disabledReason={IS_MAC ? reason : undefined}
      >
        <Slider
          label={t("Blur radius")}
          value={appearance.blur}
          display={`${appearance.blur}px`}
          min={SIDEBAR_BLUR_MIN}
          max={SIDEBAR_BLUR_MAX}
          onChange={appearance.onBlur}
          disabled={!active || !IS_MAC}
        />
      </Row>
      <AppearanceSaveFeedback
        settingIds={[
          "sidebar-opacity",
          "main-pane-opacity",
          "blur",
          "main-pane-glass",
          "window-glass",
        ]}
      />
    </Group>
  );
}
