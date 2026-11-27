import { LoadingText } from "../../../shared/ui/LoadingText";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { testedSources } from "../model/routingEditor";
import { automaticSources, sameSource } from "../model/presentation";
import { t } from "../../../shared/i18n";
import type { DecisionModelsState } from "../hooks/useDecisionModels";
import type { DecisionSource, SourceTestResult } from "../model/decisionTypes";
import { ErrorNotice } from "./ErrorNotice";
import { SourceRow } from "./SourceRow";

type Actions = DecisionModelsState["actions"];

/** The connected sources, one row each. Loading, empty and failed reads each have their own state. */
export function SourcesList({
  sources,
  testResults = {},
  removing = {},
  sourcesError,
  onRetry,
  actions,
  isPending,
  onEdit,
  onRemove,
}: {
  sources: DecisionSource[] | null;
  testResults?: Record<string, SourceTestResult>;
  removing?: Record<string, "source" | "local">;
  sourcesError: unknown;
  onRetry: () => void;
  actions: Actions;
  isPending: (key: string) => boolean;
  onEdit: (source: DecisionSource) => void;
  onRemove: (source: DecisionSource, mode: "source" | "local") => void;
}) {
  if (sourcesError !== null && (sources === null || sources.length === 0)) {
    return (
      <div className="px-4 py-2.5">
        <ErrorNotice error={sourcesError} onRetry={onRetry} />
      </div>
    );
  }
  if (sources === null) {
    return (
      <LoadingText delay={false} inset="panel">
        {t("Loading…")}
      </LoadingText>
    );
  }
  if (sources.length === 0) {
    // The section's Add model menu is the one way to add; the empty state only says there is none.
    return (
      <EmptyState
        size="inline"
        kind="empty"
        description={t("No decision model is connected yet.")}
      />
    );
  }
  return (
    <>
      {sourcesError !== null ? (
        <div className="px-4 py-2.5">
          <ErrorNotice error={sourcesError} onRetry={onRetry} />
        </div>
      ) : null}
      <ul className="flex min-w-0 flex-col" aria-label={t("Connected decision models")}>
        {automaticSources(
          testedSources(
            sources,
            Object.fromEntries(
              sources.flatMap((source) =>
                testResults[source.id]
                  ? [[source.id, { source, result: testResults[source.id]! }]]
                  : [],
              ),
            ),
          ) ?? sources,
        ).map((effective, index) => {
          const source = sources.find((item) => item.id === effective.id)!;
          return (
            <SourceRow
              key={source.id}
              source={source}
              testResult={testResults[source.id]}
              removing={removing[source.id]}
              usedFirst={index === 0}
              duplicate={
                sources.find((other) => other.id !== source.id && sameSource(source, other))?.name
              }
              actions={actions}
              isPending={isPending}
              onEdit={onEdit}
              onRemove={onRemove}
            />
          );
        })}
      </ul>
    </>
  );
}
