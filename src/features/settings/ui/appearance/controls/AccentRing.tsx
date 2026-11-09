import { t, useLocale } from "../../../../../shared/i18n";
import { Badge } from "../../../../../shared/ui/Badge";
import { ACCENT_CONTRAST_TARGET, solidAccentPair } from "../../../model/accentContrast";
import { ACCENT_COLOR_DEFAULT } from "../../../model/appearance";
import type { AppearanceSettings } from "../../useAppearanceSettings";
import { AccentColorPicker } from "./AccentColorPicker";
import "./ThemeControls.css";

/** Accent swatches, custom colour, readability and the contrast of the ink on the accent fill. */
export function AccentRing({ appearance }: { appearance: AppearanceSettings }) {
  useLocale();
  const readability = appearance.preferences.accentReadability;
  const ratio = solidAccentPair(appearance.accentColor ?? ACCENT_COLOR_DEFAULT, readability).ratio;
  const passes = ratio >= ACCENT_CONTRAST_TARGET.auto;
  return (
    <div className="accent-ring">
      <AccentColorPicker
        value={appearance.accentColor}
        onChange={appearance.onAccentColor}
        readability={readability}
        onReadabilityChange={(accentReadability) =>
          appearance.onPreferences({ ...appearance.preferences, accentReadability })
        }
      />
      <Badge size="sm" tone={passes ? "success" : "warning"} className="theme-contrast-readout">
        {`${passes ? "AA" : t("Below AA")} ${ratio.toFixed(1)}:1`}
      </Badge>
    </div>
  );
}
