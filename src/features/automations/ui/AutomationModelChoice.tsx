import { ModelChoiceField } from "../../model-routing/public/choice";
import { openModelsSettings } from "../../settings/public/modelsSettingsLink";
import { ModelPicker } from "../../sessions/public/ModelPicker";
import { ModelControlPills } from "../../sessions/public/ModelPicker";
import { AccessPicker } from "../../sessions/public/AccessPicker";
import { defaultModelSettings, resolveModel } from "../../sessions/public/models";
import type { AutomationDraft } from "../model/automations";

export function AutomationModelChoice({
  draft,
  onChange,
  routingHost,
  extrasBeside,
}: {
  draft: AutomationDraft;
  onChange: (draft: AutomationDraft) => void;
  routingHost: { machineId?: string; supported: boolean };
  extrasBeside: boolean;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <ModelChoiceField
        routingRole="automation"
        value={draft.modelChoice}
        onChange={(modelChoice) => onChange({ ...draft, modelChoice })}
        machineId={routingHost.machineId}
        supported={routingHost.supported}
        allowDefault
        onManage={() => openModelsSettings("roles")}
        fixed={
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
        }
      />
      {/* Chat settings "Extras summary: beside" also shows the active options here; the menu stays complete. */}
      {extrasBeside &&
      (!routingHost.supported || !draft.modelChoice || draft.modelChoice.kind === "fixed") ? (
        <ModelControlPills
          harness={draft.harness}
          model={draft.model}
          values={draft.modelSettings}
          onSettingsChange={(modelSettings) => onChange({ ...draft, modelSettings })}
        />
      ) : null}
      {draft.harness !== "fx" ? (
        <AccessPicker
          value={draft.runtimeMode}
          onChange={(runtimeMode) => onChange({ ...draft, runtimeMode })}
        />
      ) : null}
    </div>
  );
}
