import { useState } from "react";
import { t, useLocale } from "../../../../../shared/i18n";
import { Group } from "../../../../../shared/ui/settings";
import { TranscriptPreview, type TranscriptPreviewValues } from "../controls/TranscriptPreview";
import { TranscriptViewGroup, type SliderField } from "../controls/TranscriptViewGroup";
import { ConversationDisplaySettings } from "../../ConversationDisplaySettings";
import { AppearanceSaveFeedback, type AppearanceSettings } from "../../useAppearanceSettings";
import { AppearanceSection } from "./AppearanceSection";

/**
 * Appearance > Chat: one live preview of the reading rules above the reading presets, their
 * fine-tuning rows and the conversation layout.
 */
export function ChatSection({ appearance }: { appearance: AppearanceSettings }) {
  useLocale();
  const [draft, setDraft] = useState<Partial<Record<SliderField, number>>>({});
  const preview: TranscriptPreviewValues = { ...appearance.preferences, ...draft };
  return (
    <AppearanceSection id="chat" title={t("Chat")}>
      <Group
        title={t("Conversation view")}
        layout="full"
        feedback={
          <AppearanceSaveFeedback
            settingIds={[
              "appearance-preferences",
              "transcript-layout",
              "streaming-text-mode",
              "transcript-surface",
              "transcript-surface-opacity",
              "transcript-surface-blur",
              "chat-message-color",
              "user-message-opacity",
              "transcript-body-ink",
              "transcript-chrome-ink",
              "transcript-cards",
              "transcript-actions",
              "transcript-preset",
            ]}
          />
        }
      >
        <TranscriptPreview appearance={appearance} values={preview} />
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
        <ConversationDisplaySettings appearance={appearance} />
      </Group>
    </AppearanceSection>
  );
}
