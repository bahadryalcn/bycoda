import { useState } from "react";
import { useLocale } from "../../../../../shared/i18n";
import { TranscriptPreview, type TranscriptPreviewValues } from "../controls/TranscriptPreview";
import { TranscriptViewGroup, type SliderField } from "../controls/TranscriptViewGroup";
import type { AppearanceSettings } from "../../useAppearanceSettings";

/**
 * Chat > Conversation view: one live preview of the reading rules above the reading presets and
 * their advanced fine-tuning rows. Render inside a settings `Group`.
 */
export function ChatSection({ appearance }: { appearance: AppearanceSettings }) {
  useLocale();
  const [draft, setDraft] = useState<Partial<Record<SliderField, number>>>({});
  const preview: TranscriptPreviewValues = { ...appearance.preferences, ...draft };
  return (
    <>
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
    </>
  );
}
