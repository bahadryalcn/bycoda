import { useState, useSyncExternalStore } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { loadStreamingTextMode, subscribeStreamingTextMode } from "../model/settings";
import { saveAgentDefaultConfirmed } from "../model/agentDefaults";
import { Row, Select, SettingsFeedback, Toggle } from "../../../shared/ui/settings";
import type { AppearanceSettings } from "./useAppearanceSettings";

export function ConversationDisplaySettings({ appearance: a }: { appearance: AppearanceSettings }) {
  useLocale();
  const p = a.preferences;
  const [failedMode, setFailedMode] = useState<"paced" | "adaptive" | null>(null);
  const [modePending, setModePending] = useState(false);
  const saveModeConfirmed = async (next: "paced" | "adaptive") => {
    setModePending(true);
    try {
      const saved = await saveAgentDefaultConfirmed("streamingTextMode", next);
      setFailedMode(saved && loadStreamingTextMode() === next ? null : next);
    } catch {
      setFailedMode(next);
    } finally {
      setModePending(false);
    }
  };
  const saveMode = (next: "paced" | "adaptive") => {
    void saveModeConfirmed(next).catch(console.error);
  };
  const streamingTextMode = useSyncExternalStore(
    subscribeStreamingTextMode,
    loadStreamingTextMode,
    loadStreamingTextMode,
  );
  return (
    <>
      <Row
        id="chat-width"
        label={t("Chat width")}
        description={t(
          "Limit message width on large screens. Full width uses all available space.",
        )}
      >
        <Select
          hideLabel
          label={t("Chat width")}
          value={p.chatWidth}
          options={[
            {
              value: "comfortable",
              get label() {
                return t("Comfortable");
              },
            },
            {
              value: "wide",
              get label() {
                return t("Wide");
              },
            },
            {
              value: "full",
              get label() {
                return t("Full width");
              },
            },
          ]}
          onChange={(value) =>
            a.onPreferences({
              ...p,
              chatWidth: value === "wide" || value === "full" ? value : "comfortable",
            })
          }
        />
      </Row>
      <Row
        id="code-word-wrap"
        label={t("Word wrap")}
        description={t(
          "Wrap long lines in chat code blocks. File editors keep their own wrap control.",
        )}
      >
        <Toggle
          label={t("Word wrap")}
          on={p.wordWrap}
          onChange={(wordWrap) => a.onPreferences({ ...p, wordWrap })}
        />
      </Row>
      <Row
        id="streaming-text-mode"
        feedback={
          modePending ? (
            <SettingsFeedback state="loading" immediate>
              {t("Saving…")}
            </SettingsFeedback>
          ) : failedMode ? (
            <SettingsFeedback
              state="error"
              action={{ label: t("Retry"), onClick: () => saveMode(failedMode) }}
            >
              {t("Could not save changes")}
            </SettingsFeedback>
          ) : undefined
        }
        label={t("Streaming text animation")}
        description={t(
          "Paced reveals words steadily. Adaptive shows text as it arrives and adjusts the fade to the stream rhythm.",
        )}
      >
        <Select
          hideLabel
          label={t("Streaming text animation")}
          value={streamingTextMode}
          disabled={modePending}
          options={[
            { value: "paced", label: t("Paced (default)") },
            { value: "adaptive", label: t("Immediate with adaptive fade") },
          ]}
          onChange={(value) => saveMode(value === "adaptive" ? "adaptive" : "paced")}
        />
      </Row>
    </>
  );
}
