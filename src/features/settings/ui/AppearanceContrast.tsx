import { useLayoutEffect, useRef, useState } from "react";
import { t } from "../../../shared/i18n";
import { APPEARANCE_DEFAULTS } from "../model/appearancePreferences";
import { Row, Slider } from "./settingsControls";
import type { AppearanceSettings } from "./useAppearanceSettings";

export function AppearanceContrast({ appearance: a }: { appearance: AppearanceSettings }) {
  const p = a.preferences;
  const [contrastDraft, setContrastDraft] = useState<{ base: number; value: number } | null>(null);
  const contrastInteraction = useRef<{ base: number; cancelled: boolean } | null>(null);
  useLayoutEffect(() => {
    if (contrastInteraction.current && contrastInteraction.current.base !== p.contrast)
      contrastInteraction.current.cancelled = true;
  }, [p.contrast]);
  const shownContrast = contrastDraft?.base === p.contrast ? contrastDraft.value : p.contrast;
  return (
    <Row
      id="interface-contrast"
      label={t("Contrast")}
      description={t("Make structural borders and secondary text softer or stronger.")}
      modified={p.contrast !== APPEARANCE_DEFAULTS.contrast}
      onReset={() => {
        if (contrastInteraction.current) contrastInteraction.current.cancelled = true;
        setContrastDraft(null);
        a.onPreferences({ ...p, contrast: APPEARANCE_DEFAULTS.contrast });
      }}
    >
      <div
        onPointerDownCapture={() => {
          contrastInteraction.current = { base: p.contrast, cancelled: false };
        }}
        onPointerCancelCapture={() => {
          if (contrastInteraction.current) contrastInteraction.current.cancelled = true;
          setContrastDraft(null);
        }}
        onLostPointerCaptureCapture={() => {
          if (contrastInteraction.current) contrastInteraction.current.cancelled = true;
          setContrastDraft(null);
        }}
      >
        <Slider
          label={t("Contrast")}
          value={shownContrast}
          display={`${shownContrast}%`}
          min={75}
          max={150}
          onChange={(value) => {
            const interaction = (contrastInteraction.current ??= {
              base: p.contrast,
              cancelled: false,
            });
            if (!interaction.cancelled && interaction.base === p.contrast)
              setContrastDraft({ base: interaction.base, value });
          }}
          onValueCommit={(contrast) => {
            const interaction = contrastInteraction.current;
            contrastInteraction.current = null;
            setContrastDraft(null);
            if (
              interaction &&
              !interaction.cancelled &&
              interaction.base === p.contrast &&
              contrast !== p.contrast
            )
              a.onPreferences({ ...p, contrast });
          }}
        />
      </div>
    </Row>
  );
}
