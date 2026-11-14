import { InlineError } from "../../../shared/ui/InlineError";
import { Heading } from "../../../shared/ui/Heading";
import { t } from "../../../shared/i18n";
import type { HostModelCatalog } from "../../connections/public/protocol";
import { ModelChoiceField } from "../../model-routing/public/choice";
import { openModelsSettings } from "../../settings/public/modelsSettingsLink";
import type { CrewAgent, CrewPolicy } from "../model/crew";
import { MemberModelPicker } from "./MemberModelPicker";

/** One shared choice field; the first candidate is the concrete fixed/fallback model. */
export function MemberModelSection({
  cwd,
  agent,
  onChange,
  machineId,
  modelPoolsSupported = false,
  modelError,
}: {
  cwd: string;
  catalog: HostModelCatalog;
  agent: CrewAgent;
  onChange: (patch: Partial<CrewAgent>) => void;
  machineId?: string;
  modelPoolsSupported?: boolean;
  policy?: CrewPolicy;
  compact?: boolean;
  modelError?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Heading size="section" level={3}>
        {t("Model")}
      </Heading>
      <ModelChoiceField
        // oxlint-disable-next-line jsx-a11y/aria-role -- Routing role, never forwarded to the DOM.
        routingRole="crew.member"
        allowDefault
        machineId={machineId}
        supported={modelPoolsSupported}
        value={
          agent.selection === "fixed" ? { kind: "fixed" } : (agent.modelChoice ?? { kind: "fixed" })
        }
        onChange={(modelChoice) =>
          onChange({
            modelChoice,
            selection: modelChoice.kind === "fixed" ? "fixed" : "automatic",
          })
        }
        onManage={() => openModelsSettings("order")}
        fixed={
          <MemberModelPicker
            cwd={cwd}
            value={agent.candidates[0]}
            onChange={(candidate) => onChange({ candidates: [candidate] })}
          />
        }
      />
      {modelError ? <InlineError>{modelError}</InlineError> : null}
    </div>
  );
}
