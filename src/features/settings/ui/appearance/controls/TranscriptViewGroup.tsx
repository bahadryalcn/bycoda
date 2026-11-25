import type { CSSProperties } from "react";
import { formatNumber, t, useLocale } from "../../../../../shared/i18n";
import {
  FILE_REF_KINDS,
  FILE_REF_TONES,
  type FileRefKind,
  type FileRefTone,
} from "../../../../../shared/lib/fileReferenceKind";
import { Row, Segmented, Select } from "../../../../../shared/ui/settings";
import { FILE_KIND_LABELS } from "../../../model/appearanceSettingsIndex";
import {
  APPEARANCE_DEFAULTS,
  FILE_REF_STYLES,
  FILE_TONE_FIELDS,
  fileRefToneColor,
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

const FILE_REF_STYLE_LABELS: Record<(typeof FILE_REF_STYLES)[number], () => string> = {
  colored: () => t("Colored"),
  plain: () => t("Plain"),
};
const FILE_TONE_LABELS: Record<FileRefTone, () => string> = {
  info: () => t("Blue"),
  success: () => t("Green"),
  warning: () => t("Amber"),
  danger: () => t("Red"),
  feature: () => t("Purple"),
  orchestration: () => t("Pink"),
  accent: () => t("Accent"),
  neutral: () => t("Neutral"),
};

type PresetFields = Pick<
  AppearancePreferences,
  | "transcriptSurface"
  | "transcriptSurfaceOpacity"
  | "transcriptSurfaceBlur"
  | "messageColor"
  | "userMessageOpacity"
  | "transcriptBodyInk"
  | "transcriptChromeInk"
  | "transcriptCards"
  | "transcriptActions"
>;

const PRESET_FIELDS = [
  "transcriptSurface",
  "transcriptSurfaceOpacity",
  "transcriptSurfaceBlur",
  "messageColor",
  "userMessageOpacity",
  "transcriptBodyInk",
  "transcriptChromeInk",
  "transcriptCards",
  "transcriptActions",
] as const satisfies readonly (keyof AppearancePreferences)[];

const PRESET_BASE = Object.fromEntries(
  PRESET_FIELDS.map((field) => [field, APPEARANCE_DEFAULTS[field]]),
) as PresetFields;

/** Reading looks that fill all nine fields; the fine-tuning rows below edit the same values. */
const PRESETS: Record<"default" | "glass" | "plain" | "contrast", PresetFields> = {
  default: PRESET_BASE,
  glass: {
    ...PRESET_BASE,
    transcriptSurface: "column",
    transcriptSurfaceOpacity: 55,
    transcriptSurfaceBlur: 12,
  },
  plain: { ...PRESET_BASE, transcriptSurface: "off", transcriptCards: "outline" },
  contrast: {
    ...PRESET_BASE,
    transcriptBodyInk: 100,
    transcriptChromeInk: 90,
    transcriptCards: "solid",
  },
};
const PRESET_LABELS: Record<keyof typeof PRESETS | "custom", () => string> = {
  default: () => t("Default"),
  glass: () => t("Glass"),
  plain: () => t("Plain"),
  contrast: () => t("High contrast"),
  custom: () => t("Custom"),
};

/**
 * The transcript reading settings: a preset row up front and the nine fine-tuning rows (surface,
 * its material, the ink roles, cards, actions row) behind one advanced reveal. Render inside a
 * `Group`. Sliders preview through `onDraft` while dragging and save on release.
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
  const pixels = (value: number) => `${value}px`;
  const offReason = t("Turn on a reading surface first");
  const activePreset =
    (Object.keys(PRESETS) as (keyof typeof PRESETS)[]).find((name) =>
      PRESET_FIELDS.every((field) => preferences[field] === PRESETS[name][field]),
    ) ?? "custom";
  const presetOptions = (Object.keys(PRESETS) as (keyof typeof PRESETS)[]).map((value) => ({
    value: value as keyof typeof PRESETS | "custom",
    label: PRESET_LABELS[value](),
  }));
  if (activePreset === "custom")
    presetOptions.push({ value: "custom", label: PRESET_LABELS.custom() });
  return (
    <>
      <Row id="transcript-preset" label={t("Reading look")}>
        <Segmented
          label={t("Reading look")}
          value={activePreset}
          options={presetOptions}
          disabled={preferencesUnavailable}
          onChange={(name) => {
            if (name !== "custom") set(PRESETS[name]);
          }}
        />
      </Row>
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
          options={TRANSCRIPT_SURFACES.map((value) => ({
            value,
            label: SURFACE_LABELS[value](),
          }))}
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
      <Row
        id="transcript-file-refs"
        label={t("File references")}
        info={t("File and folder names in replies get an icon. Colored tints them by kind.")}
        modified={modified("transcriptFileRefs")}
        onReset={reset("transcriptFileRefs")}
      >
        <Segmented
          label={t("File references")}
          value={preferences.transcriptFileRefs}
          options={FILE_REF_STYLES.map((value) => ({
            value,
            label: FILE_REF_STYLE_LABELS[value](),
          }))}
          disabled={preferencesUnavailable}
          onChange={(transcriptFileRefs) => set({ transcriptFileRefs })}
        />
      </Row>
      {FILE_REF_KINDS.map((kind) => {
        const field = FILE_TONE_FIELDS[kind];
        return (
          <Row
            key={kind}
            id={`file-tone-${kind}`}
            label={FILE_KIND_LABELS[kind]()}
            dependsOn={preferences.transcriptFileRefs === "colored"}
            disabledReason={t("Turn on colored file references first")}
            modified={modified(field)}
            onReset={reset(field)}
          >
            <Select
              label={FILE_KIND_LABELS[kind]()}
              hideLabel
              controlWidth="compact"
              value={preferences[field]}
              disabled={preferencesUnavailable}
              options={FILE_REF_TONES.map((tone) => ({
                value: tone,
                label: FILE_TONE_LABELS[tone](),
                icon: (
                  <span
                    aria-hidden="true"
                    className="file-ref-swatch"
                    style={{ "--file-ref-swatch": fileRefToneColor(tone) } as CSSProperties}
                  />
                ),
              }))}
              onChange={(tone) => set({ [field]: tone as FileRefTone })}
            />
          </Row>
        );
      })}
    </>
  );
}
