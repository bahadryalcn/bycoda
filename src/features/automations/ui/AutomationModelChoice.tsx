import { ModelChoiceField } from "../../model-routing/public/choice";
import { openModelsSettings } from "../../settings/public/modelsSettingsLink";
import { ModelLabel } from "../../sessions/public/ModelLabel";
import { ModelPicker } from "../../sessions/public/ModelPicker";
import { defaultModelSettings, resolveModel } from "../../sessions/public/models";
import type { AutomationDraft } from "../model/automations";

/** The model picker for a fixed choice, used by the background Run with fields. */
export function AutomationFixedModel({
  draft,
  onChange,
}: {
  draft: AutomationDraft;
  onChange: (draft: AutomationDraft) => void;
}) {
  return (
    <ModelPicker
      presentation="field"
      accountChoices
      accountId={draft.providerAccountId}
      harness={draft.harness}
      model={draft.model}
      values={draft.modelSettings}
      project={draft.cwd}
      onChange={(harness, model, providerAccountId) =>
        onChange({
          ...draft,
          harness,
          model,
          providerAccountId,
          modelSettings: defaultModelSettings(resolveModel(harness, model)),
        })
      }
      onSettingsChange={(modelSettings) => onChange({ ...draft, modelSettings })}
    />
  );
}

/** The automation's model as one chip: Default, a pool or a fixed model. Resolves at run start. */
export function AutomationModelChoice({
  draft,
  onChange,
  routingHost,
}: {
  draft: AutomationDraft;
  onChange: (draft: AutomationDraft) => void;
  routingHost: { machineId?: string; supported: boolean };
}) {
  return (
    <ModelChoiceField
      presentation="chip"
      routingRole="automation"
      value={draft.modelChoice}
      onChange={(modelChoice) => onChange({ ...draft, modelChoice })}
      machineId={routingHost.machineId}
      supported={routingHost.supported}
      allowDefault
      onManage={() => openModelsSettings("roles")}
      fixedLabel={<ModelLabel model={draft.model} harness={draft.harness} />}
      fixed={
        <ModelPicker
          presentation="chip"
          accountChoices
          accountId={draft.providerAccountId}
          harness={draft.harness}
          model={draft.model}
          values={draft.modelSettings}
          project={draft.cwd}
          onChange={(harness, model, providerAccountId) =>
            onChange({
              ...draft,
              harness,
              model,
              providerAccountId,
              modelSettings: defaultModelSettings(resolveModel(harness, model)),
            })
          }
          onSettingsChange={(modelSettings) => onChange({ ...draft, modelSettings })}
        />
      }
    />
  );
}
