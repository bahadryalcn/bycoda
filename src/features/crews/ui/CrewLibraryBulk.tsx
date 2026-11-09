import { useRef, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { Checkbox } from "../../../shared/ui/Checkbox";
import type { CrewCandidate, SavedCrewAgent } from "../model/crew";
import type { ProjectCrews, useProjectCrews } from "../model/crewClient";
import { commonCandidate } from "../model/crewBulk";
import { CrewBulkModelBar } from "./CrewBulkModelBar";

type CrewState = ReturnType<typeof useProjectCrews>;
export type BulkFailure = { name: string; reason: string };

/** Profiles the bulk action touches: the selected visible ones, or every visible one when none is selected. */
export function bulkTargets<T extends { id: string }>(visible: T[], selected: ReadonlySet<string>) {
  const chosen = visible.filter((agent) => selected.has(agent.id));
  return chosen.length ? chosen : visible;
}

/** Saves each profile with the fixed candidate, one after another; a failure does not stop the rest. */
export async function applyCandidateToProfiles(
  targets: SavedCrewAgent[],
  candidate: CrewCandidate,
  save: (profile: Omit<SavedCrewAgent, "updatedAt">, expectedUpdatedAt: number) => Promise<unknown>,
) {
  const failures: BulkFailure[] = [];
  let updated = 0;
  for (const agent of targets) {
    const { updatedAt, ...profile } = agent;
    try {
      await save(
        { ...profile, selection: "fixed", candidates: [structuredClone(candidate)] },
        updatedAt,
      );
      updated += 1;
    } catch (reason) {
      failures.push({
        name: agent.name,
        reason: reason instanceof Error ? reason.message : String(reason),
      });
    }
  }
  return { updated, failures };
}

/** Select-all plus the shared model bar for the library's visible profiles. */
export function CrewLibraryBulkBar({
  cwd,
  state,
  data,
  visible,
  selected,
  onSelectedChange,
}: {
  cwd: string;
  state: CrewState;
  data: ProjectCrews;
  visible: SavedCrewAgent[];
  selected: ReadonlySet<string>;
  onSelectedChange: (next: Set<string>) => void;
}) {
  useLocale();
  const [applying, setApplying] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [failures, setFailures] = useState<BulkFailure[]>([]);
  const gate = useRef(false);
  const chosen = visible.filter((agent) => selected.has(agent.id)).length;
  const targets = bulkTargets(visible, selected);
  const apply = async (candidate: CrewCandidate) => {
    if (gate.current || !targets.length) return;
    gate.current = true;
    setApplying(true);
    setDone(null);
    setFailures([]);
    try {
      const result = await applyCandidateToProfiles(
        targets,
        candidate,
        (agent, expectedUpdatedAt) => state.call("crews.agent.save", { agent, expectedUpdatedAt }),
      );
      setDone(result.updated);
      setFailures(result.failures);
    } finally {
      gate.current = false;
      setApplying(false);
    }
  };
  return (
    <div className="flex min-w-0 flex-col gap-2 px-3 py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 text-ui-body">
          <Checkbox
            aria-label={t("Select all")}
            checked={visible.length > 0 && chosen === visible.length}
            indeterminate={chosen > 0 && chosen < visible.length}
            disabled={applying || !visible.length}
            onChange={(event) =>
              onSelectedChange(event.target.checked ? new Set(visible.map((a) => a.id)) : new Set())
            }
          />
          <span aria-hidden>{t("Select all")}</span>
        </div>
        <CrewBulkModelBar
          cwd={cwd}
          catalog={data.catalog}
          targetCount={targets.length}
          onApply={(candidate) => {
            apply(candidate).catch(() => {});
          }}
          disabled={applying || !targets.length}
          noun="profiles"
          suggested={commonCandidate(targets)}
        />
      </div>
      {done !== null && !failures.length ? (
        <Alert tone="success">{t("Updated {p0} profiles", { p0: done })}</Alert>
      ) : null}
      {failures.length ? (
        <Alert tone="danger">
          <p>{t("Updated {p0} profiles, {p1} failed:", { p0: done ?? 0, p1: failures.length })}</p>
          <ul className="mt-1 list-disc pl-4">
            {failures.map((failure) => (
              <li key={failure.name} className="break-words [overflow-wrap:anywhere]">
                {failure.name}: {failure.reason}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}
    </div>
  );
}
