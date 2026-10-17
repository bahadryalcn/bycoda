import { useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import {
  loadTranscriptAnchor,
  loadTranscriptLayout,
  saveTranscriptAnchor,
  saveTranscriptLayout,
  type TranscriptLayout,
} from "../model/appearance";
import {
  loadAutoContinueInterrupted,
  loadModelControls,
  loadResumeAtReset,
  saveAutoContinueInterrupted,
  saveModelControls,
  saveResumeAtReset,
  type ModelControls,
} from "../model/settings";
import { AdvancedSettings, Group, Row, Segmented, Toggle } from "./settingsControls";
import { saveComposerSpelling, useComposerSpelling } from "../model/composerSpelling";
import { GitGenerationModelControl } from "../../source-control/ui/GitGenerationSettings";
import {
  saveDefaultGitGenerationChoice,
  useDefaultGitGenerationChoice,
} from "../../source-control/model/gitGenerationPreferences";
import { Button } from "../../../shared/ui/Button";
import { TranslationSettings } from "./TranslationSettings";

export function ChatPage() {
  useLocale();
  const spelling = useComposerSpelling();
  const gitGenerationChoice = useDefaultGitGenerationChoice();
  const [transcriptLayout, setTranscriptLayout] = useState<TranscriptLayout>(loadTranscriptLayout);
  const [transcriptAnchor, setTranscriptAnchor] = useState(loadTranscriptAnchor);
  const [resumeAtReset, setResumeAtReset] = useState(loadResumeAtReset);
  const [autoContinue, setAutoContinue] = useState(loadAutoContinueInterrupted);
  const [modelControls, setModelControls] = useState<ModelControls>(loadModelControls);
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
    <>
      <TranslationSettings />
      <Group title={t("Commit and pull request generation")} persistence={{ mode: "automatic" }}>
        <Row
          id="git-generation-default"
          label={t("Default generation model")}
          description={t("Used across projects unless a project has its own generation selection.")}
        >
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {!gitGenerationChoice && (
              <span className="text-[var(--ui-text-secondary)]">{t("Automatic")}</span>
            )}
            <GitGenerationModelControl
              choice={gitGenerationChoice}
              onChange={saveDefaultGitGenerationChoice}
            />
            {gitGenerationChoice && (
              <Button variant="link" onClick={() => saveDefaultGitGenerationChoice(undefined)}>
                {t("Use automatic selection")}
              </Button>
            )}
          </div>
        </Row>
      </Group>
      <Group
        title={t("Conversation view")}
        description={t("How a conversation reads as it grows.")}
        scope={t("Applies to conversation display across projects.")}
        persistence={{ mode: "automatic" }}
      >
        <Row
          id="transcript-layout"
          label={t("Transcript layout")}
          description={t(
            "User messages stay right aligned and fit their content. Full width gives longer messages more room; Chat limits their width.",
          )}
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
          description={t(
            "When you send, the new prompt sits at the top of the transcript and the reply grows into the space below. Turn this off to keep the classic layout, with the latest message resting on the composer.",
          )}
        >
          <Toggle
            label={t("Anchor prompts to top")}
            on={transcriptAnchor}
            onChange={onTranscriptAnchor}
          />
        </Row>
      </Group>

      <Group
        title={t("Composer")}
        description={t("What the composer does with what you type.")}
        scope={t("Applies to the composer across projects.")}
        persistence={{ mode: "automatic" }}
      >
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
        <Row
          id="follow-up"
          label={t("Sending while working")}
          description={t(
            "Send steers the active turn. Use the queue button to send after it finishes. If steering is unavailable, the message waits in the queue.",
          )}
        />
      </Group>
      <AdvancedSettings
        title={t("Advanced conversation settings")}
        settingIds={["resume-at-reset", "auto-continue-interrupted", "model-controls"]}
      >
        <Group
          title={t("Continuation and model options")}
          description={t("Control automatic continuation and how model options appear.")}
          persistence={{ mode: "automatic" }}
        >
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
    </>
  );
}
