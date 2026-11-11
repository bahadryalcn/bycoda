import { t, useLocale } from "../../../shared/i18n";
import { Heading } from "../../../shared/ui/Heading";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { InlineError } from "../../../shared/ui/InlineError";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import type { HostModelCatalog } from "../../connections/public/protocol";
import type { CrewAgent, CrewPolicy } from "../model/crew";
import { useCrewModelPools } from "../model/crewModelPools";
import { candidatePassesPolicy, memberCandidatePool } from "../model/crewRoster";
import { MemberCandidateList } from "./MemberCandidateList";
import { MemberModelPicker } from "./MemberModelPicker";
import { ModelPoolSelect } from "./ModelPoolSelect";

/**
 * The model choice of one member. Fixed shows the single model picker. Automatic takes the
 * candidates from a shared model pool; a member's own list stays behind "Custom list for this
 * member", and is the only way when the Host keeps no pools.
 */
export function MemberModelSection({
  cwd,
  catalog,
  agent,
  onChange,
  machineId,
  modelPoolsSupported = false,
  policy,
  compact = false,
  modelError,
}: {
  cwd: string;
  catalog: HostModelCatalog;
  agent: CrewAgent;
  onChange: (patch: Partial<CrewAgent>) => void;
  /** The machine whose Host keeps the model pools. */
  machineId?: string;
  /** `ProjectCrews.modelPoolsSupported`. */
  modelPoolsSupported?: boolean;
  policy?: Pick<CrewPolicy, "allowUnknownCost" | "maxEstimatedCost" | "minimumQuality">;
  /** Inside a roster row: the row already edits the pinned model. */
  compact?: boolean;
  modelError?: string;
}) {
  useLocale();
  const modelPools = useCrewModelPools(machineId, modelPoolsSupported);
  const poolId = agent.pool?.id ?? "";
  const pool = memberCandidatePool(agent);
  const eligible = policy
    ? pool.filter((candidate) => candidatePassesPolicy(candidate, policy)).length
    : pool.length;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Heading size="section" level={3}>
          {t("Model")}
        </Heading>
        <SegmentedControl
          label={t("Model choice")}
          value={agent.selection}
          options={[
            { value: "fixed", label: t("Fixed model") },
            { value: "automatic", label: t("Automatic") },
          ]}
          onValueChange={(value) =>
            onChange(
              value === "fixed"
                ? { selection: "fixed", pool: undefined }
                : { selection: "automatic" },
            )
          }
        />
      </div>
      {agent.selection === "fixed" ? (
        compact ? null : (
          <MemberModelPicker
            cwd={cwd}
            value={agent.candidates[0]}
            onChange={(next) =>
              onChange({
                candidates: [next, ...agent.candidates.slice(1).filter((c) => c.id !== next.id)],
              })
            }
          />
        )
      ) : (
        <>
          {modelPools.supported ? (
            <ModelPoolSelect
              pools={modelPools.pools}
              value={poolId}
              onChange={(id) => {
                const picked = modelPools.pools.find((item) => item.id === id);
                onChange(
                  picked
                    ? { pool: { id }, candidates: structuredClone(picked.candidates) }
                    : { pool: undefined },
                );
              }}
            />
          ) : null}
          {!modelPools.supported || !poolId ? (
            <Disclosure
              variant="plain"
              size="sm"
              defaultOpen={!modelPools.supported}
              summary={t("Custom list for this member")}
              count={agent.candidates.length}
            >
              <div className="flex min-w-0 flex-col gap-2">
                <MemberCandidateList
                  catalog={catalog}
                  candidates={agent.candidates}
                  onChange={(candidates) => onChange({ candidates })}
                />
              </div>
            </Disclosure>
          ) : null}
          {policy && pool.length && eligible < pool.length ? (
            <p className="text-ui-caption text-(--ui-text-secondary)">
              {eligible
                ? t("{p0} of {p1} pass the crew's limits.", { p0: eligible, p1: pool.length })
                : t("The crew's limits exclude every model here, so this member cannot work.")}
            </p>
          ) : null}
        </>
      )}
      {modelError ? <InlineError>{modelError}</InlineError> : null}
    </div>
  );
}
