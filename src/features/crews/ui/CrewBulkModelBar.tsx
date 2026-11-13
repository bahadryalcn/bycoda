import { useState, type ReactNode } from "react";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { InlineMessage } from "../../../shared/ui/InlineError";
import type { ModelRoutingItemChoice } from "../../../shared/model/host-contracts/model-routing";
import { ModelChoiceField } from "../../model-routing/public/choice";
import { openModelsSettings } from "../../settings/public/modelsSettingsLink";
import type { CrewCandidate } from "../model/crew";
import type { ProjectCrews } from "../model/crewClient";
import { catalogCandidate, catalogModels } from "../model/crewRoster";
import { MemberModelPicker } from "./MemberModelPicker";

/** Bulk assignment shares the same choice and concrete fallback as member forms. */
export function CrewBulkModelBar({
  cwd,
  catalog,
  targetCount,
  onApply,
  onApplyChoice,
  machineId,
  supported = false,
  disabled = false,
  noun = "members",
  leading,
  suggested,
}: {
  cwd: string;
  catalog: ProjectCrews["catalog"];
  targetCount: number;
  onApply: (candidate: CrewCandidate) => void | boolean | Promise<void | boolean>;
  onApplyChoice?: (choice: ModelRoutingItemChoice) => void | boolean | Promise<void | boolean>;
  machineId?: string;
  supported?: boolean;
  disabled?: boolean;
  noun?: "members" | "profiles";
  leading?: ReactNode;
  suggested?: CrewCandidate;
}) {
  const [chosen, setChosen] = useState<CrewCandidate>();
  const [choice, setChoice] = useState<ModelRoutingItemChoice>({ kind: "fixed" });
  const [applied, setApplied] = useState(false);
  const [pending, setPending] = useState(false);
  const first = catalogModels(catalog)[0];
  const candidate =
    chosen ??
    suggested ??
    (first ? catalogCandidate(catalog, `${first.harness}/${first.id}`) : undefined);
  const apply = async () => {
    setPending(true);
    setApplied(false);
    try {
      const result =
        choice.kind === "fixed"
          ? candidate && (await onApply(candidate))
          : await onApplyChoice?.(choice);
      setApplied(result !== false);
    } catch {
      /* Caller owns failure feedback. */
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {leading}
        <ModelChoiceField
          // oxlint-disable-next-line jsx-a11y/aria-role -- Routing role, never forwarded to the DOM.
          routingRole="crew.member"
          allowDefault
          value={choice}
          onChange={(next) => {
            setChoice(next);
            setApplied(false);
          }}
          machineId={machineId}
          supported={supported && !!onApplyChoice}
          disabled={disabled || pending}
          onManage={() => openModelsSettings("order")}
          fixed={
            <MemberModelPicker
              cwd={cwd}
              value={candidate}
              onChange={(next) => {
                setChosen(next);
                setApplied(false);
              }}
            />
          }
        />
        <Button
          variant="secondary"
          disabled={disabled || pending || !targetCount || (choice.kind === "fixed" && !candidate)}
          onClick={() => {
            void apply();
          }}
        >
          {noun === "members"
            ? targetCount === 1
              ? t("Apply to 1 member")
              : t("Apply to {p0} members", { p0: targetCount })
            : targetCount === 1
              ? t("Apply to 1 profile")
              : t("Apply to {p0} profiles", { p0: targetCount })}
        </Button>
      </div>
      {applied ? <InlineMessage tone="success">{t("Model choice applied.")}</InlineMessage> : null}
    </div>
  );
}
