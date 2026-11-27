import { useState } from "react";
import {
  BROWSER_VIEWPORT_MAX_HEIGHT,
  BROWSER_VIEWPORT_MAX_WIDTH,
  BROWSER_VIEWPORT_MIN,
  BROWSER_VIEWPORT_PRESETS,
  validBrowserViewportDimension,
} from "../../../shared/lib/browserViewport";
import { t } from "../../../shared/i18n/technical";
import { browserViewportPresetName } from "../model/browserViewportPresetName";
import { Button } from "../../../shared/ui/Button";
import { Select } from "../../../shared/ui/Select";
import { TextField } from "../../../shared/ui/TextField";
import { RotateCcw } from "../../../shared/ui/icons";

type Viewport = { width: number; height: number };
const presets = BROWSER_VIEWPORT_PRESETS.map((preset) => ({
  ...preset,
  value: `${preset.width}x${preset.height}`,
}));
const presetName = (value: string) => {
  const preset = presets.find((item) => item.value === value);
  return preset ? browserViewportPresetName(preset) : value;
};

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
  // Enter and leaving a field apply the draft; presets and Rotate apply at once.
  const apply = () => {
    if (!disabled && valid && changed) onResize(next);
  };
  return (
    <section className="host-browser-viewport-content" aria-label={t("Browser viewport")}>
      <Select
        label={t("Preset")}
        value={value}
        disabled={disabled}
        options={[
          ...presets.map((preset) => ({
            value: preset.value,
            label: `${presetName(preset.value)} (${preset.width} × ${preset.height})`,
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
          apply();
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
          error={width !== "" && !valid ? t("Width: 240–3840 px. Height: 240–2160 px.") : undefined}
          onChange={(event) => setWidth(event.target.value)}
          onBlur={apply}
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
          onBlur={apply}
        />
        <Button
          type="button"
          variant="ghost"
          iconOnly
          label={t("Rotate viewport")}
          disabled={disabled || !canRotate}
          disabledReason={disabledReason}
          onClick={() => onResize({ width: viewport.height, height: viewport.width })}
        >
          <RotateCcw className="icon-sm" aria-hidden />
        </Button>
      </form>
    </section>
  );
}
