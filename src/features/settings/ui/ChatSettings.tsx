import { useStoredPreferenceState } from "../../../shared/hooks/useStoredPreferenceState";
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
  loadUsageLimitFailover,
  subscribeUsageLimitFailover,
  saveModelControls,
  type ModelControls,
} from "../model/settings";
import type { UsageLimitFailover } from "../../tasks/public/agentDefaults";
import { saveAgentDefaultConfirmed } from "../model/agentDefaults";
import {
  AdvancedSettings,
  Group,
  Row,
  Segmented,
  Toggle,
  useConfirmedPreferences,
} from "../../../shared/ui/settings";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import {
  loadComposerSpelling,
  saveComposerSpelling,
  useComposerSpelling,
} from "../model/composerSpelling";
import { HelperModelsSettings } from "./HelperModelsSettings";
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
  const [usageLimitFailover, setUsageLimitFailover] = useStoredPreferenceState(
    loadUsageLimitFailover,
    subscribeUsageLimitFailover,
  );
  const [autoContinue, setAutoContinue] = useStoredPreferenceState(
    loadAutoContinueInterrupted,
    subscribeAutoContinueInterrupted,
  );
  const { commit, pending, feedback } = useConfirmedPreferences();
  const [modelControls, setModelControls] = useStoredPreferenceState(
    loadModelControls,
    subscribeModelControls,
  );
  const onTranscriptLayout = (next: TranscriptLayout) => {
    commit("transcript-layout", {
      write: () => saveTranscriptLayout(next),
      verify: () => loadTranscriptLayout() === next,
      onConfirmed: () => setTranscriptLayout(next),
    });
  };
  const onTranscriptAnchor = (next: boolean) => {
    commit("anchor-prompts", {
      write: () => saveTranscriptAnchor(next),
      verify: () => loadTranscriptAnchor() === next,
      onConfirmed: () => setTranscriptAnchor(next),
    });
  };
  const onComposerSpelling = (next: boolean) => {
    commit("composer-spelling", {
      write: () => saveComposerSpelling(next),
      verify: () => loadComposerSpelling() === next,
    });
  };
  const onResumeAtReset = (next: boolean) => {
    commit("resume-at-reset", {
      write: () => saveAgentDefaultConfirmed("resumeAtReset", next),
      verify: () => loadResumeAtReset() === next,
      onConfirmed: () => setResumeAtReset(next),
    });
  };
  const onUsageLimitFailover = (next: UsageLimitFailover) => {
    commit("usage-limit-failover", {
      write: () => saveAgentDefaultConfirmed("usageLimitFailover", next),
      verify: () => loadUsageLimitFailover() === next,
      onConfirmed: () => setUsageLimitFailover(next),
    });
  };
  const onAutoContinue = (next: boolean) => {
    commit("auto-continue-interrupted", {
      write: () => saveAgentDefaultConfirmed("autoContinueInterrupted", next),
      verify: () => loadAutoContinueInterrupted() === next,
      onConfirmed: () => setAutoContinue(next),
    });
  };
  const onModelControls = (next: ModelControls) => {
    commit("model-controls", {
      write: () => saveModelControls(next),
      verify: () => loadModelControls() === next,
      onConfirmed: () => setModelControls(next),
    });
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
            disabled={pending("transcript-layout")}
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
            disabled={pending("anchor-prompts")}
          />
        </Row>
        <Row
          id="composer-spelling"
          feedback={feedback("composer-spelling")}
          label={t("Spelling and autocorrect")}
          description={t(
            "Enable spelling checks and automatic correction where supported by your platform.",
          )}
        >
          <Toggle
            label={t("Spelling and autocorrect")}
            on={spelling}
            onChange={onComposerSpelling}
            disabled={pending("composer-spelling")}
          />
        </Row>
        <AdvancedSettings
          title={t("Advanced conversation settings")}
          defaultOpen={false}
          settingIds={[
            "resume-at-reset",
            "usage-limit-failover",
            "auto-continue-interrupted",
            "model-controls",
          ]}
        >
          <Row
            id="resume-at-reset"
            feedback={feedback("resume-at-reset")}
            label={t("Resume at reset")}
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
            <Toggle
              label={t("Resume at reset")}
              on={resumeAtReset}
              onChange={onResumeAtReset}
              disabled={pending("resume-at-reset")}
            />
          </Row>
          <Row
            id="usage-limit-failover"
            feedback={feedback("usage-limit-failover")}
            label={t("At usage limit, continue on")}
            info={
              <InfoPopover className="shrink-0">
                <p>
                  {t(
                    "When a provider stops a chat at its usage limit, continue the same conversation elsewhere instead of waiting for the reset.",
                  )}
                </p>
                <p>
                  {t(
                    "Another account keeps the model and moves to the next signed-in account of the same provider that still has quota. Model order uses the first eligible model in Settings → Models, skipping the limited account.",
                  )}
                </p>
                <p>
                  {t(
                    "The switch shows in the conversation. If nothing is available, the limit notice stays and Resume at reset still applies.",
                  )}
                </p>
              </InfoPopover>
            }
          >
            <Segmented
              label={t("At usage limit, continue on")}
              value={usageLimitFailover}
              options={[
                {
                  value: "off",
                  get label() {
                    return t("Off");
                  },
                },
                {
                  value: "account",
                  get label() {
                    return t("Another account");
                  },
                },
                {
                  value: "order",
                  get label() {
                    return t("Model order");
                  },
                },
              ]}
              onChange={onUsageLimitFailover}
              disabled={pending("usage-limit-failover")}
            />
          </Row>
          <Row
            id="auto-continue-interrupted"
            feedback={feedback("auto-continue-interrupted")}
            label={t("Automatically continue interrupted turns")}
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
              disabled={pending("auto-continue-interrupted")}
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
              disabled={pending("model-controls")}
            />
          </Row>
        </AdvancedSettings>
      </Group>

      <Group title={t("Helper models")} layout="full" persistence={{ mode: "automatic" }}>
        <HelperModelsSettings />
      </Group>
      <TemplatesSettings />
    </div>
  );
}
