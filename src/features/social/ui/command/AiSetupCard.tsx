import { useState } from "react";
import { t } from "../../../../shared/i18n";
import { Sparkles } from "../../../../shared/ui/icons";
import {
  REMOTE_PROVIDERS,
  isRemoteProvider,
  type RemoteProvider,
} from "../../../connections/public/protocol";
import type { SocialAgent } from "../../model/social";
import { ModelPicker } from "../../../sessions/public/ModelPicker";
import { DisabledReason, gateProps, type ActionGate } from "../common/DisabledReason";

export type AiSetupCardProps = {
  busy: boolean;
  onSave: (agent: SocialAgent) => void;
};

/**
 * First use: no agent is set, so AI cannot plan or report. The app's own model picker chooses the
 * provider and model; this card only saves that choice as the global Social agent.
 */
export function AiSetupCard({ busy, onSave }: AiSetupCardProps) {
  const [choice, setChoice] = useState<{ provider?: RemoteProvider; model: string }>({ model: "" });
  const gate: ActionGate = choice.provider
    ? { disabled: false }
    : { disabled: true, disabledReason: t("Choose a model first.") };
  return (
    <section className="command-frame command-setup" aria-label={t("Choose an AI model")}>
      <span className="command-card-icon">
        <Sparkles className="icon-sm" strokeWidth={1.75} aria-hidden />
      </span>
      <div className="command-setup-text">
        <h3 className="command-section-title">{t("Choose an AI model")}</h3>
        <p className="command-muted">
          {t(
            "AI needs a model before it can plan or write reports. You can change it later in Accounts.",
          )}
        </p>
      </div>
      <div className="command-setup-picker">
        <ModelPicker
          harness={choice.provider ?? "claude"}
          model={choice.model}
          values={{}}
          allowedHarnesses={REMOTE_PROVIDERS}
          presentation="field"
          onChange={(harness, model) => {
            if (isRemoteProvider(harness)) setChoice({ provider: harness, model });
          }}
          onSettingsChange={() => {}}
        />
        <DisabledReason
          variant="primary"
          size="sm"
          loading={busy}
          onClick={() => {
            if (choice.provider)
              onSave({
                provider: choice.provider,
                ...(choice.model ? { model: choice.model } : {}),
              });
          }}
          {...gateProps(gate)}
        >
          {t("Use this model")}
        </DisabledReason>
      </div>
    </section>
  );
}
