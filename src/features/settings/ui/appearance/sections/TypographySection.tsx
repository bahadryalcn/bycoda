import { useState } from "react";
import { t, useLocale } from "../../../../../shared/i18n";
import { CodeFontGroup } from "../controls/CodeFontGroup";
import { InterfaceFontGroup } from "../controls/InterfaceFontGroup";
import { TerminalFontGroup } from "../controls/TerminalFontGroup";
import { TypographyPairings } from "../controls/TypographyPairings";
import { TypographyPreview } from "../controls/TypographyPreview";
import { type AppearanceSettings } from "../../useAppearanceSettings";

import { AppearanceSection } from "./AppearanceSection";
/** Settings on the left, one sticky live preview on the right (stacked below 1000px). */
export function TypographySection({ appearance }: { appearance: AppearanceSettings }) {
  useLocale();
  const [sampleSize, setSampleSize] = useState(13);
  return (
    <AppearanceSection id="typography" title={t("Typography")}>
      <div className="typography-layout">
        <div className="typography-controls settings-topics">
          <TypographyPairings appearance={appearance} />
          <InterfaceFontGroup
            appearance={appearance}
            sampleSize={sampleSize}
            onSampleSize={setSampleSize}
          />
          <CodeFontGroup appearance={appearance} />
          <TerminalFontGroup appearance={appearance} />
        </div>
        <TypographyPreview appearance={appearance} sampleSize={sampleSize} />
      </div>
    </AppearanceSection>
  );
}
