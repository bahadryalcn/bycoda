import { connectedCandidate } from "../model/presentation";
import { Text } from "../../../shared/ui/Text";
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
        <ul className="flex min-w-0 flex-col" aria-label={t("Found on this computer")}>
          {items.map((candidate) => (
            <li
              key={candidate.id}
              className="flex min-w-0 items-center justify-between gap-3 border-t border-(--ui-settings-hairline) px-4 py-2.5 first:border-t-0"
            >
              <div className="flex min-w-0 items-center gap-3">
                <CandidateKindIcon kind={candidate.kind} />
                <div className="flex min-w-0 flex-col">
                  <Text size="body" tone="inherit" weight="medium" truncate>
                    {candidate.label}
                  </Text>
                  <Text size="caption" tone="secondary" truncate>
                    {connectedCandidate(candidate, sources)
                      ? t("Already connected")
                      : candidateKindLabel(candidate.kind)}
                    {candidate.detail ? ` · ${candidate.detail}` : ""}
                  </Text>
                </div>
              </div>
              {connectedCandidate(candidate, sources) ? (
                <Text size="caption" tone="secondary">
                  {t("Connected")}
                </Text>
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
            description={t(
              "Nothing found on this computer. Running services and model files appear here.",
            )}
          />
        </div>
      ) : null}
    </>
  );
}
