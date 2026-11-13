import { useState } from "react";
import { t } from "../../../shared/i18n/technical";
import { Button } from "../../../shared/ui/Button";
import { Select } from "../../../shared/ui/Select";
import { TextField } from "../../../shared/ui/TextField";
import { RefreshCw } from "../../../shared/ui/icons";

type Viewport = { width: number; height: number };
const presets = [
  { value: "1280x720", label: "Desktop", width: 1280, height: 720 },
  { value: "768x1024", label: "Tablet", width: 768, height: 1024 },
  { value: "390x844", label: "Phone", width: 390, height: 844 },
];

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
    Number.isInteger(next.width) &&
    next.width >= 240 &&
    next.width <= 2560 &&
    Number.isInteger(next.height) &&
    next.height >= 240 &&
    next.height <= 2160;
  const value = `${viewport.width}x${viewport.height}`;
  const changed = next.width !== viewport.width || next.height !== viewport.height;
  const canRotate = viewport.height <= 2560 && viewport.width <= 2160;
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
          min={240}
          max={2560}
          step={1}
          value={width}
          disabled={disabled}
          onChange={(event) => setWidth(event.target.value)}
        />
        <TextField
          label={t("Height")}
          type="number"
          min={240}
          max={2160}
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
              ? t("Width: 240–2560 px. Height: 240–2160 px.")
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
