import { t } from "../../../shared/i18n";
import { HarnessIcon } from "../../sessions/public/HarnessIcon";
import type { CrewAgent, CrewCandidate } from "../model/crew";
import { candidateEffortLabel, candidateLabel } from "../model/crewRoster";

type HostModelCatalog = Parameters<typeof candidateLabel>[0];

/**
 * A read-only model line: provider logo, model name and effort. An automatic member
 * names its pool instead of a guessed model.
 */
export function CrewModelTag({
  catalog,
  candidate,
  agent,
  className = "",
}: {
  catalog: HostModelCatalog;
  /** The model actually used; wins over the member's configuration. */
  candidate?: Pick<CrewCandidate, "harness" | "model"> &
    Partial<Pick<CrewCandidate, "modelSettings">>;
  agent?: Pick<CrewAgent, "selection" | "candidates">;
  className?: string;
}) {
  const shown = candidate ?? (agent?.selection === "fixed" ? agent.candidates[0] : undefined);
  if (!shown) {
    const count = agent?.candidates.length ?? 0;
    return (
      <span className={`truncate text-ui-caption text-(--ui-text-secondary) ${className}`}>
        {!count
          ? t("No model")
          : count === 1
            ? t("Automatic: 1 candidate")
            : t("Automatic: {p0} candidates", { p0: count })}
      </span>
    );
  }
  const full = { modelSettings: {}, capabilities: {}, id: "", ...shown } as CrewCandidate;
  const effort = candidateEffortLabel(catalog, full);
  return (
    <span
      className={`inline-flex min-w-0 items-center gap-1.5 text-ui-caption text-(--ui-text-secondary) ${className}`}
    >
      <HarnessIcon harness={shown.harness} size="xs" />
      <span className="truncate">{candidateLabel(catalog, full)}</span>
      {effort ? <span className="shrink-0">· {effort}</span> : null}
    </span>
  );
}
