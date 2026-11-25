import { useState } from "react";
import {
  BROWSER_VIEWPORT_MAX_HEIGHT,
  BROWSER_VIEWPORT_MAX_WIDTH,
  BROWSER_VIEWPORT_MIN,
  BROWSER_VIEWPORT_PRESETS,
  validBrowserViewportDimension,
} from "../../../shared/lib/browserViewport";
import { t } from "../../../shared/i18n/technical";
import { Button } from "../../../shared/ui/Button";
import { Select } from "../../../shared/ui/Select";
import { TextField } from "../../../shared/ui/TextField";
import { RefreshCw } from "../../../shared/ui/icons";

type Viewport = { width: number; height: number };
const presets = BROWSER_VIEWPORT_PRESETS.map((preset) => ({
  ...preset,
  value: `${preset.width}x${preset.height}`,
}));

/** Explicit page resizing; the owner keys this editor by Host dimensions to reset its draft. */
export function BrowserViewportControls({
  viewport,
  disabled,
  disabledReason,
  onResize,
}: {
  viewport: Viewport;
  disabled: boolean;
  disabledReason?: string;
  onResize: (viewport: Viewport) => void;
}) {
  const [width, setWidth] = useState(String(viewport.width));
  const [height, setHeight] = useState(String(viewport.height));
  const next = { width: Number(width), height: Number(height) };
  const valid =
    validBrowserViewportDimension(next.width, BROWSER_VIEWPORT_MAX_WIDTH) &&
    validBrowserViewportDimension(next.height, BROWSER_VIEWPORT_MAX_HEIGHT);
  const value = `${viewport.width}x${viewport.height}`;
  const changed = next.width !== viewport.width || next.height !== viewport.height;
  const canRotate =
    viewport.height <= BROWSER_VIEWPORT_MAX_WIDTH && viewport.width <= BROWSER_VIEWPORT_MAX_HEIGHT;
  return (
    <section className="host-browser-viewport-content" aria-label={t("Browser viewport")}>
      <Select
        label={t("Preset")}
        value={value}
        disabled={disabled}
        options={[
          ...presets.map((preset) => ({
            value: preset.value,
            label: `${t(preset.label)} (${preset.width} × ${preset.height})`,
          })),
          ...(!presets.some((preset) => preset.value === value)
            ? [{ value, label: `${t("Custom")} (${viewport.width} × ${viewport.height})` }]
            : []),
        ]}
        description={disabled ? disabledReason : undefined}
        onValueChange={(selected) => {
          const preset = presets.find((item) => item.value === selected);
          if (!disabled && preset) onResize({ width: preset.width, height: preset.height });
        }}
      />
      <form
        className="host-browser-viewport-fields"
        onSubmit={(event) => {
          event.preventDefault();
          if (!disabled && valid && changed) onResize(next);
        }}
      >
        <TextField
          label={t("Width")}
          autoFocus
          type="number"
          min={BROWSER_VIEWPORT_MIN}
          max={BROWSER_VIEWPORT_MAX_WIDTH}
          step={1}
          value={width}
          disabled={disabled}
          onChange={(event) => setWidth(event.target.value)}
        />
        <TextField
          label={t("Height")}
          type="number"
          min={BROWSER_VIEWPORT_MIN}
          max={BROWSER_VIEWPORT_MAX_HEIGHT}
          step={1}
          value={height}
          disabled={disabled}
          onChange={(event) => setHeight(event.target.value)}
        />
        <Button
          type="button"
          variant="ghost"
          iconOnly
          label={t("Rotate viewport")}
          disabled={disabled || !canRotate}
          disabledReason={disabledReason ?? t("Viewport dimensions must fit the supported limits.")}
          tooltipDetails={[`${viewport.height} × ${viewport.width}`]}
          onClick={() => onResize({ width: viewport.height, height: viewport.width })}
        >
          <RefreshCw className="icon-sm" aria-hidden />
        </Button>
        <Button
          type="submit"
          variant="secondary"
          size="sm"
          disabled={disabled || !valid || !changed}
          disabledReason={
            disabledReason ??
            (!valid
              ? t("Viewport dimensions must fit the supported limits.")
              : t("Viewport already uses these dimensions."))
          }
          tooltip={t("Change page dimensions to test responsive layouts.")}
        >
          {t("Apply")}
        </Button>
      </form>
    </section>
  );
}
