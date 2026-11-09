import type { ReactNode } from "react";
import { t } from "../../../shared/i18n";
import { EmptyState } from "../../../shared/ui/EmptyState";
import type { DecisionModelsState } from "../hooks/useDecisionModels";
import type { DecisionSource } from "../model/decisionTypes";
import { ErrorNotice } from "./ErrorNotice";
import { SourceRow } from "./SourceRow";

type Actions = DecisionModelsState["actions"];

/** The connected sources, one row each. Loading, empty and failed reads each have their own state. */
export function SourcesList({
  sources,
  sourcesError,
  onRetry,
  actions,
  isPending,
  emptyAction,
  onEdit,
  onRemove,
}: {
  sources: DecisionSource[] | null;
  sourcesError: unknown;
  onRetry: () => void;
  actions: Actions;
  isPending: (key: string) => boolean;
  emptyAction: ReactNode;
  onEdit: (source: DecisionSource) => void;
  onRemove: (source: DecisionSource, mode: "source" | "local") => void;
}) {
  if (sourcesError !== null && sources === null) {
    return (
      <div className="px-4 py-2.5">
        <ErrorNotice error={sourcesError} onRetry={onRetry} />
      </div>
    );
  }
  if (sources === null) {
    return (
      <p className="text-ui-caption px-4 py-2.5 text-(--ui-text-secondary)">{t("Loading…")}</p>
    );
  }
  if (sources.length === 0) {
    return (
      <div className="px-4 py-2.5">
        <EmptyState
          context="list"
          size="inline"
          description={t("No decision model is connected yet.")}
          action={emptyAction}
        />
      </div>
    );
  }
  return (
    <ul className="flex min-w-0 flex-col" aria-label={t("Connected decision models")}>
      {sources.map((source) => (
        <SourceRow
          key={source.id}
          source={source}
          actions={actions}
          isPending={isPending}
          onEdit={onEdit}
          onRemove={onRemove}
        />
      ))}
    </ul>
  );
}
