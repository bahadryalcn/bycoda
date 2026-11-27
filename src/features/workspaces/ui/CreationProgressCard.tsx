import { useState, type ReactNode } from "react";
import { errorText } from "../../../shared/lib/errors";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { InlineError } from "../../../shared/ui/InlineError";
import { Progress } from "../../../shared/ui/Progress";
import { Spinner } from "../../../shared/ui/Spinner";
import { StatusDot } from "../../../shared/ui/StatusDot";
import { Text } from "../../../shared/ui/Text";
import { Check, CircleX, TriangleAlert } from "../../../shared/ui/icons";
import type {
  WorkspaceCreationPhase,
  WorkspaceCreationStage,
  WorkspaceCreationStageId,
} from "../model/contracts";
import { cancelCreation, useCreationProgress } from "../model/creationProgress";
import type { WorkspaceContext } from "../model/workspaceClient";

function stageLabel(id: WorkspaceCreationStageId): string {
  switch (id) {
    case "fetch":
      return t("Fetching the base branch");
    case "checkout":
      return t("Creating the worktree");
    case "submodules":
      return t("Setting up submodules");
    case "setup":
      return t("Running setup");
    case "agent":
      return t("Starting the agent");
  }
}

function phaseLabel(phase: WorkspaceCreationPhase | null): string {
  switch (phase) {
    case "failed":
      return t("Could not create the workspace.");
    case "cancelled":
      return t("Workspace creation cancelled");
    default:
      return t("Creating the workspace…");
  }
}

/** The Host sends the checkout position as numbers; the UI words it. */
function stageDetail(stage: WorkspaceCreationStage): string | undefined {
  const { repositoryIndex, repositoryCount } = stage;
  if (repositoryIndex === undefined || repositoryCount === undefined || repositoryCount <= 1)
    return undefined;
  return t("repository {p0} of {p1}", { p0: repositoryIndex, p1: repositoryCount });
}

/** Determinate only when the Host measured a percent; otherwise the bar just moves. */
function stagePercent(stage: WorkspaceCreationStage): number | undefined {
  return typeof stage.percent === "number" && Number.isFinite(stage.percent)
    ? stage.percent
    : undefined;
}

function StageIcon({ status }: { status: WorkspaceCreationStage["status"] }): ReactNode {
  switch (status) {
    case "running":
      return <Spinner size="sm" />;
    case "done":
      return <Check aria-hidden className="icon-sm" />;
    case "warning":
      return <TriangleAlert aria-hidden className="icon-sm" tone="warning" />;
    case "failed":
      return <CircleX aria-hidden className="icon-sm" tone="danger" />;
    default:
      return <StatusDot tone="muted" />;
  }
}

/**
 * Stages of one running workspace creation with a Cancel action. Gone once the creation is done.
 * @use Under the composer while a draft's worktree is created.
 */
export function CreationProgressCard({
  progressId,
  context,
}: {
  progressId: string;
  context?: WorkspaceContext;
}) {
  useLocale();
  const { phase, stages, error } = useCreationProgress(progressId, context);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string>();
  if (phase === "done") return null;
  const running = phase === null || phase === "running";
  const cancel = () => {
    setCancelling(true);
    setCancelError(undefined);
    cancelCreation(progressId, context)
      .catch((failure: unknown) => setCancelError(errorText(failure)))
      .finally(() => setCancelling(false));
  };
  return (
    <Text
      as="div"
      size="caption"
      tone="secondary"
      data-workspace-creation-progress
      className="flex min-w-0 flex-col gap-1"
    >
      <div className="flex min-w-0 items-center gap-2">
        <Text size="inherit" tone="primary" truncate className="min-w-0 flex-1">
          {phaseLabel(phase)}
        </Text>
        {running ? (
          <Button size="sm" variant="secondary" loading={cancelling} onClick={cancel}>
            {t("Cancel")}
          </Button>
        ) : null}
      </div>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {stages
          .filter((stage) => stage.status !== "skipped")
          .map((stage) => {
            const detail = stageDetail(stage);
            return (
              <li key={stage.id} data-stage={stage.id} data-status={stage.status}>
                <div className="flex min-w-0 items-center gap-1.5">
                  <StageIcon status={stage.status} />
                  <Text size="inherit" tone="inherit" truncate>
                    {stageLabel(stage.id)}
                  </Text>
                  {detail ? (
                    <Text size="inherit" tone="muted" className="tabular-nums">
                      {detail}
                    </Text>
                  ) : null}
                </div>
                {stage.status === "running" && stage.id === "checkout" ? (
                  <Progress
                    compact
                    value={stagePercent(stage)}
                    label={stageLabel(stage.id)}
                    className="mt-1"
                  />
                ) : null}
              </li>
            );
          })}
      </ul>
      {error && running ? (
        <InlineError live="off" details={error}>
          {t("Could not read the creation progress.")}
        </InlineError>
      ) : null}
      {cancelError ? (
        <InlineError live="off" details={cancelError}>
          {t("Could not cancel the creation.")}
        </InlineError>
      ) : null}
    </Text>
  );
}
