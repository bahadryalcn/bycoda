import { useStoredPreferenceState } from "../../../shared/hooks/useStoredPreferenceState";
import { useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import {
  loadTranscriptAnchor,
  subscribeTranscriptAnchor,
  subscribeTranscriptLayout,
  loadTranscriptLayout,
  saveTranscriptAnchor,
  saveTranscriptLayout,
  type TranscriptLayout,
} from "../model/appearance";
import {
  loadAutoContinueInterrupted,
  loadModelControls,
  subscribeModelControls,
  loadResumeAtReset,
  saveAutoContinueInterrupted,
  saveModelControls,
  saveResumeAtReset,
  type ModelControls,
} from "../model/settings";
import { AdvancedSettings, Group, Row, Segmented, Toggle } from "./settingsControls";
import { saveComposerSpelling, useComposerSpelling } from "../model/composerSpelling";
import { TranslationSettings } from "./TranslationSettings";
import { TemplatesSettings } from "./TemplatesSettings";
import { ConversationDisplaySettings } from "./ConversationDisplaySettings";
import type { AppearanceSettings } from "./useAppearanceSettings";
import "./ChatSettings.css";

export function ChatPage({ appearance }: { appearance: AppearanceSettings }) {
  useLocale();
  const spelling = useComposerSpelling();
  const [transcriptLayout, setTranscriptLayout] = useStoredPreferenceState(loadTranscriptLayout, subscribeTranscriptLayout);
  const [transcriptAnchor, setTranscriptAnchor] = useStoredPreferenceState(loadTranscriptAnchor, subscribeTranscriptAnchor);
  const [resumeAtReset, setResumeAtReset] = useState(loadResumeAtReset);
  const [autoContinue, setAutoContinue] = useState(loadAutoContinueInterrupted);
  const [modelControls, setModelControls] = useStoredPreferenceState(loadModelControls, subscribeModelControls);
  const onTranscriptLayout = (next: TranscriptLayout) => {
    saveTranscriptLayout(next);
    setTranscriptLayout(next);
  };
  const onTranscriptAnchor = (next: boolean) => {
    saveTranscriptAnchor(next);
    setTranscriptAnchor(next);
  };
  const onResumeAtReset = (next: boolean) => {
    saveResumeAtReset(next);
    setResumeAtReset(next);
  };
  const onAutoContinue = (next: boolean) => {
    saveAutoContinueInterrupted(next);
    setAutoContinue(next);
  };
  const onModelControls = (next: ModelControls) => {
    saveModelControls(next);
    setModelControls(next);
  };
  return (
    <div className="chat-settings">
      <p className="chat-save-note">{t("Changes save automatically")}</p>
      <Group title={t("Translation")} layout="full">
        <TranslationSettings embedded />
      </Group>
      <Group title={t("Conversation view")} layout="full">
        <ConversationDisplaySettings appearance={appearance} />
        <Row
          id="transcript-layout"
          label={t("Transcript layout")}
          description={t("Choose a wider transcript or compact chat bubbles.")}
        >
          <Segmented
            label={t("Transcript layout")}
            value={transcriptLayout}
            options={[
              {
                value: "full",
                get label() {
                  return t("Full width");
                },
              },
              {
                value: "chat",
                get label() {
                  return t("Chat");
                },
              },
            ]}
            onChange={onTranscriptLayout}
          />
        </Row>
        <Row
          id="anchor-prompts"
          label={t("Anchor prompts to top")}
          description={t("Keep your latest prompt at the top while the reply appears below.")}
        >
          <Toggle
            label={t("Anchor prompts to top")}
            on={transcriptAnchor}
            onChange={onTranscriptAnchor}
          />
        </Row>
      </Group>

      <Group title={t("Composer")} layout="full">
        <Row
          id="composer-spelling"
          label={t("Spelling and autocorrect")}
          description={t(
            "Enable spelling checks and automatic correction where supported by your platform.",
          )}
        >
          <Toggle
            label={t("Spelling and autocorrect")}
            on={spelling}
            onChange={saveComposerSpelling}
          />
        </Row>
        <AdvancedSettings
          id="follow-up"
          settingIds={["follow-up"]}
          title={t("Sending while working")}
        >
          <p className="chat-detail">
            {t(
              "Send steers the active turn. Use the queue button to send after it finishes. If steering is unavailable, the message waits in the queue.",
            )}
          </p>
        </AdvancedSettings>
      </Group>
      <AdvancedSettings
        title={t("Advanced conversation settings")}
        settingIds={["resume-at-reset", "auto-continue-interrupted", "model-controls"]}
      >
        <Group title={t("Continuation and model options")} layout="full">
          <Row
            id="resume-at-reset"
            dependency={t(
              "Automatic resumption requires the provider to report when its usage limit resets.",
            )}
            label={t("Resume at reset")}
            description={t(
              "When a provider stops a turn at its usage limit, continue the session automatically once the limit resets. You can still cancel it from the notice above the composer.",
            )}
          >
            <Toggle label={t("Resume at reset")} on={resumeAtReset} onChange={onResumeAtReset} />
          </Row>
          <Row
            id="auto-continue-interrupted"
            label={t("Automatically continue interrupted turns")}
            description={t(
              "When {p0} quit in the middle of a turn and the transcript shows it was cut off, send Continue at the next launch. Turns that finished or are still running are never continued, and nothing is sent when you have queued messages. When off, the chat shows an Interrupted - Continue action instead.",
              { p0: PRODUCT_IDENTITY.displayName },
            )}
          >
            <Toggle
              label={t("Automatically continue interrupted turns")}
              on={autoContinue}
              onChange={onAutoContinue}
            />
          </Row>
          <Row
            id="model-controls"
            label={t("Extras summary")}
            description={t(
              "Keep the main model separate. Choose whether Extras also shows your active options.",
            )}
          >
            <Segmented
              label={t("Extras summary")}
              value={modelControls}
              options={[
                {
                  value: "menu",
                  get label() {
                    return t("Compact");
                  },
                },
                {
                  value: "beside",
                  get label() {
                    return t("Show active choices");
                  },
                },
              ]}
              onChange={onModelControls}
            />
          </Row>
        </Group>
      </AdvancedSettings>
      <TemplatesSettings />
    </div>
  );
}
