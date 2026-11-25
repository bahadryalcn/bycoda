import { useSyncExternalStore } from "react";
import { useStoredPreferenceState } from "../../../shared/hooks/useStoredPreferenceState";
import { t, useLocale } from "../../../shared/i18n";
import { loadStreamingTextMode, subscribeStreamingTextMode } from "../model/settings";
import {
  loadTranscriptLayout,
  saveTranscriptLayout,
  subscribeTranscriptLayout,
  type TranscriptLayout,
} from "../model/appearance";
import { saveAgentDefaultConfirmed } from "../model/agentDefaults";
import { Row, Segmented, Toggle, useConfirmedPreferences } from "../../../shared/ui/settings";
import type { AppearanceSettings } from "./useAppearanceSettings";

/** How the conversation is laid out and animated: transcript layout, width, word wrap and streaming. */
export function ConversationDisplaySettings({ appearance: a }: { appearance: AppearanceSettings }) {
  useLocale();
  const p = a.preferences;
  const { commit, pending, feedback } = useConfirmedPreferences();
  const saveMode = (next: "paced" | "adaptive") =>
    commit("streaming-text-mode", {
      write: () => saveAgentDefaultConfirmed("streamingTextMode", next),
      verify: () => loadStreamingTextMode() === next,
    });
  const [transcriptLayout, setTranscriptLayout] = useStoredPreferenceState(
    loadTranscriptLayout,
    subscribeTranscriptLayout,
  );
  const saveLayout = (next: TranscriptLayout) =>
    commit("transcript-layout", {
      write: () => saveTranscriptLayout(next),
      verify: () => loadTranscriptLayout() === next,
      onConfirmed: () => setTranscriptLayout(next),
    });
  const streamingTextMode = useSyncExternalStore(
    subscribeStreamingTextMode,
    loadStreamingTextMode,
    loadStreamingTextMode,
  );
  return (
    <>
      <Row
        id="transcript-layout"
        feedback={feedback("transcript-layout")}
        label={t("Transcript layout")}
        description={t("Choose a wider transcript or compact chat bubbles.")}
      >
        <Segmented
          label={t("Transcript layout")}
          value={transcriptLayout}
          disabled={pending("transcript-layout")}
          options={[
            { value: "full", label: t("Full width") },
            { value: "chat", label: t("Chat") },
          ]}
          onChange={saveLayout}
        />
      </Row>
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
        feedback={feedback("streaming-text-mode")}
        label={t("Streaming text animation")}
      >
        <Segmented
          label={t("Streaming text animation")}
          value={streamingTextMode}
          disabled={pending("streaming-text-mode")}
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
