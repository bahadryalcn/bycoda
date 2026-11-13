import { useDecisionTarget } from "./DecisionTarget";
import { connectedCandidate } from "../model/presentation";
import { MiddleTruncate } from "../../../shared/ui/MiddleTruncate";
import { Badge } from "../../../shared/ui/Badge";
import { Text } from "../../../shared/ui/Text";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Progress } from "../../../shared/ui/Progress";
import { InlineMessage } from "../../../shared/ui/InlineError";
import type { DecisionSource, DiscoveryCandidate } from "../model/decisionTypes";
import { candidateKindLabel } from "../model/decisionView";
import { ErrorNotice } from "./ErrorNotice";
import { CandidateKindIcon } from "./SourceIcon";
/**
 * What the automatic scan found on this computer. Nothing is connected until the user presses Add.
 * The rescan action lives in the group header (DecisionModelsSettings); this renders the frame body.
 */
export function FoundList({
  sources = [],
  found,
  scanning,
  scanError,
  incomplete = false,
  busy,
  onScan,
  onAdd,
}: {
  sources?: DecisionSource[];
  found: DiscoveryCandidate[] | null;
  scanning: boolean;
  scanError: unknown;
  incomplete?: boolean;
  busy: boolean;
  onScan: () => void;
  onAdd: (candidate: DiscoveryCandidate) => void;
}) {
  const target = useDecisionTarget();
  const items = [...(found ?? [])].sort(
    (a, b) =>
      Number(Boolean(connectedCandidate(a, sources))) -
      Number(Boolean(connectedCandidate(b, sources))),
  );
  const empty =
    found !== null && items.length === 0 && !scanning && scanError === null && !incomplete;
  return (
    <>
      {incomplete && !scanning ? (
        <div className="px-4 py-2.5">
          <InlineMessage tone="info">
            {t("The scan is incomplete. Choose a smaller model folder or scan again.")}
          </InlineMessage>
        </div>
      ) : null}
      {scanning ? (
        <div className="px-4 py-2.5">
          <Progress label={t("Scanning this computer…")} />
        </div>
      ) : null}
      {scanError !== null ? (
        <div className="px-4 py-2.5">
          <ErrorNotice error={scanError} onRetry={scanning ? undefined : onScan} />
        </div>
      ) : null}
      {items.length > 0 ? (
        <ul
          className="flex min-w-0 flex-col"
          aria-label={
            target ? t("Found on Host {p1}", { p1: target }) : t("Found on this computer")
          }
        >
          {items.map((candidate) => (
            <li
              key={candidate.id}
              {...surfaceAttributes(
                { separator: "block" },
                "flex min-w-0 items-center justify-between gap-3 px-4 py-2.5",
              )}
            >
              <div className="flex min-w-0 items-center gap-3">
                <CandidateKindIcon kind={candidate.kind} />
                <div className="flex min-w-0 flex-col">
                  <Text size="body" tone="inherit" weight="medium" truncate>
                    {candidate.label}
                  </Text>
                  <div className="flex min-w-0 items-center gap-2">
                    <Text size="caption" tone="secondary" className="shrink-0">
                      {candidateKindLabel(candidate.kind)}
                    </Text>
                    {candidate.detail ? (
                      <MiddleTruncate size="caption" tone="secondary" className="min-w-0">
                        {candidate.detail}
                      </MiddleTruncate>
                    ) : null}
                  </div>
                </div>
              </div>
              {connectedCandidate(candidate, sources) ? (
                <Badge size="sm">{t("Connected")}</Badge>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => onAdd(candidate)}
                >
                  {t("Add")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {empty ? (
        <div className="px-4 py-2.5">
          <EmptyState
            context="list"
            size="inline"
            description={
              target
                ? t("Nothing found on Host {p1}. Running services and model files appear here.", {
                    p1: target,
                  })
                : t("Nothing found on this computer. Running services and model files appear here.")
            }
          />
        </div>
      ) : null}
    </>
  );
}
