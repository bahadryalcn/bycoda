import { useRef, useState } from "react";
import { themePalette } from "../../../../../shared/theme/palette";
import { t, useLocale } from "../../../../../shared/i18n";
import { ColorPickerPopover, ColorSwatchRow } from "../../../../../shared/ui/ColorPickerPopover";
import { Popover } from "../../../../../shared/ui/Popover";
import { Button } from "../../../../../shared/ui/Button";
import { ACCENT_COLOR_DEFAULT } from "../../../model/appearance";
import { settingDomId } from "../../settingsControls";
import "./ThemeControls.css";

export const ACCENT_COLOR_PRESETS = [
  themePalette.hex4da3f5,
  themePalette.hex8b5cf6,
  themePalette.hexec4899,
  themePalette.hexef4444,
  themePalette.hexf59e0b,
  themePalette.hex10b981,
] as const;

export function AccentColorPicker({
  value,
  onChange,
  readability,
  onReadabilityChange,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  readability?: "auto" | "strong";
  onReadabilityChange?: (value: "auto" | "strong") => void;
}) {
  useLocale();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const colorIndex = value
    ? ACCENT_COLOR_PRESETS.indexOf(value as (typeof ACCENT_COLOR_PRESETS)[number])
    : -1;
  const presetIndex =
    value == null || value.toLowerCase() === ACCENT_COLOR_DEFAULT.toLowerCase()
      ? 0
      : colorIndex >= 0
        ? colorIndex + 1
        : -1;

  return (
    <div
      ref={root}
      className={`appearance-accent${onReadabilityChange ? " appearance-accent-with-readability" : ""}`}
    >
      <ColorSwatchRow
        className="appearance-accent-swatches"
        colors={[ACCENT_COLOR_DEFAULT, ...ACCENT_COLOR_PRESETS]}
        labels={[
          t("Default"),
          t("Blue"),
          t("Violet"),
          t("Pink"),
          t("Red"),
          t("Orange"),
          t("Green"),
        ]}
        colorIndex={presetIndex >= 0 ? presetIndex : undefined}
        customColor={presetIndex < 0 ? (value ?? undefined) : undefined}
        customPickerOpen={open}
        onPickIndex={(index) => {
          setOpen(false);
          onChange(
            index === 0
              ? ACCENT_COLOR_DEFAULT
              : (ACCENT_COLOR_PRESETS[index - 1] ?? ACCENT_COLOR_PRESETS[0]),
          );
        }}
        onToggleCustom={() => setOpen((current) => !current)}
      />
      {onReadabilityChange && (
        <Button
          id={settingDomId("accent-readability")}
          data-setting-id="accent-readability"
          className="accent-readability-toggle"
          variant="secondary"
          size="sm"
          pressed={readability === "strong"}
          aria-label={t("Accent readability")}
          tooltip={t("Strong readability: text on the accent keeps at least 7:1 contrast")}
          onClick={() => onReadabilityChange(readability === "strong" ? "auto" : "strong")}
        >
          {t("Strong")}
        </Button>
      )}
      {open ? (
        <Popover
          anchor={root}
          side="bottom"
          align="end"
          width={248}
          flow="scroll"
          onDismiss={() => setOpen(false)}
          className="px-2 pb-2"
        >
          <ColorPickerPopover value={value ?? ACCENT_COLOR_PRESETS[0]} onChange={onChange} />
        </Popover>
      ) : null}
    </div>
  );
}
