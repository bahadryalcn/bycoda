import { useRef, useState } from "react";
import type { CrewDefinition, SavedCrewAgent } from "../model/crew";
import {
  planAdd,
  planBulkAdd,
  planRemove,
  type AssignmentPlan,
  type BulkAssignmentPlan,
} from "../model/crewAssignment";
import type { ProjectCrews, useProjectCrews } from "../model/crewClient";

type CrewState = ReturnType<typeof useProjectCrews>;

/** Row key used for the bulk action's pending and error state. */
export const BULK_ASSIGNMENT_KEY = "bulk";

const asBulk = (name: string, plan: AssignmentPlan): BulkAssignmentPlan =>
  plan.ok
    ? { definition: plan.definition, added: [name], skipped: [] }
    : { added: [], skipped: [{ name, reason: plan.reason }] };

const isRevisionConflict = (reason: unknown) =>
  reason instanceof Error && /Crew changed/i.test(reason.message);

/**
 * Adds library profiles to saved crews and removes them again. Every change is planned and
 * validated against the stored crew first, then sent with `crews.save` and the revision it
 * was planned from; a revision conflict refetches and replans once. Without crew identity
 * support (`HOST_CREW_IDENTITY`) the Host drops library links, so `supported` is false.
 */
export function useCrewAssignment(state: CrewState, data: ProjectCrews) {
  const supported = data.identitySupported === true;
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const gate = useRef(false);
  const definitions = useRef(data.definitions);
  definitions.current = data.definitions;

  const execute = async (
    key: string,
    definitionId: string,
    plan: (definition: CrewDefinition) => BulkAssignmentPlan,
  ): Promise<BulkAssignmentPlan | undefined> => {
    if (gate.current || !supported) return undefined;
    gate.current = true;
    setBusy(key);
    setErrors(({ [key]: _cleared, ...rest }) => rest);
    try {
      const attempt = async (definition: CrewDefinition | undefined) => {
        if (!definition) throw new Error("This crew no longer exists");
        const result = plan(definition);
        if (result.definition)
          await state.call("crews.save", {
            definition: result.definition,
            expectedUpdatedAt: definition.updatedAt,
          });
        return result;
      };
      const stored = definitions.current.find((item) => item.id === definitionId);
      let result: BulkAssignmentPlan;
      try {
        result = await attempt(stored);
      } catch (reason) {
        if (!isRevisionConflict(reason)) throw reason;
        const refreshed = await state.refetch();
        if (refreshed.error) throw refreshed.error;
        result = await attempt(
          refreshed.data?.definitions.find((item) => item.id === definitionId),
        );
      }
      if (key !== BULK_ASSIGNMENT_KEY && result.skipped.length)
        setErrors((current) => ({ ...current, [key]: result.skipped[0]!.reason }));
      return result;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setErrors((current) => ({ ...current, [key]: message }));
      return undefined;
    } finally {
      gate.current = false;
      setBusy(null);
    }
  };

  return {
    supported,
    /** The row (profile id, or `BULK_ASSIGNMENT_KEY`) whose save is in flight; others wait. */
    busy,
    errors,
    clearError: (key: string) => setErrors(({ [key]: _cleared, ...rest }) => rest),
    add: (profile: SavedCrewAgent, definitionId: string) =>
      execute(profile.id, definitionId, (definition) =>
        asBulk(profile.name, planAdd(definition, profile)),
      ),
    remove: (profile: SavedCrewAgent, definitionId: string) =>
      execute(profile.id, definitionId, (definition) =>
        asBulk(profile.name, planRemove(definition, profile)),
      ),
    bulkAdd: (profiles: readonly SavedCrewAgent[], definitionId: string) =>
      execute(BULK_ASSIGNMENT_KEY, definitionId, (definition) => planBulkAdd(definition, profiles)),
  };
}

export type CrewAssignment = ReturnType<typeof useCrewAssignment>;
