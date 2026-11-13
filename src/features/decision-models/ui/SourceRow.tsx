import { Timestamp } from "../../../shared/ui/Timestamp";
import { modelDisplayName } from "../../sessions/public/modelDisplayName";
import { Text } from "../../../shared/ui/Text";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { useState } from "react";
import { formatNumber, t } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { DropdownMenu, type DropdownMenuAction } from "../../../shared/ui/DropdownMenu";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { MiddleTruncate } from "../../../shared/ui/MiddleTruncate";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { MoreHorizontal, ArrowUp, Copy } from "../../../shared/ui/icons";
import type { DecisionModelsState } from "../hooks/useDecisionModels";
import type { DecisionSource, SourceEvaluation, SourceTestResult } from "../model/decisionTypes";
import {
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
  return t("Accuracy {p1} on {p2} test cases.", { p1: accuracy, p2: formatNumber(result.cases) });
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
  testResult,
  usedFirst = false,
  duplicate,
  actions,
  isPending,
  onEdit,
  onRemove,
}: {
  source: DecisionSource;
  testResult?: SourceTestResult;
  usedFirst?: boolean;
  duplicate?: string;
  actions: Actions;
  isPending: (key: string) => boolean;
  onEdit: (source: DecisionSource) => void;
  onRemove: (source: DecisionSource, mode: "source" | "local") => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const [testedAt, setTestedAt] = useState<number | null>(null);
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
    void action.then(
      (next) => {
        setNote(next);
        if (next.kind === "test") setTestedAt(Date.now());
      },
      (error: unknown) => setFailure(error),
    );
  };
  const menuItems: DropdownMenuAction[] = [
    { kind: "item", id: "edit", label: t("Edit") },
    { kind: "item", id: "details", label: t("Details") },
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
    if (id === "details") setShowDetails(!showDetails);
    else if (id === "edit") onEdit(source);
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
  const details = [
    source.local?.modelPath
      ? t("Local file")
      : source.kind === "local"
        ? t("Local service")
        : sourceKindLabel(source.kind),
    source.local?.modelPath ??
      source.endpoint ??
      (source.model ? modelDisplayName(source.model) : undefined),
  ].filter(Boolean);
  const tested = testResult ?? (note?.kind === "test" ? note.result : undefined);
  const status = testing
    ? t("Testing…")
    : tested
      ? tested.ok
        ? t("Working")
        : t("Failed")
      : source.status === "ready"
        ? t("Working")
        : source.status === "error"
          ? t("Failed")
          : sourceStatusLabel(source.status);
  const latency = formatLatency(tested?.durationMs ?? source.avgMs);
  const accuracy = formatAccuracy(source.lastAccuracy);
  const cost = formatCost(source.costPerMTokens);
  const failedReason =
    tested && !tested.ok
      ? sourceErrorText(tested.error)
      : source.status === "error"
        ? t("Failed")
        : null;
  return (
    <li {...surfaceAttributes({ separator: "block" }, "flex min-w-0 flex-col gap-2 px-4 py-2.5")}>
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <SourceKindIcon kind={source.kind} modelPath={source.local?.modelPath} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Text
                as="span"
                size="body"
                tone="inherit"
                weight="medium"
                truncate
                className="min-w-0"
              >
                {source.name}
              </Text>
              <Tooltip label={failedReason ?? undefined}>
                <Badge
                  className="shrink-0"
                  tabIndex={failedReason ? 0 : undefined}
                  tone={
                    testing
                      ? "neutral"
                      : tested
                        ? tested.ok
                          ? "success"
                          : "danger"
                        : sourceStatusTone(source.status)
                  }
                  size="xs"
                >
                  {status}
                </Badge>
              </Tooltip>
              {usedFirst ? (
                <Badge className="shrink-0" size="xs" icon={<ArrowUp />}>
                  {t("Used first")}
                </Badge>
              ) : null}
              {duplicate ? (
                <Tooltip
                  label={t(
                    "Same model or endpoint as {p1}. Use More actions > Remove source to remove this copy.",
                    { p1: duplicate },
                  )}
                >
                  <Badge
                    className="decision-source-duplicate"
                    tabIndex={0}
                    size="xs"
                    tone="warning"
                    truncate
                    icon={<Copy />}
                  >
                    {t("Duplicate of {p1}", { p1: duplicate })}
                  </Badge>
                </Tooltip>
              ) : null}
            </div>
            <Text
              as="div"
              size="caption"
              tone="secondary"
              className="flex min-w-0 items-center gap-1"
            >
              <Tooltip label={details[1] ? String(details[1]) : undefined}>
                <Text size="caption" tone="secondary" tabIndex={details[1] ? 0 : undefined}>
                  {details[0]}
                </Text>
              </Tooltip>
              {latency ? (
                <span className="shrink-0">
                  {tested ? t("Test: {p1}", { p1: latency }) : t("Average {p1}", { p1: latency })}
                </span>
              ) : null}
            </Text>
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
            {t("Test")}
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
      {showDetails ? (
        <Text
          as="div"
          size="caption"
          tone="secondary"
          className="flex flex-wrap items-center gap-2"
        >
          {details[1] ? (
            <MiddleTruncate className="min-w-0 basis-full">{String(details[1])}</MiddleTruncate>
          ) : null}
          {[failedReason, accuracy ? t("Last accuracy {p1}", { p1: accuracy }) : null, cost]
            .filter(Boolean)
            .map((detail, index) => (
              <span key={index}>{detail}</span>
            ))}
          {testedAt !== null ? (
            <Timestamp size="caption" value={testedAt} prefix={t("Last tested")} />
          ) : null}
        </Text>
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
