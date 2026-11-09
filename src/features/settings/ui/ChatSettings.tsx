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
  subscribeAutoContinueInterrupted,
  loadModelControls,
  subscribeModelControls,
  loadResumeAtReset,
  subscribeResumeAtReset,
  saveAutoContinueInterrupted,
  saveModelControls,
  saveResumeAtReset,
  type ModelControls,
} from "../model/settings";
import {
  AdvancedSettings,
  Group,
  Row,
  Segmented,
  SettingsFeedback,
  Toggle,
} from "./settingsControls";
import { Button } from "../../../shared/ui/Button";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import {
  loadComposerSpelling,
  saveComposerSpelling,
  useComposerSpelling,
} from "../model/composerSpelling";
import { TranslationSettings } from "./TranslationSettings";
import { TitleGenerationSettings } from "./TitleGenerationSettings";
import { TemplatesSettings } from "./TemplatesSettings";
import { ConversationDisplaySettings } from "./ConversationDisplaySettings";
import { AppearanceSaveFeedback, type AppearanceSettings } from "./useAppearanceSettings";
import "./ChatSettings.css";
import { VoiceSettings } from "../../voice/ui/VoiceSettings";

/** Voice moved out of Chat into its own section; Settings keeps one import for both pages. */
export function VoicePage() {
  return (
    <div className="settings-topics">
      <VoiceSettings />
    </div>
  );
}

export function ChatPage({ appearance }: { appearance: AppearanceSettings }) {
  useLocale();
  const spelling = useComposerSpelling();
  const [transcriptLayout, setTranscriptLayout] = useStoredPreferenceState(
    loadTranscriptLayout,
    subscribeTranscriptLayout,
  );
  const [transcriptAnchor, setTranscriptAnchor] = useStoredPreferenceState(
    loadTranscriptAnchor,
    subscribeTranscriptAnchor,
  );
  const [resumeAtReset, setResumeAtReset] = useStoredPreferenceState(
    loadResumeAtReset,
    subscribeResumeAtReset,
  );
  const [autoContinue, setAutoContinue] = useStoredPreferenceState(
    loadAutoContinueInterrupted,
    subscribeAutoContinueInterrupted,
  );
  const [failures, setFailures] = useState<Record<string, () => void>>({});
  const commit = (
    id: string,
    write: () => boolean | void,
    read: () => unknown,
    next: unknown,
    update: () => void,
  ) => {
    try {
      if (write() === false || read() !== next) throw new Error("Preference not persisted");
      update();
      setFailures((current) => {
        const updated = { ...current };
        delete updated[id];
        return updated;
      });
    } catch {
      setFailures((current) => ({ ...current, [id]: () => commit(id, write, read, next, update) }));
    }
  };
  const feedback = (id: string) =>
    failures[id] ? (
      <SettingsFeedback state="error" action={<Button onClick={failures[id]}>{t("Retry")}</Button>}>
        {t("Could not save changes")}
      </SettingsFeedback>
    ) : undefined;
  const [modelControls, setModelControls] = useStoredPreferenceState(
    loadModelControls,
    subscribeModelControls,
  );
  const onTranscriptLayout = (next: TranscriptLayout) => {
    commit(
      "transcript-layout",
      () => saveTranscriptLayout(next),
      loadTranscriptLayout,
      next,
      () => setTranscriptLayout(next),
    );
  };
  const onTranscriptAnchor = (next: boolean) => {
    commit(
      "anchor-prompts",
      () => saveTranscriptAnchor(next),
      loadTranscriptAnchor,
      next,
      () => setTranscriptAnchor(next),
    );
  };
  const onResumeAtReset = (next: boolean) => {
    commit(
      "resume-at-reset",
      () => saveResumeAtReset(next),
      loadResumeAtReset,
      next,
      () => setResumeAtReset(next),
    );
  };
  const onAutoContinue = (next: boolean) => {
    commit(
      "auto-continue-interrupted",
      () => saveAutoContinueInterrupted(next),
      loadAutoContinueInterrupted,
      next,
      () => setAutoContinue(next),
    );
  };
  const onModelControls = (next: ModelControls) => {
    commit(
      "model-controls",
      () => saveModelControls(next),
      loadModelControls,
      next,
      () => setModelControls(next),
    );
  };
  return (
    <div className="chat-settings settings-topics">
      <Group
        title={t("Conversation view")}
        layout="full"
        feedback={
          <AppearanceSaveFeedback
            settingIds={[
              "appearance-preferences",
              "transcript-layout",
              "anchor-prompts",
              "streaming-text-mode",
            ]}
          />
        }
      >
        <ConversationDisplaySettings appearance={appearance} />
        <Row
          id="transcript-layout"
          feedback={feedback("transcript-layout")}
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
          feedback={feedback("anchor-prompts")}
          label={t("Anchor prompts to top")}
          description={t("Keep your latest prompt at the top while the reply appears below.")}
        >
          <Toggle
            label={t("Anchor prompts to top")}
            on={transcriptAnchor}
            onChange={onTranscriptAnchor}
          />
        </Row>
        <Row
          id="composer-spelling"
          feedback={feedback("composer-spelling")}
          label={t("Spelling and autocorrect")}
          description={t(
            "Enable spelling checks and automatic correction where supported by your platform.",
          )}
          info={
            <InfoPopover className="shrink-0">
              <p>
                {t(
                  "Send steers the active turn; the queue button sends after it finishes, or when steering is unavailable.",
                )}
              </p>
            </InfoPopover>
          }
        >
          <Toggle
            label={t("Spelling and autocorrect")}
            on={spelling}
            onChange={(next) =>
              commit(
                "composer-spelling",
                () => saveComposerSpelling(next),
                loadComposerSpelling,
                next,
                () => {},
              )
            }
          />
        </Row>
        <AdvancedSettings
          title={t("Advanced conversation settings")}
          defaultOpen={false}
          settingIds={["resume-at-reset", "auto-continue-interrupted", "model-controls"]}
        >
          <Row
            id="resume-at-reset"
            feedback={feedback("resume-at-reset")}
            label={t("Resume at reset")}
            description={t("Continue automatically after a provider's usage limit resets.")}
            info={
              <InfoPopover className="shrink-0">
                <p>
                  {t(
                    "When a provider stops a turn at its usage limit, continue the session automatically once the limit resets. You can still cancel it from the notice above the composer.",
                  )}
                </p>
                <p>
                  {t(
                    "Automatic resumption requires the provider to report when its usage limit resets.",
                  )}
                </p>
              </InfoPopover>
            }
          >
            <Toggle label={t("Resume at reset")} on={resumeAtReset} onChange={onResumeAtReset} />
          </Row>
          <Row
            id="auto-continue-interrupted"
            feedback={feedback("auto-continue-interrupted")}
            label={t("Automatically continue interrupted turns")}
            description={t("Send Continue at launch when a turn was cut off.")}
            info={
              <InfoPopover className="shrink-0">
                <p>
                  {t(
                    "When {p0} quit in the middle of a turn and the transcript shows it was cut off, send Continue at the next launch. Turns that finished or are still running are never continued, and nothing is sent when you have queued messages. When off, the chat shows an Interrupted - Continue action instead.",
                    { p0: PRODUCT_IDENTITY.displayName },
                  )}
                </p>
              </InfoPopover>
            }
          >
            <Toggle
              label={t("Automatically continue interrupted turns")}
              on={autoContinue}
              onChange={onAutoContinue}
            />
          </Row>
          <Row
            id="model-controls"
            feedback={feedback("model-controls")}
            label={t("Extras summary")}
            description={t("Choose whether Extras also shows your active options.")}
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
        </AdvancedSettings>
      </Group>

      <Group title={t("Helper models")} layout="full" persistence={{ mode: "automatic" }}>
        <TranslationSettings embedded />
        <TranslationSettings embedded action="reprompt" />
        <TitleGenerationSettings embedded />
      </Group>
      <TemplatesSettings />
    </div>
  );
}
