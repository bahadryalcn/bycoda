import { t, useLocale } from "../../../../../shared/i18n";
import { DIFF_PALETTE_DEFAULT, type DiffPalette } from "../../../model/appearance";
import { AppearanceContrast } from "../../AppearanceContrast";
import { RadioTiles } from "../../RadioTiles";
import { Group, Row } from "../../settingsControls";
import type { AppearanceSettings } from "../../useAppearanceSettings";
import "./InterfaceSections.css";

const DIFF_OPTIONS: readonly {
  value: DiffPalette;
  label: () => string;
  tag?: () => string;
}[] = [
  { value: "default", label: () => t("Red & green") },
  {
    value: "colorblind",
    label: () => t("Blue & orange"),
    tag: () => t("Colorblind-safe"),
  },
  { value: "high-contrast", label: () => t("Blue & orange · stronger") },
];

/** Contrast and diff colors. Diff colors are swatch cards, each painted with its own palette. */
export function InterfaceReadabilityGroup({ appearance: a }: { appearance: AppearanceSettings }) {
  useLocale();
  return (
    <Group title={t("Readability")}>
      <AppearanceContrast appearance={a} />
      <Row
        id="diff-colors"
        label={t("Diff colors")}
        info={t("Choose how added (+) and removed (−) lines are highlighted.")}
        modified={a.diffPalette !== DIFF_PALETTE_DEFAULT}
        onReset={() => a.onDiffPalette(DIFF_PALETTE_DEFAULT)}
      >
        <RadioTiles
          label={t("Diff colors")}
          className="diff-swatches"
          tileClassName="diff-swatch-card diff-swatch"
          value={a.diffPalette}
          onChange={a.onDiffPalette}
          options={DIFF_OPTIONS.map((option) => ({
            value: option.value,
            data: { "data-palette": option.value },
            children: (
              <>
                <span className="diff-swatch-bars" aria-hidden="true">
                  <span />
                  <span />
                </span>
                <span>{option.label()}</span>
                {option.tag ? <span className="diff-swatch-tag">{option.tag()}</span> : null}
              </>
            ),
          }))}
        />
      </Row>
    </Group>
  );
}
