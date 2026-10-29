import { t } from "../../../shared/i18n";
import { isRemoteProvider, REMOTE_PROVIDERS } from "../../connections/model/protocol";
import { ModelPicker } from "../../sessions/ui/ModelPicker";

export type SocialModelValue = { provider: string; model: string };

/**
 * One agent + model choice through the app's model picker. An empty provider keeps the
 * existing "inherit" meaning of the social policy and rule records; only providers the
 * social backend can run are offered, and the picker never adds settings of its own.
 */
export function SocialModelField({
  label,
  inheritLabel,
  value,
  disabled,
  onChange,
}: {
  label: string;
  inheritLabel: string;
  value: SocialModelValue;
  disabled?: boolean;
  onChange: (next: SocialModelValue) => void;
}) {
  const provider = isRemoteProvider(value.provider) ? value.provider : undefined;
  return (
    <fieldset className="social-model-field" disabled={disabled}>
      <legend>{label}</legend>
      <ModelPicker
        harness={provider ?? "claude"}
        model={provider ? value.model : ""}
        values={{}}
        allowedHarnesses={REMOTE_PROVIDERS}
        presentation="field"
        inheritChoice={{
          label: inheritLabel,
          selected: !provider,
          onSelect: () => onChange({ provider: "", model: "" }),
        }}
        onChange={(harness, model) => {
          if (isRemoteProvider(harness)) onChange({ provider: harness, model });
        }}
        onSettingsChange={() => {}}
      />
      {provider && !value.model ? (
        <span className="social-muted">{t("Uses the agent's default model.")}</span>
      ) : null}
    </fieldset>
  );
}
