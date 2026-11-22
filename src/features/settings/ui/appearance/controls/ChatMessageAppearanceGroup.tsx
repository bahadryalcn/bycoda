import { useRef, useState, type CSSProperties } from "react";
import { formatNumber, t, useLocale } from "../../../../../shared/i18n";
import { Text } from "../../../../../shared/ui/Text";
import { Group, Row, Segmented, Slider } from "../../../../../shared/ui/settings";
import { APPEARANCE_DEFAULTS } from "../../../model/appearancePreferences";
import type { AppearanceSettings } from "../../useAppearanceSettings";

const opacityRows = [
  {
    field: "userMessageOpacity",
    id: "user-message-opacity",
    label: () => t("Your message opacity"),
  },
  {
    field: "assistantMessageOpacity",
    id: "assistant-message-opacity",
    label: () => t("AI reply opacity"),
  },
] as const;
type OpacityField = (typeof opacityRows)[number]["field"];

export function ChatMessageAppearanceGroup({ appearance }: { appearance: AppearanceSettings }) {
  useLocale();
  const { preferences, onPreferences, preferencesUnavailable } = appearance;
  const [draft, setDraft] = useState<{ field: OpacityField; base: number; value: number } | null>(
    null,
  );
  const interaction = useRef<{ field: OpacityField; base: number } | null>(null);
  const opacity = (field: OpacityField) =>
    draft?.field === field && draft.base === preferences[field] ? draft.value : preferences[field];

  return (
    <Group title={t("Chat messages")}>
      {opacityRows.map(({ field, id, label }) => (
        <Row
          key={id}
          id={id}
          label={label()}
          modified={preferences[field] !== APPEARANCE_DEFAULTS[field]}
          onReset={() => {
            interaction.current = null;
            setDraft(null);
            onPreferences({ ...preferences, [field]: APPEARANCE_DEFAULTS[field] });
          }}
        >
          <Slider
            label={label()}
            min={0}
            max={100}
            value={opacity(field)}
            display={formatNumber(opacity(field) / 100, { style: "percent" })}
            disabled={preferencesUnavailable}
            onChange={(value) => {
              if (interaction.current?.field !== field)
                interaction.current = { field, base: preferences[field] };
              setDraft({ ...interaction.current, value });
            }}
            onValueCommit={(value) => {
              const review = interaction.current;
              interaction.current = null;
              setDraft(null);
              if (
                review?.field === field &&
                review.base === preferences[field] &&
                value !== preferences[field]
              )
                onPreferences({ ...preferences, [field]: value });
            }}
          />
        </Row>
      ))}
      <Row
        id="chat-message-color"
        label={t("Message color")}
        modified={preferences.messageColor !== APPEARANCE_DEFAULTS.messageColor}
        onReset={() =>
          onPreferences({ ...preferences, messageColor: APPEARANCE_DEFAULTS.messageColor })
        }
      >
        <Segmented
          label={t("Message color")}
          value={preferences.messageColor}
          options={[
            { value: "theme", label: t("Theme") },
            { value: "neutral", label: t("Neutral") },
          ]}
          disabled={preferencesUnavailable}
          onChange={(messageColor) => onPreferences({ ...preferences, messageColor })}
        />
      </Row>
      <Row label={t("Preview")}>
        <div
          data-chat-message-preview=""
          data-chat-message-color={preferences.messageColor}
          className="flex w-56 max-w-full flex-wrap justify-between gap-2 p-1.5"
          style={
            {
              "--appearance-user-message-opacity": `${opacity("userMessageOpacity")}%`,
              "--appearance-assistant-message-opacity": `${opacity("assistantMessageOpacity")}%`,
            } as CSSProperties
          }
        >
          <Text size="caption" data-chat-message-surface="assistant" className="px-3 py-1.5">
            {t("Assistant")}
          </Text>
          <Text size="caption" data-chat-message-surface="user" className="px-3 py-1.5">
            {t("You")}
          </Text>
        </div>
      </Row>
    </Group>
  );
}
