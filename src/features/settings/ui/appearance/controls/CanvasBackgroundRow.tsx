import { t, useLocale } from "../../../../../shared/i18n";
import type { CanvasBackground } from "../../../model/appearancePreferences";
import { Row, Segmented } from "../../../../../shared/ui/settings";
import type { AppearanceSettings } from "../../useAppearanceSettings";

/**
 * Background tone row: Pure paints the shared canvas pure black (dark) or white (light) for every
 * tint, custom surface colors included; Tinted keeps the tinted canvas.
 */
export function CanvasBackgroundRow({ appearance: a }: { appearance: AppearanceSettings }) {
  useLocale();
  const save = (canvasBackground: CanvasBackground) =>
    a.onPreferences({ ...a.preferences, canvasBackground });
  return (
    <Row id="canvas-background" label={t("Background tone")}>
      <Segmented<CanvasBackground>
        label={t("Background tone")}
        value={a.preferences.canvasBackground}
        options={[
          { value: "pure", label: t("Pure") },
          { value: "tinted", label: t("Tinted") },
        ]}
        onChange={save}
      />
    </Row>
  );
}
