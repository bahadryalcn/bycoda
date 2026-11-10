import { t } from "../../../shared/i18n";
import { Checkbox } from "../../../shared/ui/Checkbox";
import type { CrewAgent } from "../model/crew";
import type { ProjectCrews } from "../model/crewClient";
import { applyCandidate, applyPool, commonCandidate } from "../model/crewBulk";
import { useCrewModelPools } from "../model/crewModelPools";
import { CrewBulkModelBar } from "./CrewBulkModelBar";

/**
 * The roster's bulk bar: select all, then one fixed model or one model pool for the
 * selected members (everyone when none is selected).
 */
export function CrewEditorBulkBar({
  cwd,
  data,
  agents,
  selected,
  onSelectedChange,
  onAgentsChange,
  disabled,
}: {
  cwd: string;
  data: ProjectCrews;
  agents: CrewAgent[];
  /** Selected ids that still exist in the roster. */
  selected: string[];
  onSelectedChange: (ids: string[]) => void;
  onAgentsChange: (agents: CrewAgent[]) => void;
  disabled: boolean;
}) {
  const modelPools = useCrewModelPools(data.machine.id, data.modelPoolsSupported === true);
  const allSelected = agents.length > 0 && selected.length === agents.length;
  return (
    <CrewBulkModelBar
      cwd={cwd}
      catalog={data.catalog}
      noun="members"
      suggested={commonCandidate(agents, selected)}
      targetCount={selected.length || agents.length}
      disabled={disabled}
      pools={data.modelPoolsSupported === true ? modelPools.pools : undefined}
      onApplyPool={(pool) => onAgentsChange(applyPool(agents, selected, pool))}
      leading={
        <Checkbox
          aria-label={t("Select all")}
          checked={allSelected}
          indeterminate={selected.length > 0 && !allSelected}
          onChange={(event) =>
            onSelectedChange(event.target.checked ? agents.map((agent) => agent.id) : [])
          }
        />
      }
      onApply={(candidate) => onAgentsChange(applyCandidate(agents, selected, candidate))}
    />
  );
}
