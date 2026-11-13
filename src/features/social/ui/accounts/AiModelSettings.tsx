import { LoadingText } from "../../../../shared/ui/LoadingText";
import { InlineError } from "../../../../shared/ui/InlineError";
import { useState } from "react";
import { t } from "../../../../shared/i18n";
import {
  SOCIAL_PLATFORMS,
  SOCIAL_PLATFORM_NAMES,
  type SocialAgent,
  type SocialPolicies,
} from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import { isRemoteProvider, REMOTE_PROVIDERS } from "../../../connections/public/protocol";
import { ModelPicker } from "../../../sessions/public/ModelPicker";
import { Group, Row } from "../../../settings/public/settingsControls";
import { Select } from "../../../../shared/ui/Select";
import { ModelLabel } from "../../../sessions/public/ModelLabel";
import { useModelSource } from "../../../sessions/public/modelSource";
import { PlatformIcon } from "../common/PlatformIcon";
import { SocialModelSource } from "../shell/SocialModelSource";

import { effectiveForScope, readScope, withAgent, type PolicyScope } from "./policyScope";
import { savePolicyScope } from "./savePolicy";
import { useAccountWrite } from "./useAccountWrite";
import "./accounts.css";

export type AiModelSettingsProps = {
  client: SocialClient;
  policies: SocialPolicies;
  onChanged(): void;
};

/**
 * The text model that writes replies, plans and reports. Nothing runs until one is chosen: the
 * all-accounts choice says so, and a platform can follow it or name its own model.
 */
export function AiModelSettings({ client, policies, onChanged }: AiModelSettingsProps) {
  const [scope, setScope] = useState<PolicyScope>("global");
  const { error, is, write } = useAccountWrite(t("The AI model could not be saved. Try again."));
  const own = readScope(policies, scope).agent;
  const effective = effectiveForScope(policies, scope).agent;
  const save = (agent: SocialAgent | undefined) =>
    void write("ai.model", () =>
      savePolicyScope(client, policies, scope, withAgent(readScope(policies, scope), agent)),
    )
      .then((result) => result !== undefined && onChanged())
      .catch(() => undefined);

  return (
    <Group
      title={t("AI model")}
      action={
        <Select
          hideLabel
          label={t("Apply to")}
          value={scope}
          options={[
            { value: "global", label: t("All accounts") },
            ...SOCIAL_PLATFORMS.map((platform) => ({
              value: platform,
              label: SOCIAL_PLATFORM_NAMES[platform],
              icon: <PlatformIcon platform={platform} />,
            })),
          ]}
          onValueChange={(value) => setScope(value as PolicyScope)}
        />
      }
      feedback={
        error ? (
          <InlineError>{error}</InlineError>
        ) : is("ai.model") ? (
          <LoadingText delay={false}>{t("Saving…")}</LoadingText>
        ) : null
      }
    >
      <Row
        label={t("Model")}
        description={
          effective
            ? t("AI uses this model to write replies, plans and reports.")
            : t("Choose a model first. AI cannot write replies or plans until you do.")
        }
      >
        <SocialModelSource model={effective?.model ?? ""} values={effective?.modelSettings ?? {}}>
          <ModelPicker
            harness={
              effective && isRemoteProvider(effective.provider) ? effective.provider : "claude"
            }
            model={effective?.model ?? ""}
            values={effective?.modelSettings ?? {}}
            accountId={effective?.providerAccountId}
            accountChoices
            showExtras
            extrasDisabled={is("ai.model")}
            allowedHarnesses={REMOTE_PROVIDERS}
            presentation="field"
            inheritChoice={{
              label: scope === "global" ? t("Choose a model") : t("Use the all-accounts model"),
              selected: !own,
              onSelect: () => save(undefined),
            }}
            onChange={(harness, model, providerAccountId) => {
              if (isRemoteProvider(harness))
                save({
                  provider: harness,
                  ...(model ? { model } : {}),
                  ...(providerAccountId ? { providerAccountId } : {}),
                  ...(effective?.provider === harness && effective.modelSettings
                    ? { modelSettings: effective.modelSettings }
                    : {}),
                });
            }}
            onSettingsChange={(modelSettings) => {
              if (effective) save({ ...effective, modelSettings });
            }}
          />
          {!own && scope !== "global" && effective ? (
            <InheritedModelLabel agent={effective} />
          ) : null}
        </SocialModelSource>
      </Row>
    </Group>
  );
}

function InheritedModelLabel({ agent }: { agent: SocialAgent }) {
  const source = useModelSource();
  return (
    <ModelLabel
      harness={agent.provider}
      model={agent.model ?? ""}
      name={
        isRemoteProvider(agent.provider)
          ? source.resolve(agent.provider, agent.model).name
          : undefined
      }
    />
  );
}
