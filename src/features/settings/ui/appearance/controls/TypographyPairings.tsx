import { useEffect } from "react";
import { t, useLocale } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { Dices } from "../../../../../shared/ui/icons";
import { registerBundledFont } from "../../../model/fontFaceLoader";
import {
  CODE_FONT_CATALOG,
  FONT_PAIRINGS,
  INTERFACE_FONT_CATALOG,
  fontFamilyValue,
  randomFontPairing,
  type FontEntry,
} from "../../../model/fontCatalog";
import { RadioTiles } from "../../RadioTiles";
import { Group } from "../../../../../shared/ui/settings";
import type { AppearanceSettings } from "../../useAppearanceSettings";
import "./TypographySamples.css";

const pairKey = (pair: { interfaceFont: string; codeFont: string }) =>
  `${pair.interfaceFont}|${pair.codeFont}`;

/** One-click interface + code pairs, and a random pair. Both fonts change together. */
export function TypographyPairings({ appearance: a }: { appearance: AppearanceSettings }) {
  useLocale();
  const p = a.preferences;
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Register this section's specimen families in the document font set.
  useEffect(() => {
    for (const pair of FONT_PAIRINGS) {
      registerBundledFont(fontFamilyValue(INTERFACE_FONT_CATALOG, pair.interfaceFont));
      registerBundledFont(fontFamilyValue(CODE_FONT_CATALOG, pair.codeFont));
    }
  }, []);
  const apply = (interfaceFont: string, codeFont: string) =>
    a.onPreferences({ ...p, interfaceFont, codeFont });
  return (
    <Group
      title={t("Pairings")}
      action={
        <Button
          size="sm"
          startIcon={<Dices />}
          onClick={() => {
            const pair = randomFontPairing();
            apply(pair.interfaceFont, pair.codeFont);
          }}
        >
          {t("Random")}
        </Button>
      }
    >
      <RadioTiles
        label={t("Pairings")}
        className="font-pairings"
        tileClassName="font-pairing"
        value={
          FONT_PAIRINGS.map(pairKey).find(
            (key) => key === pairKey({ interfaceFont: p.interfaceFont, codeFont: p.codeFont }),
          ) ?? ""
        }
        onChange={(key) => {
          const pair = FONT_PAIRINGS.find((item) => pairKey(item) === key);
          if (pair) apply(pair.interfaceFont, pair.codeFont);
        }}
        options={FONT_PAIRINGS.map((pair) => ({
          value: pairKey(pair),
          children: (
            <>
              <span
                className="font-pairing-interface"
                style={specimenStyle(INTERFACE_FONT_CATALOG, pair.interfaceFont, "sans-serif")}
              >
                {pair.interfaceFont}
              </span>
              <span
                className="font-pairing-code"
                style={specimenStyle(CODE_FONT_CATALOG, pair.codeFont, "monospace")}
              >
                {pair.codeFont}
              </span>
            </>
          ),
        }))}
      />
    </Group>
  );
}

function specimenStyle(
  catalog: readonly FontEntry[],
  id: string,
  fallback: "sans-serif" | "monospace",
) {
  const family = fontFamilyValue(catalog, id);
  return { fontFamily: family ? `"${family}", ${fallback}` : undefined };
}
