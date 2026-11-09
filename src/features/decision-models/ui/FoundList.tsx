import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Progress } from "../../../shared/ui/Progress";
import type { DiscoveryCandidate } from "../model/decisionTypes";
import { candidateKindLabel } from "../model/decisionView";
import { ErrorNotice } from "./ErrorNotice";
import { CandidateKindIcon } from "./SourceIcon";

/**
 * What the automatic scan found on this computer. Nothing is connected until the user presses Add.
 * The rescan action lives in the group header (DecisionModelsSettings); this renders the frame body.
 */
export function FoundList({
  found,
  scanning,
  scanError,
  busy,
  onScan,
  onAdd,
}: {
  found: DiscoveryCandidate[] | null;
  scanning: boolean;
  scanError: unknown;
  busy: boolean;
  onScan: () => void;
  onAdd: (candidate: DiscoveryCandidate) => void;
}) {
  const items = found ?? [];
  const empty = found !== null && items.length === 0 && !scanning && scanError === null;
  return (
    <>
      {scanning ? (
        <div className="px-4 py-2.5">
          <Progress label={t("Scanning this computer…")} />
        </div>
      ) : null}
      {scanError !== null && !scanning ? (
        <div className="px-4 py-2.5">
          <ErrorNotice error={scanError} onRetry={onScan} retrying={scanning} />
        </div>
      ) : null}
      {items.length > 0 ? (
        <ul className="flex min-w-0 flex-col" aria-label={t("Found on this computer")}>
          {items.map((candidate) => (
            <li
              key={candidate.id}
              className="flex min-w-0 items-center justify-between gap-3 border-t border-(--ui-settings-hairline) px-4 py-2.5 first:border-t-0"
            >
              <div className="flex min-w-0 items-center gap-3">
                <CandidateKindIcon kind={candidate.kind} />
                <div className="flex min-w-0 flex-col">
                  <span className="text-ui-body truncate font-medium">{candidate.label}</span>
                  <span className="text-ui-caption truncate text-(--ui-text-secondary)">
                    {candidateKindLabel(candidate.kind)}
                  </span>
                </div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => onAdd(candidate)}
              >
                {t("Add")}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {empty ? (
        <div className="px-4 py-2.5">
          <EmptyState
            context="list"
            size="inline"
            description={t(
              "Nothing found on this computer. Running services and model files appear here.",
            )}
          />
        </div>
      ) : null}
    </>
  );
}
