import { LoadingText } from "../../../shared/ui/LoadingText";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { automaticSources, sameSource } from "../model/presentation";
import type { ReactNode } from "react";
import { t } from "../../../shared/i18n";
import { Heading } from "../../../shared/ui/Heading";
import { SourceKindIcon } from "./SourceIcon";
import type { DecisionModelsState } from "../hooks/useDecisionModels";
import type { DecisionSource, SourceTestResult } from "../model/decisionTypes";
import { ErrorNotice } from "./ErrorNotice";
import { SourceRow } from "./SourceRow";

type Actions = DecisionModelsState["actions"];

/** The connected sources, one row each. Loading, empty and failed reads each have their own state. */
export function SourcesList({
  sources,
  testResults = {},
  sourcesError,
  onRetry,
  actions,
  isPending,
  emptyAction,
  onEdit,
  onRemove,
}: {
  sources: DecisionSource[] | null;
  testResults?: Record<string, SourceTestResult>;
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
      <LoadingText delay={false} className="px-4 py-2.5">
        {t("Loading…")}
      </LoadingText>
    );
  }
  if (sources.length === 0) {
    return (
      <div className="flex min-w-0 items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <SourceKindIcon kind="local" modelPath="model" />
          <div className="flex min-w-0 flex-col gap-1">
            <Heading size="item">{t("Add a decision model")}</Heading>
            <EmptyState
              size="inline"
              kind="empty"
              description={t("No decision model is connected yet.")}
            />
          </div>
        </div>
        <div className="shrink-0">{emptyAction}</div>
      </div>
    );
  }
  return (
    <ul
      className="decision-sources flex min-w-0 flex-col"
      aria-label={t("Connected decision models")}
    >
      {automaticSources(sources).map((source, index) => (
        <SourceRow
          key={source.id}
          source={source}
          testResult={testResults[source.id]}
          usedFirst={index === 0}
          duplicate={
            sources.find((other) => other.id !== source.id && sameSource(source, other))?.name
          }
          actions={actions}
          isPending={isPending}
          onEdit={onEdit}
          onRemove={onRemove}
        />
      ))}
    </ul>
  );
}
