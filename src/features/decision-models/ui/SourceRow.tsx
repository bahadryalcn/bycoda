import { useState } from "react";
import { t } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { DropdownMenu, type DropdownMenuAction } from "../../../shared/ui/DropdownMenu";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { Meter } from "../../../shared/ui/Meter";
import { MoreHorizontal } from "../../../shared/ui/icons";
import type { DecisionModelsState } from "../hooks/useDecisionModels";
import type { DecisionSource, SourceEvaluation, SourceTestResult } from "../model/decisionTypes";
import {
  contractLabel,
  formatAccuracy,
  formatCost,
  formatLatency,
  sourceErrorText,
  sourceKindLabel,
  sourceStatusLabel,
  sourceStatusTone,
} from "../model/decisionView";
import { ErrorNotice } from "./ErrorNotice";
import { SourceKindIcon } from "./SourceIcon";

type Actions = DecisionModelsState["actions"];

function evaluationText(result: SourceEvaluation): string {
  if (result.error) return sourceErrorText(result.error);
  const accuracy = formatAccuracy(result.accuracy);
  if (accuracy === null) return t("No result yet.");
  return t("Accuracy {p1} on {p2} test cases.", { p1: accuracy, p2: String(result.cases) });
}

function testText(result: SourceTestResult): { tone: "success" | "warning"; text: string } {
  if (result.ok) {
    const latency = formatLatency(result.durationMs);
    return {
      tone: "success",
      text: latency ? t("Connection works ({p1}).", { p1: latency }) : t("Connection works."),
    };
  }
  return { tone: "warning", text: sourceErrorText(result.error) };
}

type Note =
  | { kind: "test"; result: SourceTestResult }
  | { kind: "evaluate"; result: SourceEvaluation };

/**
 * One source: identity and status on top, measured figures under it. The connection test stays on the
 * row; every other action sits in the overflow menu.
 */
export function SourceRow({
  source,
  actions,
  isPending,
  onEdit,
  onRemove,
}: {
  source: DecisionSource;
  actions: Actions;
  isPending: (key: string) => boolean;
  onEdit: (source: DecisionSource) => void;
  onRemove: (source: DecisionSource, mode: "source" | "local") => void;
}) {
  const [note, setNote] = useState<Note | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const testing = isPending(`test:${source.id}`);
  const measuring = isPending(`evaluate:${source.id}`);
  const localBusy = isPending(`local:${source.id}`);
  const isLocal = source.kind === "local";
  const running = source.status === "ready";

  const attempt = (action: Promise<Note>) => {
    setFailure(null);
    void action.then(setNote, (error: unknown) => setFailure(error));
  };

  const menuItems: DropdownMenuAction[] = [
    { kind: "item", id: "edit", label: t("Edit") },
    {
      kind: "item",
      id: "measure",
      label: t("Measure accuracy"),
      disabled: measuring || localBusy,
    },
    ...(isLocal
      ? [
          {
            kind: "item" as const,
            id: "toggle",
            label: running ? t("Stop") : t("Start"),
            disabled: testing || measuring || localBusy,
          },
          {
            kind: "item" as const,
            id: "uninstall",
            label: t("Uninstall local model"),
            danger: true,
          },
        ]
      : []),
    { kind: "item", id: "remove", label: t("Remove source"), danger: true },
  ];

  const onMenuPick = (id: string) => {
    setMenuAnchor(null);
    if (id === "edit") onEdit(source);
    else if (id === "measure") {
      attempt(
        actions.evaluateSource(source.id).then((result) => ({ kind: "evaluate" as const, result })),
      );
    } else if (id === "toggle") {
      setFailure(null);
      void actions
        .localAction(running ? "stop" : "start", source.id)
        .catch((error: unknown) => setFailure(error));
    } else if (id === "uninstall") onRemove(source, "local");
    else if (id === "remove") onRemove(source, "source");
  };

  const details = [contractLabel(source.adapter), source.model, source.endpoint].filter(
    (part): part is string => Boolean(part),
  );
  const latency = formatLatency(source.avgMs);
  const accuracy = formatAccuracy(source.lastAccuracy);
  const cost = formatCost(source.costPerMTokens);
  const hasFigures = latency !== null || accuracy !== null || cost !== null;

  return (
    <li className="flex min-w-0 flex-col gap-2 border-t border-(--ui-settings-hairline) px-4 py-2.5 first:border-t-0">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <SourceKindIcon kind={source.kind} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="text-ui-body min-w-0 truncate font-medium">{source.name}</span>
              <Badge tone="neutral" size="sm">
                {sourceKindLabel(source.kind)}
              </Badge>
              <Badge tone={sourceStatusTone(source.status)} size="sm">
                {sourceStatusLabel(source.status)}
              </Badge>
            </div>
            <div className="text-ui-caption min-w-0 truncate text-(--ui-text-secondary)">
              {details.join(" · ")}
            </div>
            {hasFigures ? (
              <div className="text-ui-caption flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-(--ui-text-muted) tabular-nums">
                {latency ? <span>{t("Average {p1}", { p1: latency })}</span> : null}
                {accuracy ? (
                  <span className="inline-flex items-center gap-1.5">
                    {t("Last accuracy {p1}", { p1: accuracy })}
                    <span className="w-12">
                      <Meter
                        label={t("Last accuracy {p1}", { p1: accuracy })}
                        value={Math.round((source.lastAccuracy ?? 0) * 100)}
                        tone="success"
                      />
                    </span>
                  </span>
                ) : null}
                {cost ? <span>{cost}</span> : null}
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-1">
          <Button
            variant="secondary"
            size="sm"
            loading={testing}
            disabled={testing || localBusy}
            onClick={() =>
              attempt(
                actions.testSource(source.id).then((result) => ({ kind: "test" as const, result })),
              )
            }
          >
            {t("Test connection")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            label={t("More actions")}
            aria-haspopup="menu"
            aria-expanded={menuAnchor !== null}
            onClick={(event) => setMenuAnchor(event.currentTarget)}
          >
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </div>
      </div>
      {note?.kind === "test" ? (
        <InlineMessage tone={testText(note.result).tone}>
          {testText(note.result).text}
        </InlineMessage>
      ) : null}
      {note?.kind === "evaluate" ? (
        <InlineMessage tone={note.result.error ? "warning" : "info"}>
          {evaluationText(note.result)}
        </InlineMessage>
      ) : null}
      {failure !== null ? <ErrorNotice error={failure} /> : null}
      {menuAnchor ? (
        <DropdownMenu
          anchor={menuAnchor}
          label={t("More actions")}
          items={menuItems}
          onPick={onMenuPick}
          onClose={() => setMenuAnchor(null)}
          align="end"
        />
      ) : null}
    </li>
  );
}
