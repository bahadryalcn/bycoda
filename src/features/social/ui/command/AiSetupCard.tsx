import { InfoPopover } from "../../../../shared/ui/InfoPopover";
import { useState } from "react";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { Heading } from "../../../../shared/ui/Heading";
import { Surface } from "../../../../shared/ui/Surface";
import { REMOTE_PROVIDERS, isRemoteProvider } from "../../../connections/public/protocol";
import type { SocialAgent } from "../../model/social";
import { ModelPicker } from "../../../sessions/public/ModelPicker";
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
  return (
    <Surface
      as="section"
      variant="card"
      className="command-frame command-setup"
      aria-label={t("Choose an AI model")}
    >
      <div className="command-setup-text">
        <div className="flex items-center gap-1">
          <Heading size="section">{t("Choose an AI model")}</Heading>
          <InfoPopover>
            {t(
              "AI needs a model before it can plan or write reports. You can change it later in Accounts.",
            )}
          </InfoPopover>
        </div>
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
        <Button
          variant="primary"
          size="sm"
          loading={busy}
          disabled={!choice.provider}
          disabledReason={t("Choose a model first.")}
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
        >
          {t("Use this model")}
        </Button>
      </div>
    </Surface>
  );
}
