import { useState, useSyncExternalStore } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { loadStreamingTextMode, subscribeStreamingTextMode } from "../model/settings";
import { saveAgentDefaultConfirmed } from "../model/agentDefaults";
import { Row, Segmented, SettingsFeedback, Toggle } from "../../../shared/ui/settings";
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
      <Row id="chat-width" label={t("Chat width")}>
        <Segmented
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
              chatWidth: value,
            })
          }
        />
      </Row>
      <Row id="code-word-wrap" label={t("Word wrap")}>
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
      >
        <Segmented
          label={t("Streaming text animation")}
          value={streamingTextMode}
          disabled={modePending}
          options={[
            { value: "paced", label: t("Paced") },
            { value: "adaptive", label: t("Instant") },
          ]}
          onChange={(value) => saveMode(value === "adaptive" ? "adaptive" : "paced")}
        />
      </Row>
    </>
  );
}
