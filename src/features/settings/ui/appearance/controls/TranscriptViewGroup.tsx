import { formatNumber, t, useLocale } from "../../../../../shared/i18n";
import { Group, Row, Segmented } from "../../../../../shared/ui/settings";
import {
  APPEARANCE_DEFAULTS,
  TRANSCRIPT_ACTIONS,
  TRANSCRIPT_CARDS,
  TRANSCRIPT_SURFACES,
  type AppearancePreferences,
} from "../../../model/appearancePreferences";
import type { AppearanceSettings } from "../../useAppearanceSettings";
import { DraftSlider } from "./DraftSlider";

export type SliderField =
  | "transcriptSurfaceOpacity"
  | "transcriptSurfaceBlur"
  | "userMessageOpacity"
  | "transcriptBodyInk"
  | "transcriptChromeInk";

const SLIDER_RANGES: Record<SliderField, { min: number; max: number }> = {
  transcriptSurfaceOpacity: { min: 0, max: 100 },
  transcriptSurfaceBlur: { min: 0, max: 24 },
  userMessageOpacity: { min: 0, max: 100 },
  transcriptBodyInk: { min: 80, max: 100 },
  transcriptChromeInk: { min: 50, max: 100 },
};

const SURFACE_LABELS: Record<(typeof TRANSCRIPT_SURFACES)[number], () => string> = {
  reply: () => t("Reply"),
  column: () => t("Column"),
  off: () => t("Off"),
};
const CARD_LABELS: Record<(typeof TRANSCRIPT_CARDS)[number], () => string> = {
  inset: () => t("Inset"),
  outline: () => t("Outline"),
  solid: () => t("Solid"),
};
const ACTION_LABELS: Record<(typeof TRANSCRIPT_ACTIONS)[number], () => string> = {
  always: () => t("Always"),
  hover: () => t("On hover"),
};

/**
 * The nine reading settings of the transcript: surface, its material, the ink roles, cards and
 * the actions row. Sliders preview through `onDraft` while dragging and save on release.
 */
export function TranscriptViewGroup({
  appearance,
  onDraft,
}: {
  appearance: AppearanceSettings;
  /** Preview value while dragging; `undefined` clears it. */
  onDraft: (change: Partial<Record<SliderField, number | undefined>>) => void;
}) {
  useLocale();
  const { preferences, onPreferences, preferencesUnavailable } = appearance;
  const surfaceOff = preferences.transcriptSurface === "off";
  const set = (change: Partial<AppearancePreferences>) =>
    onPreferences({ ...preferences, ...change });
  const reset = (field: keyof AppearancePreferences) => () =>
    set({ [field]: APPEARANCE_DEFAULTS[field] });
  const modified = (field: keyof AppearancePreferences) =>
    preferences[field] !== APPEARANCE_DEFAULTS[field];
  const slider = (field: SliderField, label: string, format: (value: number) => string) => (
    <DraftSlider
      label={label}
      value={preferences[field]}
      format={format}
      {...SLIDER_RANGES[field]}
      disabled={preferencesUnavailable}
      apply={(value) => onDraft({ [field]: value })}
      commit={(value) => {
        onDraft({ [field]: undefined });
        if (value !== preferences[field]) set({ [field]: value });
      }}
    />
  );
  const percent = (value: number) => formatNumber(value / 100, { style: "percent" });
  const pixels = (value: number) =>
    formatNumber(value, { style: "unit", unit: "pixel", unitDisplay: "narrow" });
  const offReason = t("Turn on a reading surface first");
  return (
    <Group title={t("Transcript view")}>
      <Row
        id="transcript-surface"
        label={t("Reading surface")}
        info={t("Reply paints one surface per answer, Column one for the whole conversation.")}
        modified={modified("transcriptSurface")}
        onReset={reset("transcriptSurface")}
      >
        <Segmented
          label={t("Reading surface")}
          value={preferences.transcriptSurface}
          options={TRANSCRIPT_SURFACES.map((value) => ({ value, label: SURFACE_LABELS[value]() }))}
          disabled={preferencesUnavailable}
          onChange={(transcriptSurface) => set({ transcriptSurface })}
        />
      </Row>
      <Row
        id="transcript-surface-opacity"
        label={t("Surface opacity")}
        dependsOn={!surfaceOff}
        disabledReason={offReason}
        modified={modified("transcriptSurfaceOpacity")}
        onReset={reset("transcriptSurfaceOpacity")}
      >
        {slider("transcriptSurfaceOpacity", t("Surface opacity"), percent)}
      </Row>
      <Row
        id="transcript-surface-blur"
        label={t("Surface blur")}
        info={t("Blur applies only over a background image.")}
        dependsOn={!surfaceOff}
        disabledReason={offReason}
        modified={modified("transcriptSurfaceBlur")}
        onReset={reset("transcriptSurfaceBlur")}
      >
        {slider("transcriptSurfaceBlur", t("Surface blur"), pixels)}
      </Row>
      <Row
        id="chat-message-color"
        label={t("Surface color")}
        modified={modified("messageColor")}
        onReset={reset("messageColor")}
      >
        <Segmented
          label={t("Surface color")}
          value={preferences.messageColor}
          options={[
            { value: "theme", label: t("Theme") },
            { value: "neutral", label: t("Neutral") },
          ]}
          disabled={preferencesUnavailable}
          onChange={(messageColor) => set({ messageColor })}
        />
      </Row>
      <Row
        id="user-message-opacity"
        label={t("Your message opacity")}
        modified={modified("userMessageOpacity")}
        onReset={reset("userMessageOpacity")}
      >
        {slider("userMessageOpacity", t("Your message opacity"), percent)}
      </Row>
      <Row
        id="transcript-body-ink"
        label={t("Reply text")}
        info={t("Scaled by Contrast in Theme.")}
        modified={modified("transcriptBodyInk")}
        onReset={reset("transcriptBodyInk")}
      >
        {slider("transcriptBodyInk", t("Reply text"), percent)}
      </Row>
      <Row
        id="transcript-chrome-ink"
        label={t("Tool and action text")}
        info={t("A share of the reply text, so it is never brighter. Scaled by Contrast in Theme.")}
        modified={modified("transcriptChromeInk")}
        onReset={reset("transcriptChromeInk")}
      >
        {slider("transcriptChromeInk", t("Tool and action text"), percent)}
      </Row>
      <Row
        id="transcript-cards"
        label={t("Cards and code")}
        modified={modified("transcriptCards")}
        onReset={reset("transcriptCards")}
      >
        <Segmented
          label={t("Cards and code")}
          value={preferences.transcriptCards}
          options={TRANSCRIPT_CARDS.map((value) => ({ value, label: CARD_LABELS[value]() }))}
          disabled={preferencesUnavailable}
          onChange={(transcriptCards) => set({ transcriptCards })}
        />
      </Row>
      <Row
        id="transcript-actions"
        label={t("Message actions")}
        info={t("The last reply and keyboard focus always show them.")}
        modified={modified("transcriptActions")}
        onReset={reset("transcriptActions")}
      >
        <Segmented
          label={t("Message actions")}
          value={preferences.transcriptActions}
          options={TRANSCRIPT_ACTIONS.map((value) => ({ value, label: ACTION_LABELS[value]() }))}
          disabled={preferencesUnavailable}
          onChange={(transcriptActions) => set({ transcriptActions })}
        />
      </Row>
    </Group>
  );
}
