import { useState } from "react";
import { formatNumber, t, useLocale } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { Group, Row } from "../../../../../shared/ui/settings";
import { TranscriptPreview, type TranscriptPreviewValues } from "../controls/TranscriptPreview";
import { TranscriptViewGroup, type SliderField } from "../controls/TranscriptViewGroup";
import { AppearanceSaveFeedback, type AppearanceSettings } from "../../useAppearanceSettings";
import { AppearanceSection } from "./AppearanceSection";

/**
 * Appearance > Chat: a sticky live preview of the reading rules above the "Transcript view"
 * settings, with a link to the Background tab, which keeps the artwork controls.
 */
export function ChatSection({
  appearance,
  onOpenBackground,
}: {
  appearance: AppearanceSettings;
  onOpenBackground: () => void;
}) {
  useLocale();
  const [draft, setDraft] = useState<Partial<Record<SliderField, number>>>({});
  const preview: TranscriptPreviewValues = { ...appearance.preferences, ...draft };
  const visible = Math.round(appearance.chatBackgroundSessionOpacity * 100);
  return (
    <AppearanceSection id="transcript" title={t("Chat")}>
      <TranscriptPreview appearance={appearance} values={preview} />
      <div className="settings-topics">
        <TranscriptViewGroup
          appearance={appearance}
          onDraft={(change) =>
            setDraft((current) => {
              const next = { ...current, ...change };
              for (const key of Object.keys(next) as SliderField[])
                if (next[key] === undefined) delete next[key];
              return next;
            })
          }
        />
        <Group title={t("Backdrop")}>
          <Row
            id="transcript-backdrop"
            label={
              appearance.chatBackgroundPath
                ? t("Image, {p0} visible", {
                    p0: formatNumber(visible / 100, { style: "percent" }),
                  })
                : t("No background image")
            }
          >
            <Button variant="secondary" size="sm" onClick={onOpenBackground}>
              {t("Open Background")}
            </Button>
          </Row>
        </Group>
      </div>
      <AppearanceSaveFeedback
        settingIds={[
          "transcript-surface",
          "transcript-surface-opacity",
          "transcript-surface-blur",
          "chat-message-color",
          "user-message-opacity",
          "transcript-body-ink",
          "transcript-chrome-ink",
          "transcript-cards",
          "transcript-actions",
        ]}
      />
    </AppearanceSection>
  );
}
