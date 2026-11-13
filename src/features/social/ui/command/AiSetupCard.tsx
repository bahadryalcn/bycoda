import { Text } from "../../../../shared/ui/Text";
import { useState } from "react";
import { t } from "../../../../shared/i18n";
import { Heading } from "../../../../shared/ui/Heading";
import { surfaceAttributes, Surface } from "../../../../shared/ui/Surface";
import { Sparkles } from "../../../../shared/ui/icons";
import { REMOTE_PROVIDERS, isRemoteProvider } from "../../../connections/public/protocol";
import type { SocialAgent } from "../../model/social";
import { ModelPicker } from "../../../sessions/public/ModelPicker";
import { DisabledReason, gateProps, type ActionGate } from "../common/DisabledReason";
import { SocialModelSource } from "../shell/SocialModelSource";

export type AiSetupCardProps = {
  busy: boolean;
  onSave: (agent: SocialAgent) => void;
};

/**
 * First use: no agent is set, so AI cannot plan or report. The app's own model picker chooses the
 * provider and model; this card only saves that choice as the global Social agent.
 */
export function AiSetupCard({ busy, onSave }: AiSetupCardProps) {
  const [choice, setChoice] = useState<Partial<SocialAgent> & { model: string }>({ model: "" });
  const gate: ActionGate = choice.provider
    ? { disabled: false }
    : { disabled: true, disabledReason: t("Choose a model first.") };
  return (
    <Surface
      as="section"
      variant="card"
      className="command-frame command-setup"
      aria-label={t("Choose an AI model")}
    >
      <Text
        size="inherit"
        tone="secondary"
        {...surfaceAttributes({ radius: "card", variant: "fill-subtle" }, "command-card-icon")}
      >
        <Sparkles className="icon-sm" strokeWidth={1.75} aria-hidden />
      </Text>
      <div className="command-setup-text">
        <Heading size="section">{t("Choose an AI model")}</Heading>
        <Text as="p" size="caption" tone="muted" leading="inherit" className="command-muted">
          {t(
            "AI needs a model before it can plan or write reports. You can change it later in Accounts.",
          )}
        </Text>
      </div>
      <div className="command-setup-picker">
        <SocialModelSource model={choice.model} values={choice.modelSettings ?? {}}>
          <ModelPicker
            harness={choice.provider ?? "claude"}
            model={choice.model}
            values={choice.modelSettings ?? {}}
            accountId={choice.providerAccountId}
            accountChoices
            showExtras
            extrasDisabled={busy}
            allowedHarnesses={REMOTE_PROVIDERS}
            presentation="field"
            inheritChoice={{
              label: t("Choose a model"),
              selected: !choice.provider,
              onSelect: () => setChoice({ model: "" }),
            }}
            onChange={(harness, model, providerAccountId) => {
              if (isRemoteProvider(harness))
                setChoice({
                  provider: harness,
                  model,
                  ...(providerAccountId ? { providerAccountId } : {}),
                  ...(choice.provider === harness && choice.modelSettings
                    ? { modelSettings: choice.modelSettings }
                    : {}),
                });
            }}
            onSettingsChange={(modelSettings) =>
              setChoice((current) => ({ ...current, modelSettings }))
            }
          />
        </SocialModelSource>
        <DisabledReason
          variant="primary"
          size="sm"
          loading={busy}
          onClick={() => {
            if (choice.provider)
              onSave({
                provider: choice.provider,
                ...(choice.model ? { model: choice.model } : {}),
                ...(choice.providerAccountId
                  ? { providerAccountId: choice.providerAccountId }
                  : {}),
                ...(choice.modelSettings ? { modelSettings: choice.modelSettings } : {}),
              });
          }}
          {...gateProps(gate)}
        >
          {t("Use this model")}
        </DisabledReason>
      </div>
    </Surface>
  );
}
