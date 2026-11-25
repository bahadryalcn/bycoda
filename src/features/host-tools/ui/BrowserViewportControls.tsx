import { useState } from "react";
import { t } from "../../../shared/i18n/technical";
import { Button } from "../../../shared/ui/Button";
import { Select } from "../../../shared/ui/Select";
import { TextField } from "../../../shared/ui/TextField";
import { RotateCcw } from "../../../shared/ui/icons";

type Viewport = { width: number; height: number };
const presets = [
  { value: "1280x720", width: 1280, height: 720 },
  { value: "768x1024", width: 768, height: 1024 },
  { value: "390x844", width: 390, height: 844 },
];
const presetName = (value: string) =>
  value === "1280x720" ? t("Desktop") : value === "768x1024" ? t("Tablet") : t("Phone");

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
          min={240}
          max={2560}
          step={1}
          value={width}
          disabled={disabled}
          error={width !== "" && !valid ? t("Width: 240–2560 px. Height: 240–2160 px.") : undefined}
          onChange={(event) => setWidth(event.target.value)}
          onBlur={apply}
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
