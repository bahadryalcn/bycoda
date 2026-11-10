import { useState, type ReactNode } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import type { CrewCandidate, CrewModelPool } from "../model/crew";
import type { ProjectCrews } from "../model/crewClient";
import { candidateLabel, catalogCandidate, catalogModels } from "../model/crewRoster";
import { MemberModelPicker } from "./MemberModelPicker";
import { ModelPoolSelect } from "./ModelPoolSelect";

function targetLabel(count: number, noun: "members" | "profiles") {
  if (noun === "members") return count === 1 ? t("1 member") : t("{p0} members", { p0: count });
  return count === 1 ? t("1 profile") : t("{p0} profiles", { p0: count });
}

/**
 * One model and its options (effort and the rest) for many members at once, or, when
 * `pools` and `onApplyPool` are given, one model pool. The bar only chooses; `onApply`
 * receives the candidate and pins every target to it. Used for crew members and for
 * library profiles, so the same control sets both. A handler that returns `false` (or
 * rejects) reports a failed apply: the success line is not shown then.
 */
export function CrewBulkModelBar({
  cwd,
  catalog,
  targetCount,
  onApply,
  pools,
  onApplyPool,
  disabled = false,
  noun = "members",
  leading,
  suggested,
}: {
  cwd: string;
  catalog: ProjectCrews["catalog"];
  /** Members or profiles the next Apply changes: the selection, or everyone when none. */
  targetCount: number;
  onApply: (candidate: CrewCandidate) => void | boolean | Promise<void | boolean>;
  /** Model pools the owner can apply instead of a fixed model; omit to offer only models. */
  pools?: readonly CrewModelPool[];
  onApplyPool?: (pool: CrewModelPool) => void | boolean | Promise<void | boolean>;
  disabled?: boolean;
  noun?: "members" | "profiles";
  /** Select-all control owned by the list this bar belongs to. */
  leading?: ReactNode;
  /** The model shown until the owner picks one, e.g. the one most targets already use. */
  suggested?: CrewCandidate;
}) {
  useLocale();
  const [chosen, setChosen] = useState<CrewCandidate>();
  const [applied, setApplied] = useState<{ count: number; model: string }>();
  const [mode, setMode] = useState<"model" | "pool">("model");
  const [poolId, setPoolId] = useState("");
  const pool = pools?.find((item) => item.id === poolId);
  const poolMode = mode === "pool" && !!pools && !!onApplyPool;
  const run = async (action: () => unknown, count: number, model: string) => {
    setApplied(undefined);
    try {
      if ((await action()) !== false) setApplied({ count, model });
    } catch {
      // The caller reports the failure; no success line.
    }
  };
  const first = catalogModels(catalog)[0];
  // What the picker shows is what Apply sends: the pick, else the suggestion, else the first model.
  const candidate =
    chosen ??
    suggested ??
    (first ? catalogCandidate(catalog, `${first.harness}/${first.id}`) : undefined);
  const noModels = !candidate;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {leading}
        {pools && onApplyPool ? (
          <SegmentedControl
            label={t("Apply as")}
            value={mode}
            options={[
              { value: "model", label: t("Fixed model") },
              { value: "pool", label: t("Model pool") },
            ]}
            onValueChange={(value) => {
              setMode(value === "pool" ? "pool" : "model");
              setApplied(undefined);
            }}
          />
        ) : null}
        {poolMode ? (
          <div className="min-w-44 max-w-96 flex-1">
            <ModelPoolSelect
              pools={pools}
              value={poolId}
              onChange={(next) => {
                setPoolId(next);
                setApplied(undefined);
              }}
            />
          </div>
        ) : (
          <div className="min-w-44 max-w-80 flex-1">
            <MemberModelPicker
              cwd={cwd}
              value={candidate}
              onChange={(next) => {
                setChosen(next);
                setApplied(undefined);
              }}
            />
          </div>
        )}
        <Button
          variant="secondary"
          disabled={
            disabled ||
            targetCount === 0 ||
            (poolMode ? !pool || !pool.candidates.length : !candidate || noModels)
          }
          onClick={() => {
            if (poolMode) {
              if (pool) void run(() => onApplyPool(pool), targetCount, pool.name);
            } else if (candidate)
              void run(() => onApply(candidate), targetCount, candidateLabel(catalog, candidate));
          }}
        >
          {t("Apply to {p0}", { p0: targetLabel(targetCount, noun) })}
        </Button>
      </div>
      {applied ? (
        <InlineMessage tone="success">
          {t("Applied {p1} to {p0}.", {
            p0: targetLabel(applied.count, noun),
            p1: applied.model,
          })}
        </InlineMessage>
      ) : null}
    </div>
  );
}
