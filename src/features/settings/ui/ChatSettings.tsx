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
  loadFollowUpBehavior,
  loadModelControls,
  loadResumeAtReset,
  saveAutoContinueInterrupted,
  saveFollowUpBehavior,
  saveModelControls,
  saveResumeAtReset,
  type FollowUpBehavior,
  type ModelControls,
} from "../model/settings";
import { AdvancedSettings, Group, Row, Segmented, Toggle } from "./settingsControls";
import { saveComposerSpelling, useComposerSpelling } from "../model/composerSpelling";

export function ChatPage() {
  useLocale();
  const spelling = useComposerSpelling();
  const [transcriptLayout, setTranscriptLayout] = useState<TranscriptLayout>(loadTranscriptLayout);
  const [transcriptAnchor, setTranscriptAnchor] = useState(loadTranscriptAnchor);
  const [followUpBehavior, setFollowUpBehavior] = useState<FollowUpBehavior>(loadFollowUpBehavior);
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
  const onFollowUpBehavior = (next: FollowUpBehavior) => {
    saveFollowUpBehavior(next);
    setFollowUpBehavior(next);
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
            "Full width keeps user prompts as a spanning card. Chat aligns them to the right with a max width, like a messaging app.",
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
          label={t("Follow-up behavior")}
          description={t(
            "Queue follow-ups until the active turn finishes, or steer the active turn immediately.",
          )}
        >
          <Segmented
            label={t("Follow-up behavior")}
            value={followUpBehavior}
            options={[
              {
                value: "queue",
                get label() {
                  return t("Queue");
                },
              },
              {
                value: "steer",
                get label() {
                  return t("Steer");
                },
              },
            ]}
            onChange={onFollowUpBehavior}
          />
        </Row>
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
